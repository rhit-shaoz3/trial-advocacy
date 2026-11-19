import type { PoolClient } from 'pg'
import { pool } from '../db/pool.ts'
import { HttpError } from '../httpError.ts'
import { isUuid } from '../validation.ts'
import type { Side } from '../courses/matchups.ts'
import { exhibitOptions, partsLabel, MAX_PAGE, type Part } from '../exhibits/exhibits.ts'
import { splitParagraphs } from '../exhibits/exhibitFiles.ts'

// A team's case planner. The team lists the facts it must prove (cards with
// no parent are the facts of consequence; cards under them are sub-facts),
// backs each with evidence (a file, interview or report, whole or in part)
// and the witnesses it means to call, names the gaps it still has, and ranks
// the tools it would use to fill each one. Each piece is its own row, so
// teammates working on different cards don't overwrite each other; the last
// save of one field wins.

type Db = Pick<PoolClient, 'query'>

export const PLANNER_TOOLS = [
  'interview',
  'client',
  'investigator',
  'deposition',
  'subpoena',
  'interrogatories',
  'rfas',
  'document_request',
] as const
export type PlannerTool = (typeof PLANNER_TOOLS)[number]

export const EVIDENCE_KINDS = ['material', 'interview', 'report'] as const
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]

export const MAX_TITLE_LENGTH = 300
export const MAX_TEXT_LENGTH = 4000
export const MAX_CARDS = 200
export const MAX_GAPS = 200
export const MAX_EVIDENCE = 50

/** The student's team in its case world. */
export interface PlannerTeam {
  caseId: string
  teamId: string
  matchupId: string
  side: Side
  userId: string
}

// Shapes sent to the client; they match the Planner types in src/courses/types.ts.
export interface PlannerEvidence {
  id: string
  kind: EvidenceKind
  sourceId: string
  /** The pages, turns or paragraphs chosen; null for the whole thing. */
  parts: number[] | null
  /** The source's title, with the parts (" — pages 3–5"). */
  title: string
  excerpt: string
  note: string
}

export interface PlannerCard {
  id: string
  parentId: string | null
  title: string
  notes: string
  position: number
  evidence: PlannerEvidence[]
  witnessIds: string[]
  updatedBy: string | null
  updatedAt: Date
}

export interface PlannerGapTool {
  tool: PlannerTool
  /** 1 is the team's first choice. */
  priority: number
  reason: string
  specifics: string
  witnessId: string | null
}

export interface PlannerGap {
  id: string
  cardId: string | null
  description: string
  position: number
  tools: PlannerGapTool[]
  updatedBy: string | null
  updatedAt: Date
}

export interface PlannerChart {
  cards: PlannerCard[]
  gaps: PlannerGap[]
}

/** Something the team can cite: a case file it can see, one of its interviews, or a report it got. */
export interface PlannerSource {
  kind: EvidenceKind
  id: string
  title: string
  group: 'case-file' | 'investigator' | 'interviews' | 'reports'
  contentType?: string
  filename?: string
  /** A transcript's turns or a text's paragraphs to choose from; a PDF's parts are its pages. */
  parts?: Part[]
  /** A PDF, whose parts are page numbers. */
  paged?: boolean
}

