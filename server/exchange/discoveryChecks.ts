import { createHash } from 'node:crypto'
import { ai, AiNotConfiguredError } from '../ai/ai.ts'
import { listMaterialsFor, listMaterialTexts } from '../courses/caseContent.ts'
import { finishPendingTranscriptions } from '../courses/materialText.ts'
import { pool } from '../db/pool.ts'
import { HttpError } from '../httpError.ts'
import { isUuid } from '../validation.ts'
import { findTeamWorld, markedTranscript, settledFacts } from '../reviews/reviews.ts'
import {
  getSettings,
  listTeamRequests,
  usedCount,
  type ExchangeItem,
  type ExchangeKind,
  type ExchangeRequest,
  type ItemResponse,
  type SubpoenaType,
  type TeamContext,
} from './exchange.ts'
import type { CheckMode, DiscoveryKind, MentorContext, MentorTag, PriorDiscovery } from './mentorPrompt.ts'
import { teamSubpoenas } from './subpoenas.ts'

// "Check with AI": before a team sends discovery (or its answers to a set),
// the discovery mentor reviews the draft. It reads only what the team can
// see: the case files it has, the facts accepted for its world, its own
// interview transcripts, and the discovery it has sent and received. Each
// check is kept with a hash of what was checked; the submission that follows
// records the last check's tag and feedback for the instructor, and whether
// it's the same draft or was edited since. Checking again is the next round:
// the mentor reads its feedback from the round before, and the case may
// limit how many rounds one draft gets.

/** A subpoena as checked and served: its type already resolved (a case allowing one kind doesn't ask). */
export interface SubpoenaDraft {
  recipient: string
  recipientDescription: string
  requestType: string
  records: string
  justification: string
}

export type CheckDraft =
  | { kind: 'subpoena'; mode: 'draft'; subpoena: SubpoenaDraft }
  | { kind: ExchangeKind; mode: 'draft'; items: string[] }
  | { kind: ExchangeKind; mode: 'answer'; requestId: string; responses: ItemResponse[] }

/** What a submission records of the check before it. */
export interface SubmissionCheck {
  tag: MentorTag
  feedback: string
  /** The submission is exactly the draft that was checked. */
  current: boolean
}

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** What's compared between a check and its submission: the content, trimmed, as it's stored. */
export function draftHash(draft: CheckDraft) {
  if (draft.kind === 'subpoena' && 'subpoena' in draft) {
    const s = draft.subpoena
    return hash([s.recipient, s.recipientDescription, s.requestType, s.records, s.justification].map((t) => t.trim()))
  }
  if (draft.mode === 'draft') return hash(draft.items.map((t) => t.trim()).filter(Boolean))
  return hash(
    [...draft.responses]
      .sort((a, b) => a.position - b.position)
      .map((r) => [r.position, r.answer.trim(), r.objection, r.admission, r.agreePart.trim(), r.disagreePart.trim()]),
  )
}

const TYPE_TEXT: Record<SubpoenaType, string> = {
  documents: 'physical documents or electronically stored information (ESI)',
  tangible_things: 'tangible things',
  inspection: 'inspection of premises',
}

const KIND_TEXT: Record<ExchangeKind, string> = { interrogatories: 'interrogatories', rfas: 'requests for admission' }

/** One answered item, as the record reads: the answer or objection, or the admission. */
function answerText(kind: ExchangeKind, r: Pick<ExchangeItem, 'answer' | 'objection' | 'admission' | 'agreePart' | 'disagreePart'>) {
  if (kind === 'interrogatories') return r.objection ? `Objection: ${r.answer ?? ''}` : `Answer: ${r.answer ?? ''}`
  if (r.admission === 'agree') return `Admitted.${r.answer ? ` ${r.answer}` : ''}`
  if (r.admission === 'disagree') return `Denied.${r.answer ? ` ${r.answer}` : ''}`
  if (r.admission === 'partial') return `Admitted in part: ${r.agreePart ?? ''} Denied in part: ${r.disagreePart ?? ''}`
  return 'No response yet.'
}

const numbered = (items: string[]) => items.map((t, i) => `${i + 1}. ${t}`).join('\n')

const shortDate = (d: Date) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/** A set the team sent or received, as prior discovery. */
function priorSet(r: ExchangeRequest, teamId: string): PriorDiscovery {
  const ours = r.fromTeam.id === teamId
  const content = r.items
    .map((i) => `${i.position}. ${i.text}${r.respondedAt ? `\n   ${answerText(r.kind, i)}` : ''}`)
    .join('\n')
  return {
    title: `${KIND_TEXT[r.kind][0].toUpperCase()}${KIND_TEXT[r.kind].slice(1)} from Team ${r.fromTeam.number} to Team ${r.toTeam.number}, sent ${shortDate(r.sentAt)}`,
    type: KIND_TEXT[r.kind],
    servedBy: ours ? 'your team' : 'opposing counsel',
    status: r.respondedAt ? 'answered' : 'awaiting answers',
    content,
  }
}

