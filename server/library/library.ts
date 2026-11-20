import { findWitness } from '../courses/caseContent.ts'
import { listMyCases } from '../courses/myCases.ts'
import { findStudentTeamId } from '../courses/workspace.ts'
import { pool } from '../db/pool.ts'
import type { CheckDraft } from '../exchange/discoveryChecks.ts'
import { HttpError } from '../httpError.ts'
import type { PlannerChart } from '../planner/planner.ts'
import { listPracticeTurns, type PracticeTurn } from '../practice/practice.ts'
import { isUuid } from '../validation.ts'
import { PRACTICE_LABEL, type Cooperation, type PracticeType } from '../witness/prompt.ts'
import { TextPdf } from '../packets/textPdf.ts'
import { COACH_KINDS } from '../practice/turn.ts'

// A student's learning library: every piece of AI feedback they've had in
// the course's cases. Their own practice sessions, with the coach's notes;
// and their team's discovery checks and planner feedback, marked with who
// asked. Nothing is copied: each entry is read from where it lives, so it's
// always as the team left it.

export const LIBRARY_KINDS = ['practice', 'discovery', 'planner'] as const
export type LibraryKind = (typeof LIBRARY_KINDS)[number]

export interface LibraryEntry {
  kind: LibraryKind
  /** The practice setting, the kind of discovery checked, or "planner". */
  subkind: string
  id: string
  caseId: string
  caseTitle: string
  title: string
  /** A line to recognize it by: the goal, or the start of the feedback. */
  summary: string
  tag: 'LOOKS_GOOD' | 'SMALL_EDITS' | 'NEEDS_IMPROVEMENT' | null
  /** Who asked for it; null for the student's own practice. */
  by: string | null
  mine: boolean
  createdAt: Date
}

interface LibraryCase {
  caseId: string
  caseTitle: string
  teamId: string
}

/** The course's cases where the student is on a team. */
async function libraryCases(courseId: string, userId: string): Promise<LibraryCase[]> {
  if (!isUuid(courseId)) return []
  const cases = await listMyCases(courseId, userId)
  const teams = await Promise.all(cases.map((c) => findStudentTeamId(c.id, userId)))
  return cases.flatMap((c, i) => (teams[i] ? [{ caseId: c.id, caseTitle: c.title, teamId: teams[i]! }] : []))
}

const CHECK_LABEL: Record<string, string> = { subpoena: 'Subpoena', interrogatories: 'Interrogatories', rfas: 'Requests for admission' }

/** "Interrogatories, check 2", or "Answers to interrogatories" for a check of the team's answers. */
const checkTitle = (kind: string, mode: string, round: number) =>
  `${mode === 'answer' ? `Answers to ${CHECK_LABEL[kind].toLowerCase()}` : CHECK_LABEL[kind]}${round > 1 ? `, check ${round}` : ''}`

const practiceTitle = (type: PracticeType, witness: string) => {
  const label = PRACTICE_LABEL[type]
  return `${label[0].toUpperCase()}${label.slice(1)} of ${witness}`
}

