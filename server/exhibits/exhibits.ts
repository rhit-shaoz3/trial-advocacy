import type { PoolClient } from 'pg'
import { pool } from '../db/pool.ts'
import { HttpError } from '../httpError.ts'
import { isUuid } from '../validation.ts'
import { listMaterialsFor } from '../courses/caseContent.ts'
import type { Side } from '../courses/matchups.ts'
import { worldLetter } from '../courses/teams.ts'
import {
  exhibitPageCount,
  findExhibitSource,
  keepRedactedFile,
  keptPages,
  markable,
  readPageMarks,
  readTextMarks,
  redactText,
  redactedType,
  splitParagraphs,
  textParts,
} from './exhibitFiles.ts'

// The joint exhibit list, in the final steps phase. Each side of a case world
// lists what it may use at trial: case files it can see, transcripts of the
// depositions it took, and its investigator reports (whole, or chosen turns
// or paragraphs). Once both sides submit, the lists are exchanged: what both
// listed is admitted (the plaintiff's, since the plaintiff goes first), and
// each side reviews the other's: authenticity first, then admissibility. The
// instructor rules on every challenge, even in review lite. When nothing is
// left open the list is final: the plaintiff's exhibits are numbered, the
// defense's lettered.

type Db = Pick<PoolClient, 'query'>

export const SOURCE_KINDS = ['material', 'deposition', 'report'] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

export const EXHIBIT_STATUSES = [
  'awaiting_authenticity',
  'authenticity_review',
  'inauthentic',
  'awaiting_admission',
  'objection_response',
  'admission_review',
  'dropped',
  'admitted',
  'excluded',
] as const
export type ExhibitStatus = (typeof EXHIBIT_STATUSES)[number]

/** Still waiting on a side or the instructor. */
const OPEN_STATUSES: ExhibitStatus[] = [
  'awaiting_authenticity',
  'authenticity_review',
  'awaiting_admission',
  'objection_response',
  'admission_review',
]

export const MAX_NOTE_LENGTH = 2000
export const MAX_LIST_ITEMS = 100
/** The highest page a file excerpt can name. */
export const MAX_PAGE = 9999

const otherSide = (side: Side): Side => (side === 'plaintiff' ? 'defense' : 'plaintiff')

/**
 * One item a team chose: a source, and the parts of it (null for all of it):
 * a file's pages (from 1), a transcript's turns (by position), or a report's
 * paragraphs (from 0).
 */
export interface ListItem {
  kind: SourceKind
  id: string
  parts: number[] | null
}

/** A transcript turn or a report paragraph, as listed. */
export interface Part {
  /** The turn's position, or the paragraph's index. */
  n: number
  /** The witness's answer for a turn; the paragraph for a report. */
  text: string
  /** The question, for a turn. */
  question?: string
  /** The witness's lawyer's objection, for a turn. */
  objection?: string | null
}

/** Something a team can put on its list. Matches `ExhibitOption` in src/courses/types.ts. */
export interface ExhibitOption {
  kind: SourceKind
  id: string
  title: string
  /** Where it's from: the case file, the investigator, or the team's depositions. */
  group: 'case-file' | 'investigator' | 'depositions'
  /** For a file, its type, to show it in the viewer. */
  contentType?: string
  filename?: string
  /** For a transcript or report, its turns or paragraphs to choose from. */
  parts?: Part[]
}

/** Shape sent to the client; matches `Exhibit` in src/courses/types.ts. */
export interface Exhibit {
  id: string
  offeredBy: Side
  joint: boolean
  position: number
  kind: SourceKind
  sourceId: string
  parts: number[] | null
  title: string
  /**
   * The chosen turns or paragraphs, as they were when the lists were
   * exchanged; once admitted with a redaction, the redacted ones (and, for a
   * text file, its paragraphs).
   */
  excerpt: Part[] | null
  contentType: string | null
  status: ExhibitStatus
  authenticated: boolean
  authenticityNote: string | null
  authenticityRuling: 'authenticated' | 'inauthentic' | null
  authenticityRulingNote: string | null
  objection: string | null
  response: string | null
  acceptsRedaction: string | null
  ruling: 'overruled' | 'sustained' | 'partial' | null
  rulingNote: string | null
  redaction: string | null
  /** Admitted with the instructor's marks: its file or excerpt is the redacted version. */
  redacted: boolean
  /** An admitted excerpt a larger admitted exhibit from the same source took the place of. */
  supersededBy: string | null
  /** "1", "2", … for the plaintiff and "A", "B", … for the defense, once the list is final. */
  label: string | null
  updatedAt: Date
  ruledAt: Date | null
}

/** One side's list. Matches `ExhibitList` in src/courses/types.ts. */
export interface ExhibitList {
  side: Side
  items: (ListItem & { title: string })[]
  updatedAt: Date | null
  submittedAt: Date | null
  submittedBy: string | null
}

/** The side of a case world a student's team is on. */
export interface ExhibitTeam {
  caseId: string
  matchupId: string
  teamId: string
  side: Side
  userId: string
}

// Sources ---------------------------------------------------------------------

