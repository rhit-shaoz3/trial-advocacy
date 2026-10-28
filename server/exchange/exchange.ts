import type { PoolClient } from 'pg'
import { pool } from '../db/pool.ts'
import { HttpError } from '../httpError.ts'
import { witnessAvatarUrlSql } from '../courses/caseContent.ts'
import type { CasePhase } from '../courses/cases.ts'
import type { Side } from '../courses/matchups.ts'

// Information exchange: before the investigation, teams trade information.
// In the introduction phase each student picks their own initial disclosures
// (practice, compared later with the instructor's); from the information
// exchange phase on, the instructor's initial disclosures are shared with
// both sides, and teams send each other interrogatories and requests for
// admission, which the other team answers by a due date.

export const EXCHANGE_KINDS = ['interrogatories', 'rfas'] as const
export type ExchangeKind = (typeof EXCHANGE_KINDS)[number]

/** One part of the exchange: whether it's included, each team's limit, and the days to respond. */
export interface PartSettings {
  enabled: boolean
  limit: number
  days: number
}

/** What a subpoena can ask for (the boxes on the federal form, AO 88B). */
export const SUBPOENA_TYPES = ['documents', 'esi', 'tangible_things', 'inspection'] as const
export type SubpoenaType = (typeof SUBPOENA_TYPES)[number]

/** Subpoenas' settings, plus the kinds of request the instructor allows. */
export interface SubpoenaSettings extends PartSettings {
  types: SubpoenaType[]
}

/** The firm a side's teams work for, and the senior partner who signs their welcome email. */
export interface Firm {
  firm: string
  partner: string
}

// Shape sent to the client; matches `ExchangeSettings` in src/courses/types.ts.
export interface ExchangeSettings {
  /** When the instructor finished the setup; students see nothing until then. */
  setupCompletedAt: Date | null
  disclosures: { enabled: boolean; materialIds: string[]; witnessIds: string[] }
  subpoenas: SubpoenaSettings
  interrogatories: PartSettings
  rfas: PartSettings
  firms: Record<Side, Firm>
}

/** What the instructor can change, already validated (the disclosures themselves are saved separately). */
export type SettingsInput = Omit<ExchangeSettings, 'setupCompletedAt' | 'disclosures'> & {
  disclosures: { enabled: boolean }
}

export const LIMIT_RANGE = { min: 1, max: 100 }
export const DAYS_RANGE = { min: 1, max: 365 }

export const DEFAULT_SETTINGS: SettingsInput = {
  disclosures: { enabled: true },
  subpoenas: { enabled: true, limit: 3, days: 14, types: [...SUBPOENA_TYPES] },
  interrogatories: { enabled: true, limit: 25, days: 30 },
  rfas: { enabled: true, limit: 25, days: 30 },
  firms: { plaintiff: { firm: '', partner: '' }, defense: { firm: '', partner: '' } },
}

/** The phases in which teams can send and answer requests. */
export const requestsOpen = (phase: CasePhase) => phase !== 'introduction'

/**
 * How many questions an interrogatory counts as toward the limit: one, or one
 * per lettered subpart, like "(a) when and (b) by whom".
 */
export function questionWeight(text: string) {
  return Math.max(1, (text.match(/\([a-z]\)/gi) ?? []).length)
}

const SETTINGS_COLUMNS = `setup_completed_at AS "setupCompletedAt",
  json_build_object('enabled', disclosures_enabled,
    'materialIds', coalesce((SELECT json_agg(d.material_id) FROM disclosure_items d
                             WHERE d.case_id = ie.case_id AND d.material_id IS NOT NULL), '[]'),
    'witnessIds', coalesce((SELECT json_agg(d.witness_id) FROM disclosure_items d
                            WHERE d.case_id = ie.case_id AND d.witness_id IS NOT NULL), '[]')) AS disclosures,
  json_build_object('enabled', subpoenas_enabled, 'limit', subpoena_limit, 'days', subpoena_days,
    'types', to_json(subpoena_types)) AS subpoenas,
  json_build_object('enabled', interrogatories_enabled, 'limit', interrogatory_limit, 'days', interrogatory_days)
    AS interrogatories,
  json_build_object('enabled', rfas_enabled, 'limit', rfa_limit, 'days', rfa_days) AS rfas,
  json_build_object(
    'plaintiff', json_build_object('firm', plaintiff_firm, 'partner', plaintiff_partner),
    'defense', json_build_object('firm', defense_firm, 'partner', defense_partner)) AS firms`