const shortDay = (date: Date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** The team's interviews with at least one answer: of its own witnesses, and depositions of the other side's. */
async function teamInterviews(db: Db, team: PlannerTeam): Promise<PlannerSource[]> {
  const { rows } = await db.query<{ id: string; name: string; theirs: boolean; createdAt: Date; turns: Part[] }>(
    `SELECT i.id, w.name, (w.aligned_side IS NOT NULL AND w.aligned_side <> i.side) AS theirs, i.created_at AS "createdAt",
            json_agg(json_build_object('n', t.position, 'question', t.question, 'objection', t.objection,
                                       'text', t.answer) ORDER BY t.position) AS turns
     FROM interviews i
     JOIN case_witnesses w ON w.id = i.witness_id
     JOIN interview_turns t ON t.interview_id = i.id
     WHERE w.case_id = $1 AND i.team_id = $2
     GROUP BY i.id, w.name, w.aligned_side
     ORDER BY i.created_at`,
    [team.caseId, team.teamId],
  )
  return rows.map((r) => ({
    kind: 'interview',
    id: r.id,
    title: `${r.theirs ? 'Deposition' : 'Interview'} of ${r.name} (${shortDay(r.createdAt)})`,
    group: 'interviews',
    parts: r.turns,
  }))
}

/** The investigator's reports and the clients' replies that reached the team, by paragraph. */
async function teamReports(db: Db, team: PlannerTeam): Promise<PlannerSource[]> {
  const { rows } = await db.query<{ id: string; kind: string; report: string; at: Date; name: string; subject: string | null }>(
    `SELECT r.id, r.kind, r.final_report AS report, coalesce(r.completed_at, r.created_at) AS at,
            c.investigator_name AS name, r.subject
     FROM interview_reviews r JOIN cases c ON c.id = r.case_id
     WHERE r.case_id = $1 AND r.team_id = $2 AND r.kind IN ('investigation', 'client_email') AND r.status = 'completed'
       AND r.final_report IS NOT NULL
     ORDER BY r.created_at`,
    [team.caseId, team.teamId],
  )
  return rows.map((r) => ({
    kind: 'report',
    id: r.id,
    title:
      r.kind === 'investigation'
        ? `${r.name}'s report (${shortDay(r.at)})`
        : `Client's reply: ${r.subject || 'no subject'} (${shortDay(r.at)})`,
    group: 'reports',
    parts: splitParagraphs(r.report).map((text, n) => ({ n, text })),
  }))
}

/** Everything the team can cite on its planner. */
export async function plannerSources(team: PlannerTeam, db: Db = pool): Promise<PlannerSource[]> {
  const [options, interviews, reports] = await Promise.all([
    exhibitOptions({ ...team }, db),
    teamInterviews(db, team),
    teamReports(db, team),
  ])
  const files = options
    .filter((o) => o.kind === 'material')
    .map(
      (o): PlannerSource => ({
        kind: 'material',
        id: o.id,
        title: o.title,
        group: o.group === 'investigator' ? 'investigator' : 'case-file',
        contentType: o.contentType,
        filename: o.filename,
        ...(o.parts && { parts: o.parts }),
        ...(o.markable === 'pdf' && !o.parts && { paged: true }),
      }),
    )
  return [...files, ...interviews, ...reports]
}

// Reading the chart ------------------------------------------------------------

/** The team's chart: its cards (each with evidence and witnesses) and gaps (each with tools), in order. */
export async function loadChart(team: Pick<PlannerTeam, 'caseId' | 'teamId'>, db: Db = pool): Promise<PlannerChart> {
  const [cards, evidence, witnesses, gaps, tools] = await Promise.all([
    db.query<Omit<PlannerCard, 'evidence' | 'witnessIds'>>(
      `SELECT c.id, c.parent_id AS "parentId", c.title, c.notes, c.position, u.name AS "updatedBy", c.updated_at AS "updatedAt"
       FROM planner_cards c LEFT JOIN users u ON u.id = c.updated_by
       WHERE c.case_id = $1 AND c.team_id = $2
       ORDER BY c.position, c.created_at`,
      [team.caseId, team.teamId],
    ),
    db.query<PlannerEvidence & { cardId: string }>(
      `SELECT e.id, e.card_id AS "cardId", e.source_kind AS kind, coalesce(e.material_id, e.interview_id, e.report_id) AS "sourceId",
              e.parts, e.title, e.excerpt, e.note
       FROM planner_evidence e
       JOIN planner_cards c ON c.id = e.card_id
       WHERE c.case_id = $1 AND c.team_id = $2
       ORDER BY e.position, e.created_at`,
      [team.caseId, team.teamId],
    ),
    db.query<{ cardId: string; witnessId: string }>(
      `SELECT cw.card_id AS "cardId", cw.witness_id AS "witnessId"
       FROM planner_card_witnesses cw JOIN planner_cards c ON c.id = cw.card_id
       JOIN case_witnesses w ON w.id = cw.witness_id
       WHERE c.case_id = $1 AND c.team_id = $2
       ORDER BY w.created_at`,
      [team.caseId, team.teamId],
    ),
    db.query<Omit<PlannerGap, 'tools'>>(
      `SELECT g.id, g.card_id AS "cardId", g.description, g.position, u.name AS "updatedBy", g.updated_at AS "updatedAt"
       FROM planner_gaps g LEFT JOIN users u ON u.id = g.updated_by
       WHERE g.case_id = $1 AND g.team_id = $2
       ORDER BY g.position, g.created_at`,
      [team.caseId, team.teamId],
    ),
    db.query<PlannerGapTool & { gapId: string }>(
      `SELECT t.gap_id AS "gapId", t.tool, t.priority, t.reason, t.specifics, t.witness_id AS "witnessId"
       FROM planner_gap_tools t JOIN planner_gaps g ON g.id = t.gap_id
       WHERE g.case_id = $1 AND g.team_id = $2
       ORDER BY t.priority`,
      [team.caseId, team.teamId],
    ),
  ])
  const evidenceBy = groupBy(evidence.rows, (e) => e.cardId)
  const witnessesBy = groupBy(witnesses.rows, (w) => w.cardId)
  const toolsBy = groupBy(tools.rows, (t) => t.gapId)
  return {
    cards: cards.rows.map((c) => ({
      ...c,
      evidence: (evidenceBy.get(c.id) ?? []).map((e) => ({
        id: e.id,
        kind: e.kind,
        sourceId: e.sourceId,
        parts: e.parts,
        title: e.title,
        excerpt: e.excerpt,
        note: e.note,
      })),
      witnessIds: (witnessesBy.get(c.id) ?? []).map((w) => w.witnessId),
    })),
    gaps: gaps.rows.map((g) => ({
      ...g,
      tools: (toolsBy.get(g.id) ?? []).map((t) => ({
        tool: t.tool,
        priority: t.priority,
        reason: t.reason,
        specifics: t.specifics,
        witnessId: t.witnessId,
      })),
    })),
  }
}

function groupBy<T>(rows: T[], key: (row: T) => string) {
  const map = new Map<string, T[]>()
  for (const row of rows) map.set(key(row), [...(map.get(key(row)) ?? []), row])
  return map
}

// Reading requests -------------------------------------------------------------

/** A text field from the body, trimmed and capped; undefined when it's left out. */
function text(body: unknown, key: string, max: number, what: string): string | undefined {
  const value = (body as Record<string, unknown> | undefined)?.[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new HttpError(400, `Write ${what} as text.`)
  if (value.length > max) throw new HttpError(400, `Keep ${what} to ${max} characters.`)
  return value
}

/** A witness the team can see in this case, or null. */
async function readWitnessId(db: Db, caseId: string, raw: unknown): Promise<string | null> {
  if (raw === null || raw === undefined || raw === '') return null
  if (!isUuid(raw)) throw new HttpError(400, 'Choose a witness from this case.')
  const { rows } = await db.query('SELECT 1 FROM case_witnesses WHERE id = $1 AND case_id = $2 AND NOT hidden', [raw, caseId])
  if (!rows[0]) throw new HttpError(400, 'Choose a witness from this case.')
  return raw
}

async function inTransaction<T>(team: PlannerTeam, work: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // One change to the team's planner at a time, so positions stay in order.
    await client.query('SELECT 1 FROM teams WHERE id = $1 FOR UPDATE', [team.teamId])
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function requireCard(db: Db, team: PlannerTeam, cardId: string) {
  if (!isUuid(cardId)) throw new HttpError(404, 'That card is gone. A teammate may have deleted it.')
  const { rows } = await db.query<{ id: string; parentId: string | null }>(
    'SELECT id, parent_id AS "parentId" FROM planner_cards WHERE id = $1 AND case_id = $2 AND team_id = $3',
    [cardId, team.caseId, team.teamId],
  )
  if (!rows[0]) throw new HttpError(404, 'That card is gone. A teammate may have deleted it.')
  return rows[0]
}

async function requireGap(db: Db, team: PlannerTeam, gapId: string) {
  if (!isUuid(gapId)) throw new HttpError(404, 'That gap is gone. A teammate may have deleted it.')
  const { rows } = await db.query('SELECT id FROM planner_gaps WHERE id = $1 AND case_id = $2 AND team_id = $3', [
    gapId,
    team.caseId,
    team.teamId,
  ])
  if (!rows[0]) throw new HttpError(404, 'That gap is gone. A teammate may have deleted it.')
}

// Cards --------------------------------------------------------------------------

/** Adds a card `{ parentId?, title, notes? }` at the end of its siblings. Returns its id. */
export async function createCard(team: PlannerTeam, body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>
  return inTransaction(team, async (db) => {
    const parentId = b.parentId === null || b.parentId === undefined ? null : (await requireCard(db, team, String(b.parentId))).id
    const { rows: count } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM planner_cards WHERE team_id = $1 AND case_id = $2', [
      team.teamId,
      team.caseId,
    ])
    if (count[0].n >= MAX_CARDS) throw new HttpError(409, `A planner can have at most ${MAX_CARDS} cards.`)
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO planner_cards (case_id, team_id, parent_id, title, notes, position, updated_by)
       VALUES ($1, $2, $3, $4, $5,
               (SELECT coalesce(max(position) + 1, 0) FROM planner_cards
                WHERE team_id = $2 AND case_id = $1 AND parent_id IS NOT DISTINCT FROM $3), $6)
       RETURNING id`,
      [
        team.caseId,
        team.teamId,
        parentId,
        text(b, 'title', MAX_TITLE_LENGTH, 'the card') ?? '',
        text(b, 'notes', MAX_TEXT_LENGTH, 'the notes') ?? '',
        team.userId,
      ],
    )
    return rows[0].id
  })
}

/**
 * Changes a card's `{ title?, notes? }`, or moves it (as it's dragged):
 * `{ move: { parentId, index } }` puts it under another card (null for a fact
 * of consequence) at that place among its new siblings. A card can't go
 * under itself or one of its own sub-facts. `{ move: 'up' | 'down' }` moves
 * it one place among its siblings.
 */
export async function updateCard(team: PlannerTeam, cardId: string, body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>
  await inTransaction(team, async (db) => {
    const card = await requireCard(db, team, cardId)
    const title = text(b, 'title', MAX_TITLE_LENGTH, 'the card')
    const notes = text(b, 'notes', MAX_TEXT_LENGTH, 'the notes')
    if (title !== undefined || notes !== undefined) {
      await db.query(
        `UPDATE planner_cards SET title = coalesce($2, title), notes = coalesce($3, notes), updated_by = $4, updated_at = now()
         WHERE id = $1`,
        [card.id, title ?? null, notes ?? null, team.userId],
      )
    }
    const siblingsOf = async (parentId: string | null) =>
      (
        await db.query<{ id: string }>(
          `SELECT id FROM planner_cards WHERE team_id = $1 AND case_id = $2 AND parent_id IS NOT DISTINCT FROM $3
           ORDER BY position, created_at`,
          [team.teamId, team.caseId, parentId],
        )
      ).rows.map((s) => s.id)
    if (b.move === 'up' || b.move === 'down') {
      await reorder(db, 'planner_cards', await siblingsOf(card.parentId), card.id, b.move)
    } else if (b.move && typeof b.move === 'object') {
      const m = b.move as Record<string, unknown>
      const parentId = m.parentId === null || m.parentId === undefined ? null : (await requireCard(db, team, String(m.parentId))).id
      if (parentId) {
        // Walk up from the new parent: reaching the card means it would go under itself.
        const { rows } = await db.query<{ id: string }>(
          `WITH RECURSIVE up AS (SELECT id, parent_id FROM planner_cards WHERE id = $1
             UNION ALL SELECT c.id, c.parent_id FROM planner_cards c JOIN up ON c.id = up.parent_id)
           SELECT id FROM up WHERE id = $2`,
          [parentId, card.id],
        )
        if (rows[0]) throw new HttpError(400, 'A card can’t go under itself or one of its own sub-facts.')
      }
      const index = Number.isInteger(m.index) ? (m.index as number) : Number.MAX_SAFE_INTEGER
      const stayed = (await siblingsOf(parentId)).filter((id) => id !== card.id)
      const order = [...stayed.slice(0, Math.max(0, index)), card.id, ...stayed.slice(Math.max(0, index))]
      await db.query('UPDATE planner_cards SET parent_id = $2, updated_by = $3, updated_at = now() WHERE id = $1', [
        card.id,
        parentId,
        team.userId,
      ])
      await writePositions(db, 'planner_cards', order)
      if (card.parentId !== parentId) await writePositions(db, 'planner_cards', await siblingsOf(card.parentId))
    }
  })
}

/** Deletes a card and its sub-facts; their gaps stay, about the case as a whole. */
export async function deleteCard(team: PlannerTeam, cardId: string) {
  await inTransaction(team, async (db) => {
    await requireCard(db, team, cardId)
    await db.query('DELETE FROM planner_cards WHERE id = $1', [cardId])
  })
}

/** Moves `id` one place in `ids` and writes every position. */
async function reorder(db: Db, table: 'planner_cards' | 'planner_gaps', ids: string[], id: string, move: 'up' | 'down') {
  const at = ids.indexOf(id)
  const to = move === 'up' ? at - 1 : at + 1
  if (at < 0 || to < 0 || to >= ids.length) return
  ;[ids[at], ids[to]] = [ids[to], ids[at]]
  await writePositions(db, table, ids)
}

/** Numbers `ids` in order. */
async function writePositions(db: Db, table: 'planner_cards' | 'planner_gaps', ids: string[]) {
  await db.query(`UPDATE ${table} t SET position = o.position FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id, position) WHERE t.id = o.id`, [ids])
}

/** Replaces the witnesses tagged on a card: `{ witnessIds }`. */
export async function setCardWitnesses(team: PlannerTeam, cardId: string, body: unknown) {
  const raw = (body as Record<string, unknown> | undefined)?.witnessIds
  if (!Array.isArray(raw)) throw new HttpError(400, 'Send the witnesses as a list.')
  await inTransaction(team, async (db) => {
    await requireCard(db, team, cardId)
    const ids = [...new Set(await Promise.all(raw.map((id) => readWitnessId(db, team.caseId, id))))].filter((id): id is string => id !== null)
    await db.query('DELETE FROM planner_card_witnesses WHERE card_id = $1', [cardId])
    await db.query('INSERT INTO planner_card_witnesses (card_id, witness_id) SELECT $1, unnest($2::uuid[])', [cardId, ids])
    await db.query('UPDATE planner_cards SET updated_by = $2, updated_at = now() WHERE id = $1', [cardId, team.userId])
  })
}

// Evidence -----------------------------------------------------------------------

/** The parts of `source` that `raw` names: null for the whole thing. Checked like an exhibit list's. */
function readParts(raw: unknown, source: PlannerSource): number[] | null {
  if (raw === null || raw === undefined) return null
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpError(400, `Choose at least one part of ${source.title}.`)
  const valid = source.parts ? new Set(source.parts.map((p) => p.n)) : null
  const ok = (n: unknown) => Number.isInteger(n) && (valid ? valid.has(n as number) : (n as number) >= 1 && (n as number) <= MAX_PAGE)
  if (!raw.every(ok)) throw new HttpError(400, valid ? `Choose parts of ${source.title} that exist.` : `Pages run from 1 to ${MAX_PAGE}.`)
  const parts = [...new Set(raw as number[])].sort((a, b) => a - b)
  return valid && parts.length === valid.size ? null : parts
}

/** The source's title with the parts chosen (" — pages 3–5", " — Q&A 2–4"). */
const evidenceTitle = (source: PlannerSource, parts: number[] | null) =>
  source.title + partsLabel(source.kind === 'interview' ? 'deposition' : source.kind, parts, source.parts ?? null)

/** Attaches evidence to a card: `{ kind, id, parts?, excerpt?, note? }`, from what the team can cite. */
export async function addEvidence(team: PlannerTeam, cardId: string, body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>
  const kind = b.kind as EvidenceKind
  if (!EVIDENCE_KINDS.includes(kind) || !isUuid(b.id)) throw new HttpError(400, 'Choose a file, interview or report.')
  const source = (await plannerSources(team)).find((s) => s.kind === kind && s.id === b.id)
  if (!source) throw new HttpError(400, "That isn't something your team can cite.")
  const parts = readParts(b.parts, source)
  const excerpt = text(b, 'excerpt', MAX_TEXT_LENGTH, 'the excerpt') ?? ''
  const note = text(b, 'note', MAX_TEXT_LENGTH, 'the note') ?? ''
  await inTransaction(team, async (db) => {
    await requireCard(db, team, cardId)
    const { rows } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM planner_evidence WHERE card_id = $1', [cardId])
    if (rows[0].n >= MAX_EVIDENCE) throw new HttpError(409, `A card can have at most ${MAX_EVIDENCE} pieces of evidence.`)
    await db.query(
      `INSERT INTO planner_evidence (card_id, source_kind, material_id, interview_id, report_id, parts, title, excerpt, note, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, (SELECT coalesce(max(position) + 1, 0) FROM planner_evidence WHERE card_id = $1))`,
      [
        cardId,
        kind,
        kind === 'material' ? source.id : null,
        kind === 'interview' ? source.id : null,
        kind === 'report' ? source.id : null,
        parts,
        evidenceTitle(source, parts),
        excerpt,
        note,
      ],
    )
    await db.query('UPDATE planner_cards SET updated_by = $2, updated_at = now() WHERE id = $1', [cardId, team.userId])
  })
}

async function requireEvidence(db: Db, team: PlannerTeam, cardId: string, evidenceId: string) {
  await requireCard(db, team, cardId)
  const { rows } = isUuid(evidenceId)
    ? await db.query<{ kind: EvidenceKind; sourceId: string }>(
        `SELECT source_kind AS kind, coalesce(material_id, interview_id, report_id) AS "sourceId"
         FROM planner_evidence WHERE id = $1 AND card_id = $2`,
        [evidenceId, cardId],
      )
    : { rows: [] }
  if (!rows[0]) throw new HttpError(404, 'That evidence is gone. A teammate may have removed it.')
  return rows[0]
}

/** Changes a piece of evidence: `{ parts?, excerpt?, note? }`. */
export async function updateEvidence(team: PlannerTeam, cardId: string, evidenceId: string, body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>
  const excerpt = text(b, 'excerpt', MAX_TEXT_LENGTH, 'the excerpt')
  const note = text(b, 'note', MAX_TEXT_LENGTH, 'the note')
  let parts: number[] | null | undefined
  let title: string | null = null
  if ('parts' in b) {
    const found = await requireEvidence(pool, team, cardId, evidenceId)
    const source = (await plannerSources(team)).find((s) => s.kind === found.kind && s.id === found.sourceId)
    if (!source) throw new HttpError(409, 'Your team can no longer cite that.')
    parts = readParts(b.parts, source)
    title = evidenceTitle(source, parts)
  }
  await inTransaction(team, async (db) => {
    await requireEvidence(db, team, cardId, evidenceId)
    await db.query(
      `UPDATE planner_evidence SET excerpt = coalesce($2, excerpt), note = coalesce($3, note),
         parts = CASE WHEN $4 THEN $5::integer[] ELSE parts END, title = coalesce($6, title)
       WHERE id = $1`,
      [evidenceId, excerpt ?? null, note ?? null, parts !== undefined, parts ?? null, title],
    )
    await db.query('UPDATE planner_cards SET updated_by = $2, updated_at = now() WHERE id = $1', [cardId, team.userId])
  })
}

export async function deleteEvidence(team: PlannerTeam, cardId: string, evidenceId: string) {
  await inTransaction(team, async (db) => {
    await requireEvidence(db, team, cardId, evidenceId)
    await db.query('DELETE FROM planner_evidence WHERE id = $1', [evidenceId])
  })
}

// Gaps ----------------------------------------------------------------------------

/** The card a gap is on (`cardId`), null for one about the case as a whole; undefined when it's left out. */
async function readGapCard(db: Db, team: PlannerTeam, body: Record<string, unknown>) {
  if (!('cardId' in body)) return undefined
  if (body.cardId === null || body.cardId === '') return null
  return (await requireCard(db, team, String(body.cardId))).id
}

/** Adds a gap `{ cardId?, description }`. Returns its id. */
export async function createGap(team: PlannerTeam, body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>
  const description = text(b, 'description', MAX_TEXT_LENGTH, 'the gap') ?? ''
  return inTransaction(team, async (db) => {
    const cardId = (await readGapCard(db, team, b)) ?? null
    const { rows: count } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM planner_gaps WHERE team_id = $1 AND case_id = $2', [
      team.teamId,
      team.caseId,
    ])
    if (count[0].n >= MAX_GAPS) throw new HttpError(409, `A planner can have at most ${MAX_GAPS} gaps.`)
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO planner_gaps (case_id, team_id, card_id, description, position, updated_by)
       VALUES ($1, $2, $3, $4, (SELECT coalesce(max(position) + 1, 0) FROM planner_gaps WHERE team_id = $2 AND case_id = $1), $5)
       RETURNING id`,
      [team.caseId, team.teamId, cardId, description, team.userId],
    )
    return rows[0].id
  })
}