const shortDay = (date: Date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** The depositions a team took: its interviews, with answers, of a witness for the other side. */
async function teamDepositions(db: Db, caseId: string, teamId: string) {
  const { rows } = await db.query<{ id: string; name: string; createdAt: Date; turns: Part[] }>(
    `SELECT i.id, w.name, i.created_at AS "createdAt",
            json_agg(json_build_object('n', t.position, 'question', t.question, 'objection', t.objection,
                                       'text', t.answer) ORDER BY t.position) AS turns
     FROM interviews i
     JOIN case_witnesses w ON w.id = i.witness_id
     JOIN interview_turns t ON t.interview_id = i.id
     WHERE w.case_id = $1 AND i.team_id = $2 AND w.aligned_side IS NOT NULL AND w.aligned_side <> i.side
     GROUP BY i.id, w.name
     ORDER BY i.created_at`,
    [caseId, teamId],
  )
  return rows.map((r) => ({ id: r.id, title: `Deposition of ${r.name} (${shortDay(r.createdAt)})`, parts: r.turns }))
}

/** A team's investigator reports that are back. */
async function teamReports(db: Db, caseId: string, teamId: string) {
  const { rows } = await db.query<{ id: string; report: string; completedAt: Date | null; createdAt: Date; name: string }>(
    `SELECT r.id, r.final_report AS report, r.completed_at AS "completedAt", r.created_at AS "createdAt",
            c.investigator_name AS name
     FROM interview_reviews r JOIN cases c ON c.id = r.case_id
     WHERE r.case_id = $1 AND r.team_id = $2 AND r.kind = 'investigation' AND r.status = 'completed'
       AND r.final_report IS NOT NULL
     ORDER BY r.created_at`,
    [caseId, teamId],
  )
  return rows.map((r) => ({
    id: r.id,
    title: `${r.name}'s report (${shortDay(r.completedAt ?? r.createdAt)})`,
    parts: splitParagraphs(r.report).map((text, n) => ({ n, text })),
  }))
}

/** The files the investigator's reports unlocked for the team. */
async function investigatorFileIds(db: Db, teamId: string) {
  const { rows } = await db.query<{ id: string }>(
    `SELECT DISTINCT d.material_id AS id
     FROM review_documents d JOIN interview_reviews r ON r.id = d.review_id
     WHERE r.team_id = $1 AND r.kind = 'investigation' AND d.decision = 'allow'`,
    [teamId],
  )
  return new Set(rows.map((r) => r.id))
}

/** Everything the team can put on its list. */
export async function exhibitOptions(team: ExhibitTeam, db: Db = pool): Promise<ExhibitOption[]> {
  const [materials, fromInvestigator, depositions, reports] = await Promise.all([
    listMaterialsFor(team.caseId, { side: team.side, teamId: team.teamId, matchupId: team.matchupId }),
    investigatorFileIds(db, team.teamId),
    teamDepositions(db, team.caseId, team.teamId),
    teamReports(db, team.caseId, team.teamId),
  ])
  return [
    ...materials.map(
      (m): ExhibitOption => ({
        kind: 'material',
        id: m.id,
        title: m.description || m.filename,
        group: fromInvestigator.has(m.id) ? 'investigator' : 'case-file',
        contentType: m.contentType,
        filename: m.filename,
      }),
    ),
    ...reports.map((r): ExhibitOption => ({ kind: 'report', id: r.id, title: r.title, group: 'investigator', parts: r.parts })),
    ...depositions.map((d): ExhibitOption => ({ kind: 'deposition', id: d.id, title: d.title, group: 'depositions', parts: d.parts })),
  ]
}

const sourceKey = (item: Pick<ListItem, 'kind' | 'id'>) => `${item.kind}:${item.id}`

/** " — pages 3–5, 9", " — Q&A 1–3, 7" or " — paragraphs 2, 4", counting from 1; "" for the whole thing. */
export function partsLabel(kind: SourceKind, parts: number[] | null, all: Part[] | null) {
  if (!parts) return ''
  const shown = all ? parts.map((n) => all.findIndex((p) => p.n === n) + 1).filter((i) => i > 0) : parts
  const ranges: string[] = []
  for (let i = 0; i < shown.length; i++) {
    let j = i
    while (j + 1 < shown.length && shown[j + 1] === shown[j] + 1) j++
    ranges.push(j > i ? `${shown[i]}–${shown[j]}` : `${shown[i]}`)
    i = j
  }
  const noun =
    kind === 'deposition' ? 'Q&A' : kind === 'material' ? (shown.length === 1 ? 'page' : 'pages') : shown.length === 1 ? 'paragraph' : 'paragraphs'
  return ` — ${noun} ${ranges.join(', ')}`
}

/** The parts of a source that `parts` picks (all of them for null). */
const pick = (all: Part[], parts: number[] | null) => (parts ? all.filter((p) => parts.includes(p.n)) : all)

/** Reads a list from the request: `{ items: [{ kind, id, parts }] }`, checked against what the team can list. */
function readItems(body: unknown, options: ExhibitOption[]): (ListItem & { title: string })[] {
  const raw = (body as Record<string, unknown> | undefined)?.items
  if (!Array.isArray(raw)) throw new HttpError(400, 'Send the exhibit list.')
  if (raw.length > MAX_LIST_ITEMS) throw new HttpError(400, `An exhibit list can have at most ${MAX_LIST_ITEMS} items.`)
  const byKey = new Map(options.map((o) => [sourceKey(o), o]))
  const seen = new Set<string>()
  return raw.map((entry) => {
    const e = entry as Record<string, unknown> | null
    const kind = e?.kind as SourceKind
    const id = e?.id
    if (!SOURCE_KINDS.includes(kind) || !isUuid(id)) throw new HttpError(400, 'Each exhibit needs a kind and an id.')
    const option = byKey.get(sourceKey({ kind, id }))
    if (!option) throw new HttpError(400, "That isn't something your team can list.")
    if (seen.has(sourceKey(option))) throw new HttpError(400, `${option.title} is on the list twice.`)
    seen.add(sourceKey(option))
    let parts: number[] | null = null
    if (e?.parts !== null && e?.parts !== undefined) {
      if (!Array.isArray(e.parts) || e.parts.length === 0) throw new HttpError(400, `Choose at least one part of ${option.title}.`)
      // A file's pages can be any; a transcript's or report's must exist.
      const valid = option.parts ? new Set(option.parts.map((p) => p.n)) : null
      const ok = (n: unknown) => Number.isInteger(n) && (valid ? valid.has(n as number) : (n as number) >= 1 && (n as number) <= MAX_PAGE)
      if (!e.parts.every(ok)) {
        throw new HttpError(400, valid ? `Choose parts of ${option.title} that exist.` : `Pages run from 1 to ${MAX_PAGE}.`)
      }
      parts = [...new Set(e.parts as number[])].sort((a, b) => a - b)
      // Every part is the whole thing.
      if (valid && parts.length === valid.size) parts = null
    }
    return { kind, id, parts, title: option.title + partsLabel(kind, parts, option.parts ?? null) }
  })
}

// Lists -----------------------------------------------------------------------

interface ListRow {
  id: string
  side: Side
  updatedAt: Date
  submittedAt: Date | null
  submittedBy: string | null
  finalizedAt: Date | null
}

async function findLists(db: Db, matchupId: string) {
  const { rows } = await db.query<ListRow>(
    `SELECT l.id, l.side, l.updated_at AS "updatedAt", l.submitted_at AS "submittedAt", u.name AS "submittedBy",
            l.finalized_at AS "finalizedAt"
     FROM exhibit_lists l LEFT JOIN users u ON u.id = l.submitted_by
     WHERE l.matchup_id = $1`,
    [matchupId],
  )
  return { plaintiff: rows.find((r) => r.side === 'plaintiff') ?? null, defense: rows.find((r) => r.side === 'defense') ?? null }
}

async function listItems(db: Db, listId: string): Promise<(ListItem & { title: string })[]> {
  const { rows } = await db.query<{
    materialId: string | null
    interviewId: string | null
    reportId: string | null
    parts: number[] | null
    title: string
  }>(
    `SELECT material_id AS "materialId", interview_id AS "interviewId", report_id AS "reportId", parts, title
     FROM exhibit_list_items WHERE list_id = $1 ORDER BY position`,
    [listId],
  )
  return rows.map((r) => ({
    kind: r.materialId ? 'material' : r.interviewId ? 'deposition' : 'report',
    id: (r.materialId ?? r.interviewId ?? r.reportId)!,
    parts: r.parts,
    title: r.title,
  }))
}

/** Locks the case world for a change to its exhibits, so two moves can't cross. */
async function lockWorld(client: PoolClient, matchupId: string) {
  await client.query('SELECT 1 FROM matchups WHERE id = $1 FOR UPDATE', [matchupId])
}

async function inTransaction<T>(run: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await run(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function writeItems(client: PoolClient, listId: string, items: (ListItem & { title: string })[]) {
  await client.query('DELETE FROM exhibit_list_items WHERE list_id = $1', [listId])
  for (const [position, item] of items.entries()) {
    await client.query(
      `INSERT INTO exhibit_list_items (list_id, position, material_id, interview_id, report_id, parts, title)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        listId,
        position,
        item.kind === 'material' ? item.id : null,
        item.kind === 'deposition' ? item.id : null,
        item.kind === 'report' ? item.id : null,
        item.parts,
        item.title,
      ],
    )
  }
}

/** The team's list, made on first save. */
async function ensureList(client: PoolClient, team: ExhibitTeam) {
  const { rows } = await client.query<{ id: string; submittedAt: Date | null }>(
    `INSERT INTO exhibit_lists (case_id, matchup_id, side) VALUES ($1, $2, $3)
     ON CONFLICT (matchup_id, side) DO UPDATE SET side = EXCLUDED.side
     RETURNING id, submitted_at AS "submittedAt"`,
    [team.caseId, team.matchupId, team.side],
  )
  return rows[0]
}

/** Saves the team's draft list. */
export async function saveList(team: ExhibitTeam, body: unknown) {
  const items = readItems(body, await exhibitOptions(team))
  await inTransaction(async (client) => {
    await lockWorld(client, team.matchupId)
    const list = await ensureList(client, team)
    if (list.submittedAt) throw new HttpError(409, 'Your team already submitted its exhibit list.')
    await writeItems(client, list.id, items)
    await client.query('UPDATE exhibit_lists SET updated_at = now() WHERE id = $1', [list.id])
  })
}

/**
 * Submits the team's list (`{ items }`, saved first), which can't be undone.
 * If the other side has submitted too, the lists are exchanged.
 */
export async function submitList(team: ExhibitTeam, body: unknown) {
  const items = readItems(body, await exhibitOptions(team))
  await inTransaction(async (client) => {
    await lockWorld(client, team.matchupId)
    const list = await ensureList(client, team)
    if (list.submittedAt) throw new HttpError(409, 'Your team already submitted its exhibit list.')
    await writeItems(client, list.id, items)
    await client.query('UPDATE exhibit_lists SET updated_at = now(), submitted_at = now(), submitted_by = $2 WHERE id = $1', [
      list.id,
      team.userId,
    ])
    const lists = await findLists(client, team.matchupId)
    if (lists.plaintiff?.submittedAt && lists.defense?.submittedAt) await exchangeLists(client, team.caseId, team.matchupId)
  })
}

// The exchange ----------------------------------------------------------------

/** The overlap of two choices of parts (null is all of them), or [] for none. */
function overlap(a: number[] | null, b: number[] | null) {
  if (!a) return b
  if (!b) return a
  return a.filter((n) => b.includes(n))
}

const sameParts = (a: number[] | null, b: number[] | null) =>
  a === null || b === null ? a === b : a.length === b.length && a.every((n, i) => n === b[i])

/** The whole source a side listed: its title and parts, read from that side's team. */
async function sourceDetails(db: Db, caseId: string, item: ListItem) {
  if (item.kind === 'material') {
    const { rows } = await db.query<{ title: string }>(
      `SELECT coalesce(nullif(description, ''), filename) AS title FROM case_materials WHERE case_id = $1 AND id = $2`,
      [caseId, item.id],
    )
    return { title: rows[0]?.title ?? 'A case file', parts: null as Part[] | null }
  }
  if (item.kind === 'deposition') {
    const { rows } = await db.query<{ teamId: string }>('SELECT team_id AS "teamId" FROM interviews WHERE id = $1', [item.id])
    const found = (await teamDepositions(db, caseId, rows[0].teamId)).find((d) => d.id === item.id)!
    return { title: found.title, parts: found.parts }
  }
  const { rows } = await db.query<{ teamId: string }>('SELECT team_id AS "teamId" FROM interview_reviews WHERE id = $1', [item.id])
  const found = (await teamReports(db, caseId, rows[0].teamId)).find((r) => r.id === item.id)!
  return { title: found.title, parts: found.parts }
}

/**
 * Makes the world's exhibits from the two submitted lists. A source only one
 * side listed goes to the other side for authenticity. A source both listed
 * is authentic: the parts both chose are admitted at once (the plaintiff's),
 * and whatever more a side chose goes to the other side for admissibility.
 */
async function exchangeLists(client: PoolClient, caseId: string, matchupId: string) {
  const lists = await findLists(client, matchupId)
  const plaintiff = await listItems(client, lists.plaintiff!.id)
  const defense = await listItems(client, lists.defense!.id)
  const defenseByKey = new Map(defense.map((item, position) => [sourceKey(item), { item, position }]))
  const plaintiffKeys = new Set(plaintiff.map(sourceKey))

  async function insert(item: ListItem, parts: number[] | null, side: Side, position: number, status: ExhibitStatus, joint = false) {
    const source = await sourceDetails(client, caseId, item)
    const excerpt = source.parts ? pick(source.parts, parts) : null
    await client.query(
      `INSERT INTO exhibits (case_id, matchup_id, offered_by, joint, position, material_id, interview_id, report_id,
                             parts, title, snapshot, status, authenticated)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        caseId,
        matchupId,
        side,
        joint,
        position,
        item.kind === 'material' ? item.id : null,
        item.kind === 'deposition' ? item.id : null,
        item.kind === 'report' ? item.id : null,
        parts,
        source.title + partsLabel(item.kind, parts, source.parts),
        excerpt ? JSON.stringify(excerpt) : null,
        status,
        status !== 'awaiting_authenticity',
      ],
    )
  }

  for (const [position, item] of plaintiff.entries()) {
    const other = defenseByKey.get(sourceKey(item))
    if (!other) {
      await insert(item, item.parts, 'plaintiff', position, 'awaiting_authenticity')
      continue
    }
    const both = overlap(item.parts, other.item.parts)
    if (both === null || both.length > 0) await insert(item, both, 'plaintiff', position, 'admitted', true)
    // Whatever more each side chose is its own exhibit, already authentic.
    if (!sameParts(item.parts, both)) await insert(item, item.parts, 'plaintiff', position, 'awaiting_admission')
    if (!sameParts(other.item.parts, both)) await insert(other.item, other.item.parts, 'defense', other.position, 'awaiting_admission')
  }
  for (const [position, item] of defense.entries()) {
    if (!plaintiffKeys.has(sourceKey(item))) await insert(item, item.parts, 'defense', position, 'awaiting_authenticity')
  }
  await maybeFinalize(client, matchupId)
}

// Moves -----------------------------------------------------------------------

interface ExhibitRow {
  id: string
  caseId: string
  matchupId: string
  offeredBy: Side
  status: ExhibitStatus
}

async function lockExhibit(client: PoolClient, id: string) {
  const { rows } = await client.query<ExhibitRow>(
    `SELECT id, case_id AS "caseId", matchup_id AS "matchupId", offered_by AS "offeredBy", status
     FROM exhibits WHERE id = $1 FOR UPDATE`,
    [id],
  )
  return rows[0] ?? null
}

function readNote(body: unknown, key: string, required: string | null) {
  const value = (body as Record<string, unknown> | undefined)?.[key]
  const text = typeof value === 'string' ? value.trim() : ''
  if (required && !text) throw new HttpError(400, required)
  if (text.length > MAX_NOTE_LENGTH) throw new HttpError(400, `Keep it to ${MAX_NOTE_LENGTH} characters.`)
  return text || null
}

function readDecision<T extends string>(body: unknown, allowed: readonly T[]) {
  const decision = (body as Record<string, unknown> | undefined)?.decision as T
  if (!allowed.includes(decision)) throw new HttpError(400, `Choose ${allowed.join(' or ')}.`)
  return decision
}

/**
 * A team's move on an exhibit in its world: `authenticity` (agree or
 * challenge, with a note) and `admission` (admit or challenge, with an
 * objection) on the other side's; `response` (drop, or review with a
 * response and any redaction it accepts) on its own, once objected to.
 */
export async function teamMove(team: ExhibitTeam, exhibitId: string, step: 'authenticity' | 'admission' | 'response', body: unknown) {
  if (!isUuid(exhibitId)) throw new HttpError(404, 'Exhibit not found.')
  await inTransaction(async (client) => {
    await lockWorld(client, team.matchupId)
    const exhibit = await lockExhibit(client, exhibitId)
    if (!exhibit || exhibit.matchupId !== team.matchupId) throw new HttpError(404, 'Exhibit not found.')
    const theirs = exhibit.offeredBy !== team.side
    const set = (sql: string, params: unknown[]) =>
      client.query(`UPDATE exhibits SET ${sql}, updated_at = now() WHERE id = $1`, [exhibit.id, ...params])

    if (step === 'authenticity') {
      if (!theirs || exhibit.status !== 'awaiting_authenticity') throw new HttpError(409, "This exhibit isn't waiting on your team's view of its authenticity.")
      if (readDecision(body, ['agree', 'challenge'] as const) === 'agree') {
        await set(`status = 'awaiting_admission', authenticated = true`, [])
      } else {
        const note = readNote(body, 'note', 'Say why you challenge its authenticity.')
        await set(`status = 'authenticity_review', authenticity_note = $2`, [note])
      }
    } else if (step === 'admission') {
      if (!theirs || exhibit.status !== 'awaiting_admission') throw new HttpError(409, "This exhibit isn't waiting on your team's view of its admission.")
      if (readDecision(body, ['admit', 'challenge'] as const) === 'admit') {
        await admit(client, exhibit.id, '', [])
      } else {
        const objection = readNote(body, 'objection', 'Write your objection.')
        await set(`status = 'objection_response', objection = $2`, [objection])
      }
    } else {
      if (theirs || exhibit.status !== 'objection_response') throw new HttpError(409, 'This exhibit has no objection waiting on your team.')
      if (readDecision(body, ['drop', 'review'] as const) === 'drop') {
        await set(`status = 'dropped'`, [])
      } else {
        const response = readNote(body, 'response', 'Write your response to the objection.')
        const accepts = readNote(body, 'acceptsRedaction', null)
        await set(`status = 'admission_review', response = $2, accepts_redaction = $3`, [response, accepts])
      }
    }
    await maybeFinalize(client, team.matchupId)
  })
}

/**
 * Admits an exhibit. An admitted exhibit takes the place of any smaller one
 * already admitted from the same source (a whole report after its excerpt),
 * and gives way to a larger one.
 */
async function admit(client: PoolClient, id: string, extra: string, params: unknown[]) {
  await client.query(`UPDATE exhibits SET status = 'admitted', authenticated = true${extra}, updated_at = now() WHERE id = $1`, [
    id,
    ...params,
  ])
  const { rows } = await client.query<{ id: string; parts: number[] | null; joint: boolean }>(
    `SELECT o.id, o.parts, o.joint FROM exhibits x
     JOIN exhibits o ON o.matchup_id = x.matchup_id AND o.status = 'admitted'
      AND o.material_id IS NOT DISTINCT FROM x.material_id AND o.interview_id IS NOT DISTINCT FROM x.interview_id
      AND o.report_id IS NOT DISTINCT FROM x.report_id
     WHERE x.id = $1
     ORDER BY o.joint DESC, o.position`,
    [id],
  )
  const covers = (a: number[] | null, b: number[] | null) => a === null || (b !== null && b.every((n) => a.includes(n)))
  const size = (p: number[] | null) => (p === null ? Infinity : p.length)
  for (const row of rows) {
    // The largest admitted exhibit that covers this one, if any (not itself).
    const by = rows
      .filter((o) => o.id !== row.id && covers(o.parts, row.parts) && (size(o.parts) > size(row.parts) || (!row.joint && o.joint)))
      .sort((a, b) => size(b.parts) - size(a.parts))[0]
    await client.query('UPDATE exhibits SET superseded_by = $2 WHERE id = $1', [row.id, by?.id ?? null])
  }
}

/** The instructor's ruling on an authenticity challenge: `{ decision: authenticate | reject, note }`. */
export async function ruleOnAuthenticity(courseId: string, exhibitId: string, userId: string, body: unknown) {
  if (!isUuid(exhibitId)) throw new HttpError(404, 'Exhibit not found.')
  return inTransaction(async (client) => {
    const exhibit = await courseExhibit(client, courseId, exhibitId)
    if (exhibit.status !== 'authenticity_review') throw new HttpError(409, 'This exhibit has no authenticity challenge waiting.')
    const decision = readDecision(body, ['authenticate', 'reject'] as const)
    const note = readNote(body, 'note', null)
    await client.query(
      `UPDATE exhibits SET status = $2, authenticated = $3, authenticity_ruling = $4, authenticity_ruling_note = $5,
         ruled_by = $6, ruled_at = now(), updated_at = now()
       WHERE id = $1`,
      [
        exhibit.id,
        decision === 'authenticate' ? 'awaiting_admission' : 'inauthentic',
        decision === 'authenticate',
        decision === 'authenticate' ? 'authenticated' : 'inauthentic',
        note,
        userId,
      ],
    )
    await maybeFinalize(client, exhibit.matchupId)
    return exhibit.id
  })
}

/**
 * The instructor's ruling on an objection: `{ decision: overrule | sustain |
 * partial, redaction, note }`. A partial admission can carry the instructor's
 * `marks` on the exhibit (see exhibitFiles.ts): for a PDF or picture, with the
 * `uploadKey` of the redacted copy their browser made; for text, the server
 * blacks it out. With marks, the written `redaction` is optional.
 */
export async function ruleOnAdmission(courseId: string, exhibitId: string, userId: string, body: unknown) {
  if (!isUuid(exhibitId)) throw new HttpError(404, 'Exhibit not found.')
  return inTransaction(async (client) => {
    const exhibit = await courseExhibit(client, courseId, exhibitId)
    if (exhibit.status !== 'admission_review') throw new HttpError(409, 'This exhibit has no objection waiting for a ruling.')
    const decision = readDecision(body, ['overrule', 'sustain', 'partial'] as const)
    const note = readNote(body, 'note', null)
    const rawMarks = (body as Record<string, unknown> | undefined)?.marks
    const redacted = decision === 'partial' && rawMarks != null ? await readRedaction(client, courseId, exhibit.id, body) : null
    const redaction = decision === 'partial' ? readNote(body, 'redaction', redacted ? null : 'Say which part is redacted.') : null
    const ruling = decision === 'overrule' ? 'overruled' : decision === 'sustain' ? 'sustained' : 'partial'
    if (decision === 'sustain') {
      await client.query(
        `UPDATE exhibits SET status = 'excluded', ruling = $2, ruling_note = $3, ruled_by = $4, ruled_at = now(), updated_at = now()
         WHERE id = $1`,
        [exhibit.id, ruling, note, userId],
      )
    } else {
      await admit(
        client,
        exhibit.id,
        `, ruling = $2, ruling_note = $3, redaction = $4, ruled_by = $5, ruled_at = now(),
         redaction_marks = $6, admitted_key = $7, admitted_content_type = $8, admitted_excerpt = $9`,
        [
          ruling,
          note,
          redaction,
          userId,
          redacted ? JSON.stringify(redacted.marks) : null,
          redacted?.key ?? null,
          redacted?.contentType ?? null,
          redacted?.excerpt ? JSON.stringify(redacted.excerpt) : null,
        ],
      )
    }
    await maybeFinalize(client, exhibit.matchupId)
    return exhibit.id
  })
}

/** Reads the instructor's marks for a partial admission, and makes the redacted version. */
async function readRedaction(client: PoolClient, courseId: string, exhibitId: string, body: unknown) {
  const { marks: raw, uploadKey } = body as Record<string, unknown>
  const source = await findExhibitSource(exhibitId, { courseId }, client)
  const kind = markable(source)
  if (!kind) throw new HttpError(400, "This exhibit can't be marked. Describe the redaction instead.")
  if (kind === 'text') {
    const parts = textParts(source)
    const marks = readTextMarks(raw, parts)
    return { marks, excerpt: redactText(parts, marks), key: null, contentType: null }
  }
  const pageCount = kind === 'image' ? 1 : await exhibitPageCount(source)
  const marks = readPageMarks(raw, pageCount)
  const key = await keepRedactedFile(source, kind, uploadKey, keptPages(marks, pageCount).length)
  return { marks, excerpt: null, key, contentType: redactedType(kind) }
}

/** An exhibit in one of the instructor's cases, locked. */
async function courseExhibit(client: PoolClient, courseId: string, exhibitId: string) {
  const exhibit = await lockExhibit(client, exhibitId)
  const { rows } = exhibit
    ? await client.query('SELECT 1 FROM cases WHERE id = $1 AND course_id = $2', [exhibit.caseId, courseId])
    : { rows: [] }
  if (!exhibit || rows.length === 0) throw new HttpError(404, 'Exhibit not found.')
  await lockWorld(client, exhibit.matchupId)
  return exhibit
}

/**
 * Once both lists are in and no exhibit is waiting on anyone, the list is
 * final: the plaintiff's admitted exhibits (joint ones first) are numbered
 * and the defense's lettered, each in list order. Superseded excerpts get no
 * label.
 */
async function maybeFinalize(client: PoolClient, matchupId: string) {
  const lists = await findLists(client, matchupId)
  if (!lists.plaintiff?.submittedAt || !lists.defense?.submittedAt || lists.plaintiff.finalizedAt) return
  const { rows: open } = await client.query('SELECT 1 FROM exhibits WHERE matchup_id = $1 AND status = ANY($2) LIMIT 1', [
    matchupId,
    OPEN_STATUSES,
  ])
  if (open.length > 0) return
  for (const side of ['plaintiff', 'defense'] as const) {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM exhibits
       WHERE matchup_id = $1 AND offered_by = $2 AND status = 'admitted' AND superseded_by IS NULL
       ORDER BY joint DESC, position, id`,
      [matchupId, side],
    )
    for (const [i, row] of rows.entries()) {
      await client.query('UPDATE exhibits SET label = $2 WHERE id = $1', [row.id, side === 'plaintiff' ? String(i + 1) : worldLetter(i + 1)])
    }
  }
  await client.query('UPDATE exhibit_lists SET finalized_at = now() WHERE matchup_id = $1', [matchupId])
}

// Reading ---------------------------------------------------------------------

const EXHIBIT_COLUMNS = `x.id, x.offered_by AS "offeredBy", x.joint, x.position,
  CASE WHEN x.material_id IS NOT NULL THEN 'material' WHEN x.interview_id IS NOT NULL THEN 'deposition' ELSE 'report' END AS kind,
  coalesce(x.material_id, x.interview_id, x.report_id) AS "sourceId", x.parts, x.title,
  coalesce(x.admitted_excerpt, x.snapshot) AS excerpt, x.redaction_marks IS NOT NULL AS redacted,
  (SELECT m.content_type FROM case_materials m WHERE m.id = x.material_id) AS "contentType",
  x.status, x.authenticated, x.authenticity_note AS "authenticityNote", x.authenticity_ruling AS "authenticityRuling",
  x.authenticity_ruling_note AS "authenticityRulingNote", x.objection, x.response, x.accepts_redaction AS "acceptsRedaction",
  x.ruling, x.ruling_note AS "rulingNote", x.redaction, x.superseded_by AS "supersededBy", x.label,
  x.updated_at AS "updatedAt", x.ruled_at AS "ruledAt"`

/** The plaintiff's first (joint ones leading), then the defense's, each in list order. */
async function worldExhibits(db: Db, matchupId: string) {
  const { rows } = await db.query<Exhibit>(
    `SELECT ${EXHIBIT_COLUMNS} FROM exhibits x WHERE x.matchup_id = $1
     ORDER BY x.offered_by = 'defense', x.joint DESC, x.position, x.id`,
    [matchupId],
  )
  return rows
}

async function describeList(db: Db, row: ListRow | null, side: Side): Promise<ExhibitList> {
  if (!row) return { side, items: [], updatedAt: null, submittedAt: null, submittedBy: null }
  return { side, items: await listItems(db, row.id), updatedAt: row.updatedAt, submittedAt: row.submittedAt, submittedBy: row.submittedBy }
}

/** What changed since the student last looked. Matches `ExhibitNotices` in src/courses/types.ts. */
export interface ExhibitNotices {
  /** Both lists are in, and the other side's exhibits are here to review. */
  exchanged: boolean
  /** The other side objected to this many of the team's exhibits. */
  objections: number
  /** The instructor ruled on this many exhibits in the world. */
  rulings: number
  /** The joint exhibit list is final. */
  finalized: boolean
}

/** Everything a student's team sees. Matches `StudentExhibits` in src/courses/types.ts. */
export interface StudentExhibits {
  side: Side
  options: ExhibitOption[]
  mine: ExhibitList
  /** The other side's list: whether it's in, and once both are, what's on it. */
  theirs: ExhibitList
  exhibits: Exhibit[]
  finalizedAt: Date | null
  notices: ExhibitNotices
}

export async function getStudentExhibits(team: ExhibitTeam): Promise<StudentExhibits> {
  const [options, lists, exhibits, seen] = await Promise.all([
    exhibitOptions(team),
    findLists(pool, team.matchupId),
    worldExhibits(pool, team.matchupId),
    pool.query<{ seenAt: Date }>('SELECT seen_at AS "seenAt" FROM exhibit_seen WHERE matchup_id = $1 AND user_id = $2', [
      team.matchupId,
      team.userId,
    ]),
  ])
  const mineRow = lists[team.side]
  const theirsRow = lists[otherSide(team.side)]
  const exchanged = Boolean(mineRow?.submittedAt && theirsRow?.submittedAt)
  const theirs = await describeList(pool, theirsRow, otherSide(team.side))
  const seenAt = seen.rows[0]?.seenAt ?? new Date(0)
  const after = (d: Date | null) => d !== null && d > seenAt
  return {
    side: team.side,
    options,
    mine: await describeList(pool, mineRow, team.side),
    // Until both are in, only whether the other side has submitted.
    theirs: exchanged ? theirs : { ...theirs, items: [] },
    exhibits,
    finalizedAt: mineRow?.finalizedAt ?? null,
    notices: {
      exchanged: exchanged && after(mineRow!.submittedAt! > theirsRow!.submittedAt! ? mineRow!.submittedAt : theirsRow!.submittedAt),
      objections: exhibits.filter((x) => x.offeredBy === team.side && x.status === 'objection_response' && after(x.updatedAt)).length,
      rulings: exhibits.filter((x) => after(x.ruledAt)).length,
      finalized: after(mineRow?.finalizedAt ?? null),
    },
  }
}

/** Marks the world's exhibits as read by this student. */
export async function markExhibitsSeen(team: ExhibitTeam) {
  await pool.query(
    `INSERT INTO exhibit_seen (matchup_id, user_id) VALUES ($1, $2)
     ON CONFLICT (matchup_id, user_id) DO UPDATE SET seen_at = now()`,
    [team.matchupId, team.userId],
  )
}

// The instructor --------------------------------------------------------------

/** One world's lists and exhibits, for the instructor's read-only view. Matches `WorldExhibits` in src/courses/types.ts. */
export interface WorldExhibits {
  matchupId: string
  worldNumber: number
  teams: { plaintiff: number | null; defense: number | null }
  plaintiff: ExhibitList
  defense: ExhibitList
  exhibits: Exhibit[]
  finalizedAt: Date | null
}

export async function listCaseExhibits(caseId: string): Promise<WorldExhibits[]> {
  const { rows } = await pool.query<{ id: string; number: number; plaintiff: number | null; defense: number | null }>(
    `SELECT mu.id, mu.number,
            (SELECT t.number FROM matchup_teams mt JOIN teams t ON t.id = mt.team_id WHERE mt.matchup_id = mu.id AND mt.side = 'plaintiff') AS plaintiff,
            (SELECT t.number FROM matchup_teams mt JOIN teams t ON t.id = mt.team_id WHERE mt.matchup_id = mu.id AND mt.side = 'defense') AS defense
     FROM matchups mu WHERE mu.case_id = $1 ORDER BY mu.number`,
    [caseId],
  )
  return Promise.all(
    rows.map(async (w) => {
      const lists = await findLists(pool, w.id)
      return {
        matchupId: w.id,
        worldNumber: w.number,
        teams: { plaintiff: w.plaintiff, defense: w.defense },
        plaintiff: await describeList(pool, lists.plaintiff, 'plaintiff'),
        defense: await describeList(pool, lists.defense, 'defense'),
        exhibits: await worldExhibits(pool, w.id),
        finalizedAt: lists.plaintiff?.finalizedAt ?? null,
      }
    }),
  )
}

/** For the case dashboard. Matches `ExhibitOverview` in src/courses/types.ts. */
export async function exhibitOverview(caseId: string) {
  const { rows } = await pool.query<{ teams: number; teamsSubmitted: number; worlds: number; worldsFinalized: number; reviewsWaiting: number }>(
    `SELECT (SELECT count(*)::int FROM matchup_teams WHERE case_id = $1) AS teams,
            (SELECT count(*)::int FROM exhibit_lists WHERE case_id = $1 AND submitted_at IS NOT NULL) AS "teamsSubmitted",
            (SELECT count(*)::int FROM matchups mu WHERE mu.case_id = $1
               AND (SELECT count(*) FROM matchup_teams mt WHERE mt.matchup_id = mu.id) = 2) AS worlds,
            (SELECT count(DISTINCT matchup_id)::int FROM exhibit_lists WHERE case_id = $1 AND finalized_at IS NOT NULL) AS "worldsFinalized",
            (SELECT count(*)::int FROM exhibits WHERE case_id = $1
               AND status IN ('authenticity_review', 'admission_review')) AS "reviewsWaiting"`,
    [caseId],
  )
  return rows[0]
}

/** A challenge for the instructor to rule on. Matches `ExhibitReview` in src/courses/types.ts. */
export interface ExhibitReview extends Exhibit {
  caseId: string
  caseTitle: string
  worldNumber: number
  teams: { plaintiff: number | null; defense: number | null }
  ruledBy: string | null
}

/** Open: challenges waiting for a ruling. Completed: exhibits the instructor ruled on, newest first. */
export async function listExhibitReviews(courseId: string, which: 'open' | 'completed') {
  const { rows } = await pool.query<ExhibitReview>(
    `SELECT ${EXHIBIT_COLUMNS}, c.id AS "caseId", c.title AS "caseTitle", mu.number AS "worldNumber",
            json_build_object(
              'plaintiff', (SELECT t.number FROM matchup_teams mt JOIN teams t ON t.id = mt.team_id WHERE mt.matchup_id = mu.id AND mt.side = 'plaintiff'),
              'defense', (SELECT t.number FROM matchup_teams mt JOIN teams t ON t.id = mt.team_id WHERE mt.matchup_id = mu.id AND mt.side = 'defense')) AS teams,
            u.name AS "ruledBy"
     FROM exhibits x
     JOIN cases c ON c.id = x.case_id
     JOIN matchups mu ON mu.id = x.matchup_id
     LEFT JOIN users u ON u.id = x.ruled_by
     WHERE c.course_id = $1 AND ${
       which === 'open' ? `x.status IN ('authenticity_review', 'admission_review')` : 'x.ruled_at IS NOT NULL'
     }
     ORDER BY ${which === 'open' ? 'x.updated_at' : 'x.ruled_at DESC'}`,
    [courseId],
  )
  return rows
}

/** How many challenges in the course wait for the instructor. */
export async function openExhibitReviewCount(courseId: string) {
  const { rows } = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM exhibits x JOIN cases c ON c.id = x.case_id
     WHERE c.course_id = $1 AND x.status IN ('authenticity_review', 'admission_review')`,
    [courseId],
  )
  return rows[0].count
}