/** The case's settings, or the defaults (not set up) if the instructor hasn't started. */
export async function getSettings(caseId: string): Promise<ExchangeSettings> {
  const { rows } = await pool.query<ExchangeSettings>(
    `SELECT ${SETTINGS_COLUMNS} FROM information_exchange ie WHERE case_id = $1`,
    [caseId],
  )
  return rows[0] ?? { ...DEFAULT_SETTINGS, setupCompletedAt: null, disclosures: { enabled: true, materialIds: [], witnessIds: [] } }
}

export async function saveSettings(caseId: string, s: SettingsInput) {
  await pool.query(
    `INSERT INTO information_exchange (case_id, disclosures_enabled, subpoenas_enabled, subpoena_limit, subpoena_days,
       interrogatories_enabled, interrogatory_limit, interrogatory_days, rfas_enabled, rfa_limit, rfa_days,
       plaintiff_firm, plaintiff_partner, defense_firm, defense_partner, subpoena_types)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT (case_id) DO UPDATE SET
       disclosures_enabled = $2, subpoenas_enabled = $3, subpoena_limit = $4, subpoena_days = $5,
       interrogatories_enabled = $6, interrogatory_limit = $7, interrogatory_days = $8,
       rfas_enabled = $9, rfa_limit = $10, rfa_days = $11,
       plaintiff_firm = $12, plaintiff_partner = $13, defense_firm = $14, defense_partner = $15,
       subpoena_types = $16, updated_at = now()`,
    [
      caseId,
      s.disclosures.enabled,
      s.subpoenas.enabled,
      s.subpoenas.limit,
      s.subpoenas.days,
      s.interrogatories.enabled,
      s.interrogatories.limit,
      s.interrogatories.days,
      s.rfas.enabled,
      s.rfas.limit,
      s.rfas.days,
      s.firms.plaintiff.firm,
      s.firms.plaintiff.partner,
      s.firms.defense.firm,
      s.firms.defense.partner,
      s.subpoenas.types,
    ],
  )
  return getSettings(caseId)
}

/** Finishes the setup (once; finishing again keeps the first time). Students see the exchange from now on. */
export async function completeExchangeSetup(caseId: string) {
  await pool.query(
    `INSERT INTO information_exchange (case_id, setup_completed_at) VALUES ($1, now())
     ON CONFLICT (case_id) DO UPDATE SET setup_completed_at = coalesce(information_exchange.setup_completed_at, now())`,
    [caseId],
  )
  return getSettings(caseId)
}

// Initial disclosures --------------------------------------------------------

/** A witness or case file one side could disclose. */
export interface DisclosureOption {
  kind: 'witness' | 'material'
  id: string
  side: Side
  name: string
  detail: string
  avatarUrl: string | null
}

/**
 * What each side could disclose: its own witnesses (testifying for it, or
 * shown only to it) and the case files only it can see. A disclosed file
 * shared with everyone still counts as its own side's. The initial file is
 * everyone's from the start, so it's never listed.
 */
export async function disclosureOptions(caseId: string): Promise<DisclosureOption[]> {
  const { rows } = await pool.query<DisclosureOption>(
    `SELECT kind, id, side, name, detail, "avatarUrl" FROM (
       SELECT 'witness' AS kind, w.id, coalesce(w.aligned_side, w.audience) AS side, w.name, w.role AS detail,
              ${witnessAvatarUrlSql('w')} AS "avatarUrl", w.created_at AS added
       FROM case_witnesses w
       WHERE w.case_id = $1 AND (w.aligned_side IS NOT NULL OR w.audience <> 'all')
       UNION ALL
       SELECT 'material', m.id, coalesce(d.original_audience, m.audience), m.filename, m.description, NULL, m.uploaded_at
       FROM case_materials m
       LEFT JOIN disclosure_items d ON d.material_id = m.id
       WHERE m.case_id = $1 AND NOT m.initial AND coalesce(d.original_audience, m.audience) IN ('plaintiff', 'defense')
     ) options
     ORDER BY kind DESC, added, name`,
    [caseId],
  )
  return rows
}