/** Changes a gap's `{ description?, cardId? }`, or moves it one place (`{ move: 'up' | 'down' }`). */
export async function updateGap(team: PlannerTeam, gapId: string, body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>
  const description = text(b, 'description', MAX_TEXT_LENGTH, 'the gap')
  await inTransaction(team, async (db) => {
    await requireGap(db, team, gapId)
    const cardId = await readGapCard(db, team, b)
    await db.query(
      `UPDATE planner_gaps SET description = coalesce($2, description),
         card_id = CASE WHEN $3 THEN $4::uuid ELSE card_id END, updated_by = $5, updated_at = now()
       WHERE id = $1`,
      [gapId, description ?? null, cardId !== undefined, cardId ?? null, team.userId],
    )
    if (b.move === 'up' || b.move === 'down') {
      const { rows } = await db.query<{ id: string }>(
        'SELECT id FROM planner_gaps WHERE team_id = $1 AND case_id = $2 ORDER BY position, created_at',
        [team.teamId, team.caseId],
      )
      await reorder(db, 'planner_gaps', rows.map((r) => r.id), gapId, b.move)
    }
  })
}

export async function deleteGap(team: PlannerTeam, gapId: string) {
  await inTransaction(team, async (db) => {
    await requireGap(db, team, gapId)
    await db.query('DELETE FROM planner_gaps WHERE id = $1', [gapId])
  })
}