const clip = (text: string | null, max = 160) => {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** Everything in the student's library for the course, newest first. */
export async function libraryEntries(courseId: string, userId: string): Promise<LibraryEntry[]> {
  const cases = await libraryCases(courseId, userId)
  if (cases.length === 0) return []
  const titles = new Map(cases.map((c) => [c.caseId, c.caseTitle]))
  const caseIds = cases.map((c) => c.caseId)
  const teamIds = cases.map((c) => c.teamId)
  const [practice, checks, reviews] = await Promise.all([
    pool.query<{ id: string; caseId: string; type: PracticeType; goal: string; witness: string; createdAt: Date }>(
      `SELECT s.id, s.case_id AS "caseId", s.practice_type AS type, s.goal, w.name AS witness, s.created_at AS "createdAt"
       FROM practice_sessions s JOIN case_witnesses w ON w.id = s.witness_id
       WHERE s.user_id = $1 AND s.case_id = ANY($2::uuid[])
         AND EXISTS (SELECT 1 FROM practice_turns t WHERE t.session_id = s.id)`,
      [userId, caseIds],
    ),
    pool.query<{ id: string; caseId: string; kind: string; mode: string; round: number; tag: LibraryEntry['tag']; feedback: string; by: string | null; mine: boolean; createdAt: Date }>(
      `SELECT d.id, d.case_id AS "caseId", d.kind, d.mode, d.round, d.tag, d.feedback, u.name AS by,
              d.checked_by = $1 AS mine, d.created_at AS "createdAt"
       FROM discovery_checks d LEFT JOIN users u ON u.id = d.checked_by
       WHERE d.team_id = ANY($2::uuid[]) AND d.case_id = ANY($3::uuid[])`,
      [userId, teamIds, caseIds],
    ),
    pool.query<{ id: string; caseId: string; round: number; tag: LibraryEntry['tag']; overview: string | null; by: string | null; mine: boolean; createdAt: Date }>(
      `SELECT r.id, r.case_id AS "caseId", r.round, r.tag, r.overview, u.name AS by,
              r.asked_by = $1 AS mine, r.created_at AS "createdAt"
       FROM planner_reviews r LEFT JOIN users u ON u.id = r.asked_by
       WHERE r.status = 'ready' AND r.team_id = ANY($2::uuid[]) AND r.case_id = ANY($3::uuid[])`,
      [userId, teamIds, caseIds],
    ),
  ])
  const entries: LibraryEntry[] = [
    ...practice.rows.map((r) => ({
      kind: 'practice' as const,
      subkind: r.type,
      id: r.id,
      caseId: r.caseId,
      caseTitle: titles.get(r.caseId)!,
      title: practiceTitle(r.type, r.witness),
      summary: clip(r.goal),
      tag: null,
      by: null,
      mine: true,
      createdAt: r.createdAt,
    })),
    ...checks.rows.map((r) => ({
      kind: 'discovery' as const,
      subkind: r.mode === 'answer' ? `${r.kind}_answers` : r.kind,
      id: r.id,
      caseId: r.caseId,
      caseTitle: titles.get(r.caseId)!,
      title: checkTitle(r.kind, r.mode, r.round),
      summary: clip(r.feedback),
      tag: r.tag,
      by: r.by,
      mine: r.mine,
      createdAt: r.createdAt,
    })),
    ...reviews.rows.map((r) => ({
      kind: 'planner' as const,
      subkind: 'planner',
      id: r.id,
      caseId: r.caseId,
      caseTitle: titles.get(r.caseId)!,
      title: `Planner feedback, round ${r.round}`,
      summary: clip(r.overview),
      tag: r.tag,
      by: r.by,
      mine: r.mine,
      createdAt: r.createdAt,
    })),
  ]
  return entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export interface PracticeDetail {
  kind: 'practice'
  entry: LibraryEntry
  session: {
    witness: { id: string; name: string; role: string; avatarUrl: string | null }
    type: PracticeType
    goal: string
    cooperation: Cooperation
    toneNotes: string
    priorTestimony: string
    turns: PracticeTurn[]
    endedAt: Date | null
  }
}

export interface DiscoveryDetail {
  kind: 'discovery'
  entry: LibraryEntry
  check: {
    kind: string
    mode: string
    round: number
    tag: LibraryEntry['tag']
    feedback: string
    /** What was checked; null for checks from before it was kept. */
    content: CheckDraft | null
    /** For a check of the team's answers: the other side's questions, by position. */
    questions: { position: number; text: string }[]
  }
}

export interface PlannerDetail {
  kind: 'planner'
  entry: LibraryEntry
  review: {
    round: number
    tag: LibraryEntry['tag']
    overview: string | null
    bigPicture: string | null
    /** Each question, with the card or gap it's on as the chart was when it was asked. */
    notes: { targetKind: 'card' | 'gap'; title: string; text: string }[]
  }
}

export type LibraryDetail = PracticeDetail | DiscoveryDetail | PlannerDetail

const NOT_FOUND = 'That isn’t in your learning library.'

/** One entry in full, if it's the student's to see. */
export async function libraryDetail(courseId: string, userId: string, kind: string, id: string): Promise<LibraryDetail> {
  if (!(LIBRARY_KINDS as readonly string[]).includes(kind) || !isUuid(id)) throw new HttpError(404, NOT_FOUND)
  const entry = (await libraryEntries(courseId, userId)).find((e) => e.kind === kind && e.id === id)
  if (!entry) throw new HttpError(404, NOT_FOUND)

  if (entry.kind === 'practice') {
    const { rows } = await pool.query<PracticeDetail['session'] & { witnessId: string }>(
      `SELECT witness_id AS "witnessId", practice_type AS type, goal, cooperation, tone_notes AS "toneNotes",
              prior_testimony AS "priorTestimony", ended_at AS "endedAt"
       FROM practice_sessions WHERE id = $1`,
      [id],
    )
    const { witnessId, ...session } = rows[0]
    const [witness, turns] = await Promise.all([findWitness(entry.caseId, witnessId), listPracticeTurns(id)])
    return {
      kind: 'practice',
      entry,
      session: {
        ...session,
        witness: { id: witnessId, name: witness?.name ?? 'The witness', role: witness?.role ?? '', avatarUrl: witness?.avatarUrl ?? null },
        turns: turns.map((t) => ({ position: t.position, kind: t.kind, text: t.text, blocks: t.blocks, createdAt: t.createdAt })),
      },
    }
  }

  if (entry.kind === 'discovery') {
    const { rows } = await pool.query<DiscoveryDetail['check'] & { requestId: string | null }>(
      `SELECT kind, mode, round, tag, feedback, content, request_id AS "requestId" FROM discovery_checks WHERE id = $1`,
      [id],
    )
    const { requestId, ...check } = rows[0]
    const questions = requestId
      ? (await pool.query<{ position: number; text: string }>('SELECT position, text FROM exchange_items WHERE request_id = $1 ORDER BY position', [requestId])).rows
      : []
    return { kind: 'discovery', entry, check: { ...check, questions } }
  }

  const { rows } = await pool.query<{ round: number; tag: LibraryEntry['tag']; overview: string | null; bigPicture: string | null; snapshot: PlannerChart }>(
    `SELECT round, tag, overview, big_picture AS "bigPicture", snapshot FROM planner_reviews WHERE id = $1`,
    [id],
  )
  const { snapshot, ...review } = rows[0]
  const notes = await pool.query<{ targetKind: 'card' | 'gap'; targetId: string; text: string }>(
    `SELECT target_kind AS "targetKind", target_id AS "targetId", text FROM planner_review_notes WHERE review_id = $1 ORDER BY position`,
    [id],
  )
  const titleOf = (kind: 'card' | 'gap', targetId: string) => {
    if (kind === 'card') {
      const card = snapshot.cards.find((c) => c.id === targetId)
      return card?.title.trim() || (card?.parentId ? 'Untitled sub-fact' : 'Untitled fact')
    }
    return `Gap: ${snapshot.gaps.find((g) => g.id === targetId)?.description.trim() || 'Untitled gap'}`
  }
  return {
    kind: 'planner',
    entry,
    review: { ...review, notes: notes.rows.map((n) => ({ targetKind: n.targetKind, title: titleOf(n.targetKind, n.targetId), text: n.text })) },
  }
}

const TAG_LABEL: Record<NonNullable<LibraryEntry['tag']>, string> = {
  LOOKS_GOOD: 'Looks good',
  SMALL_EDITS: 'Small edits',
  NEEDS_IMPROVEMENT: 'Needs work',
}

const COACH_LABEL: Record<string, string> = {
  good: 'Good question',
  off_target: 'Off target',
  leading: 'Leading',
  evidence: 'Evidence',
  ethics: 'Professional responsibility',
  judge_jury: 'Judge and jury',
  grammar: 'Wording',
  polish: 'Polish',
}

const day = (date: Date) => new Date(date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

/** The entry as a PDF, to keep. */
export async function libraryPdf(detail: LibraryDetail) {
  const { entry } = detail
  const pdf = await TextPdf.create(`${entry.title} · ${entry.caseTitle}`)
  pdf.title(entry.title)
  pdf.text(entry.caseTitle).text(`${day(entry.createdAt)}${entry.by && !entry.mine ? ` · asked for by ${entry.by}` : ''}`)
  if (entry.tag) pdf.text(`AI's verdict: ${TAG_LABEL[entry.tag]}`, { bold: true })
  pdf.space(10)

  if (detail.kind === 'practice') {
    const s = detail.session
    pdf.heading('What you practiced')
    pdf.text(s.goal)
    pdf.text(`Witness: ${s.cooperation}${s.toneNotes ? `, ${s.toneNotes}` : ''}`, { gray: true })
    if (s.priorTestimony) pdf.text(`Earlier testimony: ${s.priorTestimony}`, { gray: true })
    pdf.space(8)
    pdf.heading('Transcript')
    let q = 0
    for (const t of s.turns) {
      const label = t.kind === 'objection_response' ? 'Your response:' : `Q${++q}.`
      pdf.text(`${label} ${t.text}${t.kind === 'edited' ? ' (edited)' : t.kind === 'as_written' ? ' (asked as written)' : ''}`, { bold: true })
      const b = t.blocks
      if (b.hold) pdf.text('Held, not asked.', { gray: true, indent: 14 })
      if (b.objection) pdf.text(`${b.objection.by}: ${b.objection.text}`, { indent: 14 })
      if (b.ruling) pdf.text(`The Court: ${b.ruling.text}`, { indent: 14 })
      if (b.counsel) pdf.text(b.counsel, { indent: 14 })
      if (b.witness) pdf.text(`A. ${b.witness}`)
      for (const n of b.coach) {
        const label = (COACH_KINDS as readonly string[]).includes(n.kind) ? COACH_LABEL[n.kind] : 'Coach'
        pdf.text(`Coach (${label})${n.quote ? `, on “${n.quote}”` : ''}: ${n.text}`, { size: 9.5, gray: true, indent: 14 })
      }
      pdf.space(8)
    }
  } else if (detail.kind === 'discovery') {
    const c = detail.check
    const content = c.content
    if (content) {
      pdf.heading('What was checked')
      if ('subpoena' in content) {
        const s = content.subpoena
        pdf.text(`To: ${s.recipient}${s.recipientDescription ? `, ${s.recipientDescription}` : ''}`)
        pdf.text(`Records: ${s.records}`)
        if (s.justification) pdf.text(`Why: ${s.justification}`)
      } else if ('items' in content) {
        content.items.forEach((item, i) => pdf.text(`${i + 1}. ${item}`))
      } else {
        for (const r of content.responses) {
          const question = c.questions.find((x) => x.position === r.position)
          pdf.text(`${r.position + 1}. ${question?.text ?? ''}`, { bold: true })
          pdf.text(r.objection ? `Objection. ${r.answer}` : r.answer || r.admission || '', { indent: 14 })
        }
      }
      pdf.space(8)
    }
    pdf.heading('Feedback')
    pdf.text(c.feedback)
  } else {
    const r = detail.review
    if (r.overview) pdf.heading('Overview').text(r.overview).space(8)
    if (r.notes.length) {
      pdf.heading('On your chart')
      for (const n of r.notes) pdf.text(n.title, { bold: true }).text(n.text, { indent: 14 }).space(4)
      pdf.space(8)
    }
    if (r.bigPicture) pdf.heading('The big picture').text(r.bigPicture)
  }
  return pdf.save()
}