/**
 * Shares the disclosed files with everyone (or, with `shared` false, gives
 * them back their own side's audience). Disclosed witnesses aren't changed:
 * the workspace shows them to both sides outside the introduction phase.
 */
export async function applyDisclosures(caseId: string, shared: boolean, db: Pick<PoolClient, 'query'> = pool) {
  if (shared) {
    await db.query(
      `WITH flipped AS (
         UPDATE disclosure_items d SET original_audience = m.audience
         FROM case_materials m
         WHERE d.case_id = $1 AND d.material_id = m.id AND d.original_audience IS NULL
           AND m.audience IN ('plaintiff', 'defense')
         RETURNING d.material_id)
       UPDATE case_materials SET audience = 'all' WHERE id IN (SELECT material_id FROM flipped)`,
      [caseId],
    )
  } else {
    await db.query(
      `WITH restored AS (
         UPDATE disclosure_items SET original_audience = NULL
         FROM (SELECT id, original_audience FROM disclosure_items WHERE case_id = $1 AND original_audience IS NOT NULL) old
         WHERE disclosure_items.id = old.id
         RETURNING disclosure_items.material_id, old.original_audience)
       UPDATE case_materials m SET audience = r.original_audience FROM restored r WHERE m.id = r.material_id`,
      [caseId],
    )
  }
}

/**
 * Replaces the instructor's initial disclosures. Every id must be one of the
 * case's disclosure options. Outside the introduction phase the new choices
 * are shared at once, and files taken off the list go back to their side.
 */