/** Replaces a gap's tools: `{ tools: [{ tool, reason, specifics, witnessId? }] }`, the team's first choice first. */
export async function setGapTools(team: PlannerTeam, gapId: string, body: unknown) {
  const raw = (body as Record<string, unknown> | undefined)?.tools
  if (!Array.isArray(raw)) throw new HttpError(400, 'Send the tools as a list.')
  await inTransaction(team, async (db) => {
    await requireGap(db, team, gapId)
    const seen = new Set<string>()
    const tools: PlannerGapTool[] = []
    for (const [i, entry] of raw.entries()) {
      const e = (entry ?? {}) as Record<string, unknown>
      const tool = e.tool as PlannerTool
      if (!PLANNER_TOOLS.includes(tool)) throw new HttpError(400, 'Choose tools from the list.')
      if (seen.has(tool)) throw new HttpError(400, 'Choose each tool once.')
      seen.add(tool)
      tools.push({
        tool,
        priority: i + 1,
        reason: text(e, 'reason', MAX_TEXT_LENGTH, 'why this tool') ?? '',
        specifics: text(e, 'specifics', MAX_TEXT_LENGTH, 'the specifics') ?? '',
        witnessId: await readWitnessId(db, team.caseId, e.witnessId),
      })
    }
    await db.query('DELETE FROM planner_gap_tools WHERE gap_id = $1', [gapId])
    for (const t of tools) {
      await db.query(
        'INSERT INTO planner_gap_tools (gap_id, tool, priority, reason, specifics, witness_id) VALUES ($1, $2, $3, $4, $5, $6)',
        [gapId, t.tool, t.priority, t.reason, t.specifics, t.witnessId],
      )
    }
    await db.query('UPDATE planner_gaps SET updated_by = $2, updated_at = now() WHERE id = $1', [gapId, team.userId])
  })
}