/** The team's completed interviews, as transcripts, leaving out what rests on a denied fact. */
async function interviewTranscripts(caseId: string, teamId: string) {
  const { rows } = await pool.query<{ id: string; witness: string; completedAt: Date }>(
    `SELECT r.id, w.name AS witness, r.completed_at AS "completedAt"
     FROM interview_reviews r JOIN case_witnesses w ON w.id = r.witness_id
     WHERE r.case_id = $1 AND r.team_id = $2 AND r.kind = 'interview' AND r.status = 'completed'
     ORDER BY r.completed_at`,
    [caseId, teamId],
  )
  const transcripts = []
  for (const r of rows) {
    const { turns } = await markedTranscript(r.id)
    const kept = turns.filter((t) => !t.struck)
    if (!kept.length) continue
    transcripts.push({
      title: `Your team's interview of ${r.witness} (${shortDate(r.completedAt)})`,
      content: kept.map((t) => `Q: ${t.question}\nA: ${t.answer}`).join('\n\n'),
    })
  }
  return transcripts
}

/** Everything the mentor reads for this draft: only what the team can see. */
export async function mentorContext(ctx: TeamContext, draft: CheckDraft): Promise<MentorContext> {
  const world = await findTeamWorld(ctx.teamId)
  if (!world) throw new HttpError(409, 'Your team needs a case world first.')
  const { rows } = await pool.query<{
    title: string
    summary: string
    inWorldDate: string | null
    parties: { plaintiff: string; defendant: string }
  }>(
    `SELECT title, summary, to_char(in_world_date, 'YYYY-MM-DD') AS "inWorldDate",
            json_build_object('plaintiff', plaintiff_name, 'defendant', defendant_name) AS parties
     FROM cases WHERE id = $1`,
    [ctx.caseId],
  )
  const c = rows[0]
  let texts = await listMaterialTexts(ctx.caseId, world.matchupId)
  if (texts.some((m) => m.textStatus === 'pending')) {
    await finishPendingTranscriptions(texts)
    texts = await listMaterialTexts(ctx.caseId, world.matchupId)
  }
  const [visible, settled, transcripts, requests, subpoenas, settings, served] = await Promise.all([
    listMaterialsFor(ctx.caseId, { side: world.side, teamId: ctx.teamId, matchupId: world.matchupId }),
    settledFacts(ctx.caseId, world.matchupId),
    interviewTranscripts(ctx.caseId, ctx.teamId),
    listTeamRequests(ctx.caseId, ctx.teamId, ctx.userId),
    teamSubpoenas(ctx.caseId, ctx.teamId, ctx.userId),
    getSettings(ctx.caseId),
    usedCount(ctx.caseId, ctx.teamId, 'interrogatories'),
  ])
  const canSee = new Set(visible.map((m) => m.id))
  const answering = draft.mode === 'answer' ? requests.find((r) => r.id === draft.requestId && r.toTeam.id === ctx.teamId) : null
  if (draft.mode === 'answer' && !answering) throw new HttpError(404, 'Request not found.')

  const base = {
    caseTitle: c.title,
    parties: c.parties,
    caseSummary: c.summary,
    inWorldDate: c.inWorldDate,
    side: world.side,
    interrogatoryLimit: settings.interrogatories.limit,
    interrogatoriesServed: served,
    documents: [
      ...texts
        .filter((m) => canSee.has(m.id) && m.textStatus === 'ready' && m.text)
        .map((m) => ({ title: m.description || m.filename, content: m.text! })),
      ...transcripts,
    ],
    acceptedFacts: settled.accepted,
    priorDiscovery: [
      ...requests.filter((r) => r.id !== answering?.id).map((r) => priorSet(r, ctx.teamId)),
      ...subpoenas.map(
        (s): PriorDiscovery => ({
          title: `Subpoena to ${s.recipient}, served ${shortDate(s.sentAt)}`,
          type: `subpoena (${TYPE_TEXT[s.requestType]})`,
          servedBy: 'your team',
          status: s.outcome === 'denied' ? 'denied' : s.outcome === 'responded' ? 'answered' : 'awaiting a response',
          content: `Asked for: ${s.records}${s.outcome && s.response ? `\n\n${s.outcome === 'denied' ? 'Denial' : 'Response'}: ${s.response}` : ''}`,
        }),
      ),
    ],
  }

  if (draft.kind === 'subpoena' && 'subpoena' in draft) {
    const s = draft.subpoena
    return {
      ...base,
      kind: 'subpoena',
      mode: 'draft',
      subpoenaRecipient: s.recipientDescription.trim() ? `${s.recipient.trim()} (${s.recipientDescription.trim()})` : s.recipient.trim(),
      subpoenaTypes: TYPE_TEXT[s.requestType as SubpoenaType] ?? s.requestType,
      draft: s.records.trim(),
      goal: s.justification,
    }
  }
  if (draft.mode === 'draft') {
    return { ...base, kind: draft.kind, mode: 'draft', draft: numbered(draft.items.map((t) => t.trim()).filter(Boolean)) }
  }
  const byPosition = new Map(draft.responses.map((r) => [r.position, r]))
  return {
    ...base,
    kind: draft.kind,
    mode: 'answer',
    servedRequests: numbered(answering!.items.map((i) => i.text)),
    draft: answering!.items
      .map((i) => {
        const r = byPosition.get(i.position)
        return `${i.position}. ${r ? answerText(draft.kind, { ...r, agreePart: r.agreePart, disagreePart: r.disagreePart }) : 'No response yet.'}`
      })
      .join('\n'),
  }
}