export async function setDisclosures(caseId: string, phase: CasePhase, materialIds: string[], witnessIds: string[]) {
  const options = await disclosureOptions(caseId)
  const allowed = (kind: DisclosureOption['kind'], id: string) => options.some((o) => o.kind === kind && o.id === id)
  if (!materialIds.every((id) => allowed('material', id)) || !witnessIds.every((id) => allowed('witness', id))) {
    throw new HttpError(400, 'Choose witnesses and one-side case files from this case.')
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await applyDisclosures(caseId, false, client)
    await client.query('DELETE FROM disclosure_items WHERE case_id = $1', [caseId])
    await client.query(
      `INSERT INTO disclosure_items (case_id, material_id, witness_id)
       SELECT $1::uuid, m, NULL::uuid FROM unnest($2::uuid[]) m
       UNION ALL SELECT $1::uuid, NULL::uuid, w FROM unnest($3::uuid[]) w`,
      [caseId, [...new Set(materialIds)], [...new Set(witnessIds)]],
    )
    if (requestsOpen(phase)) await applyDisclosures(caseId, true, client)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
  return getSettings(caseId)
}

/** The witnesses the instructor disclosed, shown to both sides after the introduction phase. */
export async function disclosedWitnessIds(caseId: string) {
  const { rows } = await pool.query<{ id: string }>(
    'SELECT witness_id AS id FROM disclosure_items WHERE case_id = $1 AND witness_id IS NOT NULL',
    [caseId],
  )
  return new Set(rows.map((r) => r.id))
}

/** One disclosed witness or file, with the student's reason when it's theirs. */
export interface DisclosureItem {
  kind: 'witness' | 'material'
  id: string
  name: string
  detail: string
  avatarUrl: string | null
  reason: string | null
}

// Shape sent to the client; matches `DisclosureSubmission` in src/courses/types.ts.
export interface DisclosureSubmission {
  submittedAt: Date
  heldBackReason: string
  items: DisclosureItem[]
}

export async function findSubmission(caseId: string, userId: string): Promise<DisclosureSubmission | null> {
  const { rows } = await pool.query<{ id: string; submittedAt: Date; heldBackReason: string }>(
    `SELECT id, submitted_at AS "submittedAt", held_back_reason AS "heldBackReason"
     FROM disclosure_submissions WHERE case_id = $1 AND user_id = $2`,
    [caseId, userId],
  )
  if (!rows[0]) return null
  const { rows: items } = await pool.query<DisclosureItem>(
    `SELECT CASE WHEN p.witness_id IS NULL THEN 'material' ELSE 'witness' END AS kind,
            coalesce(p.witness_id, p.material_id) AS id,
            coalesce(w.name, m.filename) AS name, coalesce(w.role, m.description) AS detail,
            ${witnessAvatarUrlSql('w')} AS "avatarUrl", p.reason
     FROM disclosure_picks p
     LEFT JOIN case_witnesses w ON w.id = p.witness_id
     LEFT JOIN case_materials m ON m.id = p.material_id
     WHERE p.submission_id = $1
     ORDER BY kind DESC, name`,
    [rows[0].id],
  )
  return { submittedAt: rows[0].submittedAt, heldBackReason: rows[0].heldBackReason, items }
}

/** Records a student's initial disclosures, once. Each pick must be one of their side's options. */
export async function submitDisclosures(
  caseId: string,
  userId: string,
  side: Side,
  picks: { kind: 'witness' | 'material'; id: string; reason: string }[],
  heldBackReason: string,
) {
  const options = (await disclosureOptions(caseId)).filter((o) => o.side === side)
  if (!picks.every((p) => options.some((o) => o.kind === p.kind && o.id === p.id))) {
    throw new HttpError(400, "Choose from your side's witnesses and documents.")
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO disclosure_submissions (case_id, user_id, side, held_back_reason) VALUES ($1, $2, $3, $4)
       ON CONFLICT (case_id, user_id) DO NOTHING RETURNING id`,
      [caseId, userId, side, heldBackReason],
    )
    if (!rows[0]) throw new HttpError(409, 'You already submitted your initial disclosures.')
    for (const p of picks) {
      await client.query(
        'INSERT INTO disclosure_picks (submission_id, material_id, witness_id, reason) VALUES ($1, $2, $3, $4)',
        [rows[0].id, p.kind === 'material' ? p.id : null, p.kind === 'witness' ? p.id : null, p.reason],
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/** How a student's picks compare with the instructor's for their side. */
export interface DisclosureReview {
  matched: DisclosureItem[]
  extra: DisclosureItem[]
  missing: DisclosureItem[]
}

export function compareDisclosures(
  submission: DisclosureSubmission | null,
  options: DisclosureOption[],
  key: { materialIds: string[]; witnessIds: string[] },
): DisclosureReview {
  const inKey = (i: { kind: string; id: string }) =>
    (i.kind === 'material' ? key.materialIds : key.witnessIds).includes(i.id)
  const picked = submission?.items ?? []
  const pickedIds = new Set(picked.map((i) => `${i.kind}:${i.id}`))
  return {
    matched: picked.filter(inKey),
    extra: picked.filter((i) => !inKey(i)),
    missing: options
      .filter((o) => inKey(o) && !pickedIds.has(`${o.kind}:${o.id}`))
      .map((o) => ({ kind: o.kind, id: o.id, name: o.name, detail: o.detail, avatarUrl: o.avatarUrl, reason: null })),
  }
}

// Interrogatories and requests for admission -------------------------------

export interface ExchangeItem {
  position: number
  text: string
  weight: number
  answer: string | null
  objection: boolean
  admission: 'agree' | 'disagree' | 'partial' | null
  agreePart: string | null
  disagreePart: string | null
}

// Shape sent to the client; matches `ExchangeRequest` in src/courses/types.ts.
export interface ExchangeRequest {
  id: string
  kind: ExchangeKind
  fromTeam: { id: string; number: number; side: Side }
  toTeam: { id: string; number: number; side: Side }
  worldNumber: number
  sentBy: string | null
  sentAt: Date
  dueAt: Date
  respondedAt: Date | null
  respondedBy: string | null
  items: ExchangeItem[]
}

const REQUEST_COLUMNS = `r.id, r.kind, r.sent_at AS "sentAt", r.due_at AS "dueAt", r.responded_at AS "respondedAt",
  su.name AS "sentBy", ru.name AS "respondedBy", mu.number AS "worldNumber",
  json_build_object('id', ft.id, 'number', ft.number, 'side', fmt.side) AS "fromTeam",
  json_build_object('id', tt.id, 'number', tt.number, 'side', tmt.side) AS "toTeam",
  coalesce((SELECT json_agg(json_build_object('position', i.position, 'text', i.text, 'weight', i.weight,
              'answer', i.answer, 'objection', i.objection, 'admission', i.admission,
              'agreePart', i.agree_part, 'disagreePart', i.disagree_part) ORDER BY i.position)
            FROM exchange_items i WHERE i.request_id = r.id), '[]') AS items`

const REQUEST_JOINS = `FROM exchange_requests r
  JOIN teams ft ON ft.id = r.from_team_id
  JOIN teams tt ON tt.id = r.to_team_id
  JOIN matchup_teams fmt ON fmt.team_id = ft.id
  JOIN matchup_teams tmt ON tmt.team_id = tt.id
  JOIN matchups mu ON mu.id = fmt.matchup_id
  LEFT JOIN users su ON su.id = r.sent_by
  LEFT JOIN users ru ON ru.id = r.responded_by`

/** Every set in the case, for the instructor's read-only view: newest first. */
export async function listCaseRequests(caseId: string) {
  const { rows } = await pool.query<ExchangeRequest>(
    `SELECT ${REQUEST_COLUMNS} ${REQUEST_JOINS} WHERE r.case_id = $1 ORDER BY r.sent_at DESC`,
    [caseId],
  )
  return rows
}

/**
 * The sets a team sent or received, newest first, with whether this student
 * has read the responses (only meaningful for answered sets the team sent).
 */
export async function listTeamRequests(caseId: string, teamId: string, userId: string) {
  const { rows } = await pool.query<ExchangeRequest & { seen: boolean }>(
    `SELECT ${REQUEST_COLUMNS},
            EXISTS (SELECT 1 FROM exchange_seen s WHERE s.request_id = r.id AND s.user_id = $3) AS seen
     ${REQUEST_JOINS}
     WHERE r.case_id = $1 AND (r.from_team_id = $2 OR r.to_team_id = $2)
     ORDER BY r.sent_at DESC`,
    [caseId, teamId, userId],
  )
  return rows
}

/** How many of a kind a team has used: questions (with subparts) or requests. */
export async function usedCount(caseId: string, teamId: string, kind: ExchangeKind, db: Pick<PoolClient, 'query'> = pool) {
  const { rows } = await db.query<{ used: number }>(
    `SELECT coalesce(sum(i.weight), 0)::int AS used
     FROM exchange_requests r JOIN exchange_items i ON i.request_id = r.id
     WHERE r.case_id = $1 AND r.from_team_id = $2 AND r.kind = $3`,
    [caseId, teamId, kind],
  )
  return rows[0].used
}

/** A team in its case world, and the team it's up against. */
export interface TeamContext {
  caseId: string
  teamId: string
  opponentTeamId: string
  side: Side
  userId: string
}

/** The team's opponent in its case world, or null before it's matched. */
export async function findOpponent(teamId: string) {
  const { rows } = await pool.query<{ teamId: string; side: Side }>(
    `SELECT o.team_id AS "teamId", me.side
     FROM matchup_teams me JOIN matchup_teams o ON o.matchup_id = me.matchup_id AND o.team_id <> me.team_id
     WHERE me.team_id = $1`,
    [teamId],
  )
  return rows[0] ?? null
}

const MAX_ITEM_LENGTH = 1000
export const MAX_ITEMS_PER_SET = 50

/**
 * Sends a set to the other team, due `part.days` from now. Refused if it
 * would take the team past its limit (partners sending at once are checked
 * one after the other).
 */
export async function sendRequest(ctx: TeamContext, kind: ExchangeKind, part: PartSettings, texts: string[]) {
  const items = texts.map((t) => t.trim()).filter(Boolean)
  if (items.length === 0) throw new HttpError(400, 'Write at least one question.')
  if (items.length > MAX_ITEMS_PER_SET) throw new HttpError(400, `Send at most ${MAX_ITEMS_PER_SET} in one set.`)
  if (items.some((t) => t.length > MAX_ITEM_LENGTH)) {
    throw new HttpError(400, `Keep each one to ${MAX_ITEM_LENGTH} characters.`)
  }
  const weights = items.map((t) => (kind === 'interrogatories' ? questionWeight(t) : 1))
  const total = weights.reduce((a, b) => a + b, 0)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT 1 FROM teams WHERE id = $1 FOR UPDATE', [ctx.teamId])
    const left = part.limit - (await usedCount(ctx.caseId, ctx.teamId, kind, client))
    if (total > left) {
      const noun = kind === 'interrogatories' ? 'interrogatories' : 'requests for admission'
      throw new HttpError(409, left <= 0 ? `Your team is out of ${noun}.` : `Your team has only ${left} ${noun} left.`)
    }
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO exchange_requests (case_id, kind, from_team_id, to_team_id, sent_by, due_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6)) RETURNING id`,
      [ctx.caseId, kind, ctx.teamId, ctx.opponentTeamId, ctx.userId, part.days],
    )
    await client.query(
      `INSERT INTO exchange_items (request_id, position, text, weight)
       SELECT $1, n, t, w FROM unnest($2::text[], $3::int[]) WITH ORDINALITY AS x(t, w, n)`,
      [rows[0].id, items, weights],
    )
    await client.query('COMMIT')
    return rows[0].id
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/** One response from the answering team. */
export interface ItemResponse {
  position: number
  answer: string
  objection: boolean
  admission: 'agree' | 'disagree' | 'partial' | null
  agreePart: string
  disagreePart: string
}

/**
 * The answering team's responses to a set they received, all at once and
 * once. Interrogatories need an answer (or objection) each; requests for
 * admission need agree, disagree, or partial (with both parts filled in).
 */
export async function respondToRequest(ctx: TeamContext, requestId: string, responses: ItemResponse[]) {
  const { rows } = await pool.query<{ kind: ExchangeKind; respondedAt: Date | null; count: number }>(
    `SELECT r.kind, r.responded_at AS "respondedAt", (SELECT count(*)::int FROM exchange_items i WHERE i.request_id = r.id) AS count
     FROM exchange_requests r WHERE r.id = $1 AND r.case_id = $2 AND r.to_team_id = $3`,
    [requestId, ctx.caseId, ctx.teamId],
  )
  const request = rows[0]
  if (!request) throw new HttpError(404, 'Request not found.')
  if (request.respondedAt) throw new HttpError(409, 'Your team already responded to this set.')
  const byPosition = new Map(responses.map((r) => [r.position, r]))
  for (let position = 1; position <= request.count; position++) {
    const r = byPosition.get(position)
    if (!r) throw new HttpError(400, 'Respond to every item in the set.')
    if (request.kind === 'interrogatories' && !r.answer.trim()) {
      throw new HttpError(400, `Answer question ${position}, or object to it.`)
    }
    if (request.kind === 'rfas') {
      if (!r.admission) throw new HttpError(400, `Choose agree, disagree, or partial for request ${position}.`)
      if (r.admission === 'partial' && (!r.agreePart.trim() || !r.disagreePart.trim())) {
        throw new HttpError(400, `Say what you agree and disagree with in request ${position}.`)
      }
    }
    if ([r.answer, r.agreePart, r.disagreePart].some((t) => t.length > MAX_ITEM_LENGTH * 4)) {
      throw new HttpError(400, 'That response is too long.')
    }
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rowCount } = await client.query(
      `UPDATE exchange_requests SET responded_at = now(), responded_by = $2 WHERE id = $1 AND responded_at IS NULL`,
      [requestId, ctx.userId],
    )
    if (rowCount !== 1) throw new HttpError(409, 'Your team already responded to this set.')
    for (let position = 1; position <= request.count; position++) {
      const r = byPosition.get(position)!
      const rfa = request.kind === 'rfas'
      await client.query(
        `UPDATE exchange_items SET answer = $3, objection = $4, admission = $5, agree_part = $6, disagree_part = $7
         WHERE request_id = $1 AND position = $2`,
        [
          requestId,
          position,
          r.answer.trim() || null,
          !rfa && r.objection,
          rfa ? r.admission : null,
          rfa && r.admission === 'partial' ? r.agreePart.trim() : null,
          rfa && r.admission === 'partial' ? r.disagreePart.trim() : null,
        ],
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/** Marks the responses to the team's sets as read by this student. */
export async function markExchangeSeen(caseId: string, teamId: string, userId: string) {
  await pool.query(
    `INSERT INTO exchange_seen (request_id, user_id)
     SELECT id, $3 FROM exchange_requests
     WHERE case_id = $1 AND (from_team_id = $2 OR to_team_id = $2) AND responded_at IS NOT NULL
     ON CONFLICT DO NOTHING`,
    [caseId, teamId, userId],
  )
}

// The instructor's view -------------------------------------------------------

// Shape sent to the client; matches `ExchangeOverview` in src/courses/types.ts.
export interface ExchangeOverview {
  /** Students who have submitted initial disclosures, of the students in case worlds. */
  submissions: { submitted: number; total: number; byWorld: { number: number; submitted: number; total: number }[] }
  activity: {
    /** Questions (with subparts) and requests sent across the class. */
    interrogatoriesSent: number
    rfasSent: number
    teams: number
    teamsSentInterrogatories: number
    teamsSentRfas: number
    /** Sets the other team hasn't responded to yet, and how many of those are past due. */
    waiting: number
    overdue: number
    /** Subpoenas served across the class, and how many still need the instructor's answer. */
    subpoenasServed: number
    subpoenasWaiting: number
  }
  /** What the move to information exchange shares: the disclosed files and witnesses, by name. */
  disclosed: { materials: string[]; witnesses: string[] }
}

export async function exchangeOverview(caseId: string): Promise<ExchangeOverview> {
  const { rows: worlds } = await pool.query<{ number: number; submitted: number; total: number }>(
    `SELECT mu.number, count(DISTINCT tm.email)::int AS total, count(DISTINCT s.id)::int AS submitted
     FROM matchups mu
     JOIN matchup_teams mt ON mt.matchup_id = mu.id
     JOIN team_members tm ON tm.team_id = mt.team_id
     LEFT JOIN enrollments e ON e.course_id = tm.course_id AND e.email = tm.email
     LEFT JOIN disclosure_submissions s ON s.case_id = mu.case_id AND s.user_id = e.user_id
     WHERE mu.case_id = $1
     GROUP BY mu.number ORDER BY mu.number`,
    [caseId],
  )
  const { rows } = await pool.query<ExchangeOverview['activity']>(
    `SELECT
       coalesce(sum(i.weight) FILTER (WHERE r.kind = 'interrogatories'), 0)::int AS "interrogatoriesSent",
       count(i.*) FILTER (WHERE r.kind = 'rfas')::int AS "rfasSent",
       (SELECT count(*)::int FROM matchup_teams WHERE case_id = $1) AS teams,
       count(DISTINCT r.from_team_id) FILTER (WHERE r.kind = 'interrogatories')::int AS "teamsSentInterrogatories",
       count(DISTINCT r.from_team_id) FILTER (WHERE r.kind = 'rfas')::int AS "teamsSentRfas",
       count(DISTINCT r.id) FILTER (WHERE r.responded_at IS NULL)::int AS waiting,
       count(DISTINCT r.id) FILTER (WHERE r.responded_at IS NULL AND r.due_at < now())::int AS overdue,
       (SELECT count(*)::int FROM subpoenas WHERE case_id = $1) AS "subpoenasServed",
       (SELECT count(*)::int FROM subpoenas WHERE case_id = $1 AND responded_at IS NULL) AS "subpoenasWaiting"
     FROM exchange_requests r JOIN exchange_items i ON i.request_id = r.id
     WHERE r.case_id = $1`,
    [caseId],
  )
  const { rows: disclosed } = await pool.query<{ kind: 'material' | 'witness'; name: string }>(
    `SELECT CASE WHEN d.witness_id IS NULL THEN 'material' ELSE 'witness' END AS kind,
            coalesce(w.name, nullif(m.description, ''), m.filename) AS name
     FROM disclosure_items d
     LEFT JOIN case_witnesses w ON w.id = d.witness_id
     LEFT JOIN case_materials m ON m.id = d.material_id
     WHERE d.case_id = $1 ORDER BY name`,
    [caseId],
  )
  return {
    submissions: {
      submitted: worlds.reduce((n, w) => n + w.submitted, 0),
      total: worlds.reduce((n, w) => n + w.total, 0),
      byWorld: worlds,
    },
    activity: rows[0],
    disclosed: {
      materials: disclosed.filter((d) => d.kind === 'material').map((d) => d.name),
      witnesses: disclosed.filter((d) => d.kind === 'witness').map((d) => d.name),
    },
  }
}