// For the instructor -----------------------------------------------------------------

/** How far each matched team in the case has got with its planner. */
export async function plannerOverview(caseId: string) {
  const { rows } = await pool.query<{
    teamId: string
    teamNumber: number
    worldNumber: number
    side: Side
    cards: number
    gaps: number
    tools: number
    updatedAt: Date | null
  }>(
    `SELECT t.id AS "teamId", t.number AS "teamNumber", mu.number AS "worldNumber", mt.side,
            (SELECT count(*)::int FROM planner_cards c WHERE c.team_id = t.id AND c.case_id = $1) AS cards,
            (SELECT count(*)::int FROM planner_gaps g WHERE g.team_id = t.id AND g.case_id = $1) AS gaps,
            (SELECT count(*)::int FROM planner_gap_tools x JOIN planner_gaps g ON g.id = x.gap_id
             WHERE g.team_id = t.id AND g.case_id = $1) AS tools,
            greatest((SELECT max(updated_at) FROM planner_cards c WHERE c.team_id = t.id AND c.case_id = $1),
                     (SELECT max(updated_at) FROM planner_gaps g WHERE g.team_id = t.id AND g.case_id = $1)) AS "updatedAt"
     FROM matchup_teams mt
     JOIN matchups mu ON mu.id = mt.matchup_id
     JOIN teams t ON t.id = mt.team_id
     WHERE mu.case_id = $1
     ORDER BY mu.number, mt.side DESC`,
    [caseId],
  )
  return rows
}