/**
 * The check this one follows, if any. A draft's is the check the team names,
 * if it's the team's own check of the same kind; answers' is the team's
 * latest check of its answers to that set.
 */
async function previousCheck(ctx: TeamContext, draft: CheckDraft, previousCheckId: unknown) {
  const { rows } =
    draft.mode === 'answer'
      ? await pool.query<{ id: string; round: number; feedback: string }>(
          `SELECT id, (SELECT count(*)::int FROM discovery_checks a
                       WHERE a.request_id = $1 AND a.team_id = $2 AND a.mode = 'answer') AS round, feedback
           FROM discovery_checks WHERE request_id = $1 AND team_id = $2 AND mode = 'answer'
           ORDER BY created_at DESC LIMIT 1`,
          [draft.requestId, ctx.teamId],
        )
      : isUuid(previousCheckId)
        ? await pool.query<{ id: string; round: number; feedback: string }>(
            `SELECT id, round, feedback FROM discovery_checks
             WHERE id = $1 AND case_id = $2 AND team_id = $3 AND kind = $4 AND mode = 'draft'`,
            [previousCheckId, ctx.caseId, ctx.teamId, draft.kind],
          )
        : { rows: [] }
  return rows[0] ?? null
}

/**
 * Has the mentor review the draft, and keeps the check for the submission
 * that follows. `rounds` is how many checks one draft gets (null: unlimited).
 */
export async function runCheck(ctx: TeamContext, draft: CheckDraft, options: { previousCheckId?: unknown; rounds?: number | null } = {}) {
  const previous = await previousCheck(ctx, draft, options.previousCheckId)
  const round = (previous?.round ?? 0) + 1
  const rounds = options.rounds ?? null
  if (rounds !== null && round > rounds) {
    throw new HttpError(409, `You've used all ${rounds === 1 ? 'your AI feedback' : `${rounds} rounds of AI feedback`} for this draft. Send it when you're ready.`)
  }
  const context: MentorContext = {
    ...(await mentorContext(ctx, draft)),
    previous: previous ? { round: previous.round, feedback: previous.feedback } : undefined,
    finalRound: rounds !== null && round === rounds,
  }
  let result: { tag: MentorTag; feedback: string }
  try {
    result = await ai.reviewDiscovery(context)
  } catch (err) {
    if (!(err instanceof AiNotConfiguredError)) console.error('Could not check a discovery draft:', err)
    throw new HttpError(502, err instanceof AiNotConfiguredError ? err.message : 'The AI couldn’t check your draft just now. Try again, or send it as it is.')
  }
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO discovery_checks (case_id, team_id, kind, mode, request_id, content_hash, tag, feedback, checked_by, round, previous_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [
      ctx.caseId,
      ctx.teamId,
      draft.kind,
      draft.mode,
      draft.mode === 'answer' ? draft.requestId : null,
      draftHash(draft),
      result.tag,
      result.feedback,
      ctx.userId,
      round,
      previous?.id ?? null,
    ],
  )
  return { id: rows[0].id, tag: result.tag, feedback: result.feedback, round }
}

/**
 * The check a submission names, if it's this team's and for the same thing,
 * and whether the submission is the draft that was checked. Anything else
 * (no id, another team's) counts as unchecked.
 */
export async function submissionCheck(ctx: TeamContext, checkId: unknown, draft: CheckDraft): Promise<SubmissionCheck | null> {
  if (typeof checkId !== 'string' || !/^[0-9a-f-]{36}$/i.test(checkId)) return null
  const { rows } = await pool.query<{ tag: MentorTag; feedback: string; contentHash: string }>(
    `SELECT tag, feedback, content_hash AS "contentHash" FROM discovery_checks
     WHERE id = $1 AND case_id = $2 AND team_id = $3 AND kind = $4 AND mode = $5 AND request_id IS NOT DISTINCT FROM $6`,
    [checkId, ctx.caseId, ctx.teamId, draft.kind, draft.mode, draft.mode === 'answer' ? draft.requestId : null],
  )
  const check = rows[0]
  if (!check) return null
  return { tag: check.tag, feedback: check.feedback, current: check.contentHash === draftHash(draft) }
}

export type { CheckMode, DiscoveryKind }
