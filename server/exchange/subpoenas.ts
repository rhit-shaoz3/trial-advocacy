import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { ai, AiNotConfiguredError } from '../ai/ai.ts'
import { createMaterial, listMaterialsFor, listMaterialTexts, shareMaterialWithTeam } from '../courses/caseContent.ts'
import type { ImportantFacts } from '../courses/cases.ts'
import type { Side } from '../courses/matchups.ts'
import { finishPendingTranscriptions } from '../courses/materialText.ts'
import { pool } from '../db/pool.ts'
import { HttpError } from '../httpError.ts'
import { matchTitles } from '../investigator/investigate.ts'
import { findTeamWorld, settledFacts } from '../reviews/reviews.ts'
import { storage } from '../storage/storage.ts'
import { partyNames } from '../witness/profile.ts'
import { SUBPOENA_TYPES, type Firm, type SubpoenaSettings, type SubpoenaType, type TeamContext } from './exchange.ts'
import { parseSubpoenaResponse, type SubpoenaContext } from './subpoenaPrompt.ts'

// Subpoenas: from the information exchange phase on, a team serves a person or
// organization (a hospital, a regulator, the ride's maker) for documents, ESI,
// tangible things, or an inspection of premises. In the background the AI
// drafts the recipient's response from the whole case file; the instructor
// reviews it on the Review page and approves it (the response becomes a case
// file of the team's case world, shared with the team along with any existing
// files it produces), has it redrafted, or denies the subpoena. The team sees
// nothing until then. The other team in the case world gets notice of each
// subpoena (FRCP 45(a)(4)), but not what came back.

export const SUBPOENA_OUTCOMES = ['responded', 'denied'] as const
export type SubpoenaOutcome = (typeof SUBPOENA_OUTCOMES)[number]

/** drafting -> open (ready for the instructor) -> answered; failed when drafting went wrong. */
export type SubpoenaStatus = 'drafting' | 'open' | 'failed' | 'answered'

export const MAX_RECIPIENT_LENGTH = 200
export const MAX_DESCRIPTION_LENGTH = 1000
export const MAX_RECORDS_LENGTH = 4000
/** A response is a document; this leaves room for a month of bank records. */
export const MAX_RESPONSE_LENGTH = 60000
export const MAX_NOTE_LENGTH = 4000

/** A produced case file, by the title students see. */
export interface ProducedDocument {
  materialId: string
  title: string
}

/** An existing case file a draft produces; when it's an earlier subpoena response, the team it went to. */
export interface ExistingDocument extends ProducedDocument {
  producedToTeam: number | null
}

// Shape sent to the client; matches `TeamSubpoena` in src/courses/types.ts.
export interface TeamSubpoena {
  id: string
  recipient: string
  recipientDescription: string
  requestType: SubpoenaType
  records: string
  sentBy: string | null
  sentAt: Date
  dueAt: Date
  outcome: SubpoenaOutcome | null
  /** The response document, or the instructor's note on a denial. */
  response: string | null
  respondedAt: Date | null
  documents: ProducedDocument[]
  /** Whether this student has read the answer. */
  seen: boolean
}

// Shape sent to the client; matches `SubpoenaNotice` in src/courses/types.ts.
export interface SubpoenaNotice {
  id: string
  teamNumber: number
  recipient: string
  requestType: SubpoenaType
  records: string
  sentAt: Date
  /** Whether this student has seen the notice. */
  seen: boolean
}

// Shape sent to the client; matches `CourseSubpoena` in src/courses/types.ts.
export interface CourseSubpoena extends Omit<TeamSubpoena, 'seen'> {
  caseId: string
  caseTitle: string
  parties: { plaintiff: string; defendant: string }
  /** The requesting side's firm, for the subpoena form. */
  firm: Firm
  worldNumber: number
  teamNumber: number
  side: Side
  /** The team's members, by name (or email). */
  team: string[]
  respondedBy: string | null
  status: SubpoenaStatus
  /** The AI's draft of the response, tag lines removed. */
  draft: string | null
  /** Whether the AI thinks a court would likely quash or modify the subpoena. */
  flag: 'quash' | 'modify' | null
  /** Existing case files the draft produces. */
  existing: ExistingDocument[]
  /** Another case world's response the draft adapts, for the instructor to compare. */
  basedOn: (ProducedDocument & { worldNumber: number }) | null
  /** Files the draft named that match no case file. */
  unknownTitles: string[]
  /** The instructor's notes for the latest draft. */
  instructions: string
  createNew: boolean
  error: string | null
}

const TITLE = `coalesce(nullif(cm.description, ''), cm.filename)`

const filesOf = (table: string, as: string, extra = '') => `coalesce((SELECT json_agg(json_build_object('materialId', d.material_id,
                                    'title', ${TITLE}${extra}) ORDER BY d.position)
                  FROM ${table} d JOIN case_materials cm ON cm.id = d.material_id
                  WHERE d.subpoena_id = s.id), '[]') AS ${as}`

const COLUMNS = `s.id, s.recipient, s.recipient_description AS "recipientDescription", s.request_type AS "requestType",
  s.records, su.name AS "sentBy", s.sent_at AS "sentAt", s.due_at AS "dueAt",
  s.outcome, s.response, s.responded_at AS "respondedAt", ${filesOf('subpoena_documents', 'documents')}`

/** How many subpoenas a team has served (denied ones count too). */
export async function subpoenaCount(caseId: string, teamId: string, db: Pick<PoolClient, 'query'> = pool) {
  const { rows } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM subpoenas WHERE case_id = $1 AND team_id = $2', [
    caseId,
    teamId,
  ])
  return rows[0].n
}

/** The team's subpoenas, newest first, with the answers once the instructor has released them. */
export async function teamSubpoenas(caseId: string, teamId: string, userId: string): Promise<TeamSubpoena[]> {
  const { rows } = await pool.query<TeamSubpoena>(
    `SELECT ${COLUMNS},
            EXISTS (SELECT 1 FROM subpoena_seen x WHERE x.subpoena_id = s.id AND x.user_id = $3) AS seen
     FROM subpoenas s LEFT JOIN users su ON su.id = s.sent_by
     WHERE s.case_id = $1 AND s.team_id = $2
     ORDER BY s.sent_at DESC`,
    [caseId, teamId, userId],
  )
  return rows
}

/** Notice of the subpoenas the other team in this team's case world has served, newest first. */
export async function subpoenaNotices(caseId: string, teamId: string, userId: string): Promise<SubpoenaNotice[]> {
  const { rows } = await pool.query<SubpoenaNotice>(
    `SELECT s.id, s.team_number AS "teamNumber", s.recipient, s.request_type AS "requestType", s.records, s.sent_at AS "sentAt",
            EXISTS (SELECT 1 FROM subpoena_seen x WHERE x.subpoena_id = s.id AND x.user_id = $3) AS seen
     FROM subpoenas s JOIN matchup_teams me ON me.matchup_id = s.matchup_id AND me.team_id = $2
     WHERE s.case_id = $1 AND s.team_id <> $2
     ORDER BY s.sent_at DESC`,
    [caseId, teamId, userId],
  )
  return rows
}

export interface SubpoenaInput {
  recipient: string
  recipientDescription: string
  requestType: string
  records: string
}

/**
 * Serves a subpoena, due `part.days` from now, and starts drafting its
 * response. Refused past the team's limit (partners serving at once are
 * checked in turn) or for a kind of request the case doesn't allow.
 */
export async function serveSubpoena(ctx: TeamContext, part: SubpoenaSettings, input: SubpoenaInput) {
  const to = input.recipient.trim()
  const about = input.recipientDescription.trim()
  const what = input.records.trim()
  if (!to) throw new HttpError(400, 'Say who the subpoena is for.')
  if (!what) throw new HttpError(400, 'Describe what you want.')
  if (to.length > MAX_RECIPIENT_LENGTH) throw new HttpError(400, `Keep the recipient to ${MAX_RECIPIENT_LENGTH} characters.`)
  if (about.length > MAX_DESCRIPTION_LENGTH) {
    throw new HttpError(400, `Keep who they are to ${MAX_DESCRIPTION_LENGTH} characters.`)
  }
  if (what.length > MAX_RECORDS_LENGTH) throw new HttpError(400, `Keep what you want to ${MAX_RECORDS_LENGTH} characters.`)
  // With one kind allowed, the form doesn't ask.
  const type = (input.requestType || (part.types.length === 1 ? part.types[0] : '')) as SubpoenaType
  if (!(SUBPOENA_TYPES as readonly string[]).includes(type)) throw new HttpError(400, 'Choose what the subpoena asks for.')
  if (!part.types.includes(type)) throw new HttpError(400, "This case doesn't allow that kind of subpoena.")
  const world = await findTeamWorld(ctx.teamId)
  if (!world) throw new HttpError(409, 'Your team needs a case world first.')
  const client = await pool.connect()
  let id: string
  try {
    await client.query('BEGIN')
    await client.query('SELECT 1 FROM teams WHERE id = $1 FOR UPDATE', [ctx.teamId])
    const left = part.limit - (await subpoenaCount(ctx.caseId, ctx.teamId, client))
    if (left <= 0) throw new HttpError(409, 'Your team is out of subpoenas.')
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO subpoenas (case_id, team_id, matchup_id, world_number, team_number, side, recipient,
         recipient_description, request_type, records, sent_by, due_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now() + make_interval(days => $12), 'drafting') RETURNING id`,
      [ctx.caseId, ctx.teamId, world.matchupId, world.worldNumber, world.teamNumber, world.side, to, about, type, what, ctx.userId, part.days],
    )
    id = rows[0].id
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
  queueSubpoena(id)
  return id
}

/**
 * Marks the answers to the team's subpoenas, and the notices of the other
 * team's, as read by this student.
 */
export async function markSubpoenasSeen(caseId: string, teamId: string, userId: string) {
  await pool.query(
    `INSERT INTO subpoena_seen (subpoena_id, user_id)
     SELECT s.id, $3 FROM subpoenas s
     WHERE s.case_id = $1
       AND ((s.team_id = $2 AND s.responded_at IS NOT NULL)
            OR (s.team_id <> $2 AND s.matchup_id IN (SELECT matchup_id FROM matchup_teams WHERE team_id = $2)))
     ON CONFLICT DO NOTHING`,
    [caseId, teamId, userId],
  )
}

// Drafting the response ------------------------------------------------------

const running = new Map<string, Promise<void>>()

/** Drafts a subpoena's response in the background, if it's waiting for one. */
export function queueSubpoena(id: string) {
  if (running.has(id)) return
  const run = draftResponse(id).finally(() => running.delete(id))
  running.set(id, run)
}

/** Picks up drafts a server restart interrupted (the work runs in memory). */
export async function resumeSubpoenas() {
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM subpoenas WHERE status = 'drafting'`)
  for (const { id } of rows) queueSubpoena(id)
}

/** Resolves once every draft running now has finished (for tests). */
export async function subpoenasSettled() {
  while (running.size) await Promise.all(running.values())
}

interface DraftRow {
  id: string
  caseId: string
  teamId: string
  matchupId: string | null
  side: Side
  recipient: string
  recipientDescription: string
  requestType: SubpoenaType
  records: string
  instructions: string
  createNew: boolean
  caseTitle: string
  parties: { plaintiff: string; defendant: string }
  summary: string
  disputedIssues: string
  importantFacts: ImportantFacts
}

async function draftResponse(id: string) {
  const { rows } = await pool.query<DraftRow>(
    `SELECT s.id, s.case_id AS "caseId", s.team_id AS "teamId", s.matchup_id AS "matchupId", s.side, s.recipient,
            s.recipient_description AS "recipientDescription", s.request_type AS "requestType", s.records,
            s.instructions, s.create_new AS "createNew",
            c.title AS "caseTitle", c.summary, c.disputed_issues AS "disputedIssues",
            json_build_object('plaintiff', c.plaintiff_name, 'defendant', c.defendant_name) AS parties,
            json_build_object('plaintiff', c.plaintiff_key_facts, 'defense', c.defense_key_facts) AS "importantFacts"
     FROM subpoenas s JOIN cases c ON c.id = s.case_id
     WHERE s.id = $1 AND s.status = 'drafting'`,
    [id],
  )
  const row = rows[0]
  if (!row) return // answered or deleted meanwhile
  try {
    const context = await subpoenaContext(row)
    const parsed = parseSubpoenaResponse(await ai.respondToSubpoena(context))
    if (!parsed.body) throw new Error('The response was empty.')
    const existing = row.createNew ? [] : matchTitles(parsed.existingTitles, context.documents)
    const basedOn = context.otherWorldResponses.find((o) => o.ref === parsed.basedOn)?.materialId ?? null
    const matched = new Set(existing.map((d) => d.title.toLowerCase()))
    const unknown = row.createNew ? [] : parsed.existingTitles.filter((t) => !matched.has(t.toLowerCase()))
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const updated = await client.query(
        `UPDATE subpoenas SET status = 'open', draft = $2, flag = $3, unknown_titles = $4, based_on_material_id = $5, error = NULL
         WHERE id = $1 AND status = 'drafting'`,
        [id, parsed.body, parsed.flag, unknown, basedOn],
      )
      if (updated.rowCount) {
        await client.query('DELETE FROM subpoena_existing WHERE subpoena_id = $1', [id])
        for (const [position, doc] of existing.entries()) {
          await client.query('INSERT INTO subpoena_existing (subpoena_id, material_id, position) VALUES ($1, $2, $3)', [
            id,
            doc.id,
            position,
          ])
        }
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    const message =
      err instanceof AiNotConfiguredError
        ? err.message
        : err instanceof Error && err.message
          ? err.message
          : 'The response could not be drafted.'
    await pool.query(`UPDATE subpoenas SET status = 'failed', error = $2 WHERE id = $1 AND status = 'drafting'`, [id, message])
  }
}

/** Everything the recipient reads: the team's case world's whole case file, the facts that stand, and the subpoena. */
async function subpoenaContext(row: DraftRow): Promise<SubpoenaContext> {
  let materials = await listMaterialTexts(row.caseId, row.matchupId)
  if (materials.some((m) => m.textStatus === 'pending')) {
    await finishPendingTranscriptions(materials)
    materials = await listMaterialTexts(row.caseId, row.matchupId)
  }
  const [visible, settled, earlier] = await Promise.all([
    listMaterialsFor(row.caseId, { side: row.side, teamId: row.teamId, matchupId: row.matchupId }),
    settledFacts(row.caseId, row.matchupId),
    earlierResponses(row),
  ])
  const canSee = new Set(visible.map((m) => m.id))
  return {
    caseTitle: row.caseTitle,
    parties: row.parties,
    caseSummary: row.summary,
    disputedIssues: row.disputedIssues,
    side: row.side,
    recipient: row.recipient,
    recipientDescription: row.recipientDescription,
    requestType: row.requestType,
    records: row.records,
    documents: materials
      .filter((m) => m.textStatus === 'ready' && m.text)
      .map((m) => ({ id: m.id, title: m.description || m.filename, teamHasAccess: canSee.has(m.id), content: m.text! })),
    importantFacts: row.importantFacts,
    settled,
    ...earlier,
    instructions: row.instructions,
    createNew: row.createNew,
  }
}

/** The most responses from other case worlds a draft reads (keeps the prompt bounded). */
export const MAX_OTHER_WORLD_RESPONSES = 12

/**
 * The case's earlier subpoenas that got a response: this world's (their
 * response files are in its case file, so a repeat request can produce the
 * same file) and other worlds' (their text, so a repeat request there gets the
 * same records, adapted). Same recipient first, then the same kind, then the
 * oldest (the original a later repeat came from); repeated texts appear once.
 */
async function earlierResponses(row: DraftRow) {
  const { rows } = await pool.query<{
    sameWorld: boolean
    materialId: string
    recipient: string
    requestType: SubpoenaType
    records: string
    responseTitle: string
    response: string | null
  }>(
    `SELECT s.matchup_id IS NOT DISTINCT FROM $3 AS "sameWorld", s.response_material_id AS "materialId", s.recipient,
            s.request_type AS "requestType", s.records,
            ${TITLE} AS "responseTitle", cm.text_content AS response
     FROM subpoenas s JOIN case_materials cm ON cm.id = s.response_material_id
     WHERE s.case_id = $1 AND s.id <> $2 AND s.outcome = 'responded'
     ORDER BY lower(s.recipient) = lower($4) DESC, s.request_type = $5 DESC, s.responded_at`,
    [row.caseId, row.id, row.matchupId, row.recipient.trim(), row.requestType],
  )
  return {
    worldSubpoenas: rows
      .filter((r) => r.sameWorld)
      .map((r) => ({ recipient: r.recipient, requestType: r.requestType, records: r.records, responseTitle: r.responseTitle })),
    otherWorldResponses: rows
      .filter((r, i) => !r.sameWorld && r.response && !rows.slice(0, i).some((o) => !o.sameWorld && o.response === r.response))
      .slice(0, MAX_OTHER_WORLD_RESPONSES)
      .map((r, i) => ({
        ref: `R${i + 1}`,
        materialId: r.materialId,
        recipient: r.recipient,
        requestType: r.requestType,
        records: r.records,
        response: r.response!,
      })),
  }
}

// The instructor's side ---------------------------------------------------------

const COURSE_SELECT = `
  SELECT ${COLUMNS}, s.case_id AS "caseId", c.title AS "caseTitle",
         json_build_object('plaintiff', c.plaintiff_name, 'defendant', c.defendant_name) AS parties,
         json_build_object(
           'firm', coalesce(CASE s.side WHEN 'plaintiff' THEN ie.plaintiff_firm ELSE ie.defense_firm END, ''),
           'partner', coalesce(CASE s.side WHEN 'plaintiff' THEN ie.plaintiff_partner ELSE ie.defense_partner END, '')) AS firm,
         s.world_number AS "worldNumber", s.team_number AS "teamNumber", s.side,
         coalesce((SELECT json_agg(coalesce(u.name, m.email) ORDER BY lower(coalesce(u.name, m.email)))
                   FROM team_members m
                   JOIN enrollments e ON e.course_id = m.course_id AND e.email = m.email
                   LEFT JOIN users u ON u.id = e.user_id
                   WHERE m.team_id = s.team_id), '[]') AS team,
         ru.name AS "respondedBy", s.status, s.draft, s.flag,
         ${filesOf(
           'subpoena_existing',
           'existing',
           `, 'producedToTeam', (SELECT e.team_number FROM subpoenas e WHERE e.response_material_id = d.material_id LIMIT 1)`,
         )},
         (SELECT json_build_object('materialId', b.response_material_id, 'title', ${TITLE.replaceAll('cm.', 'bm.')},
                                   'worldNumber', b.world_number)
          FROM subpoenas b JOIN case_materials bm ON bm.id = b.response_material_id
          WHERE b.response_material_id = s.based_on_material_id LIMIT 1) AS "basedOn",
         s.unknown_titles AS "unknownTitles", s.instructions, s.create_new AS "createNew", s.error
  FROM subpoenas s
  JOIN cases c ON c.id = s.case_id
  LEFT JOIN information_exchange ie ON ie.case_id = s.case_id
  LEFT JOIN users su ON su.id = s.sent_by
  LEFT JOIN users ru ON ru.id = s.responded_by`

/** The parties as named, else from the title, as the subpoena form shows them. */
const withParties = (s: CourseSubpoena): CourseSubpoena => ({ ...s, parties: partyNames(s.caseTitle, s.parties) })

/** The course's subpoenas still to answer (soonest due first), or the answered ones (most recent first). */
export async function listCourseSubpoenas(courseId: string, which: 'open' | 'completed') {
  const { rows } = await pool.query<CourseSubpoena>(
    `${COURSE_SELECT}
     WHERE c.course_id = $1 AND (s.responded_at IS NOT NULL) = $2
     ORDER BY ${which === 'completed' ? 's.responded_at DESC' : 's.due_at, s.sent_at'}`,
    [courseId, which === 'completed'],
  )
  return rows.map(withParties)
}

async function findCourseSubpoena(courseId: string, id: string) {
  const { rows } = await pool.query<CourseSubpoena>(`${COURSE_SELECT} WHERE c.course_id = $1 AND s.id = $2`, [courseId, id])
  if (!rows[0]) throw new HttpError(404, 'Subpoena not found.')
  return withParties(rows[0])
}

/** How many subpoenas in the course are waiting for the instructor's answer. */
export async function openSubpoenaCount(courseId: string) {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM subpoenas s JOIN cases c ON c.id = s.case_id
     WHERE c.course_id = $1 AND s.responded_at IS NULL`,
    [courseId],
  )
  return rows[0].n
}

/** A file name made from a title: no path separators, and whitespace runs collapse to a space. */
const fileName = (title: string) => `${title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()}.txt`

/**
 * Approves the response, as drafted or as the instructor edited it: it
 * becomes a case file of the team's case world, shared with the team along
 * with the existing files the draft produced, and the team is notified.
 */
export async function approveSubpoena(courseId: string, id: string, userId: string, text: string) {
  const subpoena = await findCourseSubpoena(courseId, id)
  if (subpoena.respondedAt) throw new HttpError(409, 'This subpoena has already been answered.')
  if (subpoena.status !== 'open') throw new HttpError(409, 'Wait for the draft response first.')
  const response = text.trim()
  if (!response) throw new HttpError(400, 'Write the response, or deny the subpoena.')
  if (response.length > MAX_RESPONSE_LENGTH) throw new HttpError(400, `Keep the response to ${MAX_RESPONSE_LENGTH} characters.`)
  const { rows: worldRows } = await pool.query<{ matchupId: string | null; teamId: string }>(
    'SELECT matchup_id AS "matchupId", team_id AS "teamId" FROM subpoenas WHERE id = $1',
    [id],
  )
  const { matchupId, teamId } = worldRows[0]

  const title = `Response of ${subpoena.recipient} to subpoena (Team ${subpoena.teamNumber})`
  const materialId = randomUUID()
  const storageKey = `cases/${subpoena.caseId}/${materialId}`
  const data = Buffer.from(response, 'utf8')
  await storage.put(storageKey, data, 'text/plain')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<{ id: string }>(
      `UPDATE subpoenas SET outcome = 'responded', status = 'answered', response = $2, responded_at = now(), responded_by = $3
       WHERE id = $1 AND responded_at IS NULL AND status = 'open' RETURNING id`,
      [id, response, userId],
    )
    if (!rows[0]) throw new HttpError(409, 'This subpoena has already been answered.')
    await createMaterial(
      {
        id: materialId,
        caseId: subpoena.caseId,
        audience: 'instructor',
        filename: fileName(title),
        description: title,
        contentType: 'text/plain',
        sizeBytes: data.length,
        storageKey,
        uploadedBy: userId,
        matchupId,
      },
      client,
    )
    // The text is the file, so later witnesses and subpoenas read it at once.
    await client.query(`UPDATE case_materials SET text_status = 'ready', text_content = $2 WHERE id = $1`, [materialId, response])
    // Later subpoenas for the same thing reuse it (see earlierResponses).
    await client.query('UPDATE subpoenas SET response_material_id = $2 WHERE id = $1', [id, materialId])
    const produced = [materialId, ...subpoena.existing.map((d) => d.materialId)]
    for (const [position, material] of produced.entries()) {
      await client.query('INSERT INTO subpoena_documents (subpoena_id, material_id, position) VALUES ($1, $2, $3)', [
        id,
        material,
        position,
      ])
      await shareMaterialWithTeam(material, teamId, client)
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    await storage.delete([storageKey]).catch(() => {})
    throw err
  } finally {
    client.release()
  }
  return findCourseSubpoena(courseId, id)
}

/** Denies the subpoena, with an optional note for the team; nothing is produced. */
export async function denySubpoena(courseId: string, id: string, userId: string, note: string) {
  const subpoena = await findCourseSubpoena(courseId, id)
  if (subpoena.respondedAt) throw new HttpError(409, 'This subpoena has already been answered.')
  const text = note.trim()
  if (text.length > MAX_NOTE_LENGTH) throw new HttpError(400, `Keep the note to ${MAX_NOTE_LENGTH} characters.`)
  const { rowCount } = await pool.query(
    `UPDATE subpoenas SET outcome = 'denied', status = 'answered', response = $2, responded_at = now(), responded_by = $3
     WHERE id = $1 AND responded_at IS NULL`,
    [id, text || null, userId],
  )
  if (!rowCount) throw new HttpError(409, 'This subpoena has already been answered.')
  return findCourseSubpoena(courseId, id)
}

/**
 * Has the AI draft the response again, following the instructor's notes; with
 * `createNew`, as a new file rather than existing ones. Also retries a draft
 * that failed.
 */
export async function redraftSubpoena(
  courseId: string,
  id: string,
  { instructions, createNew }: { instructions: string; createNew: boolean },
) {
  const subpoena = await findCourseSubpoena(courseId, id)
  if (subpoena.respondedAt) throw new HttpError(409, 'This subpoena has already been answered.')
  if (subpoena.status === 'drafting') throw new HttpError(409, 'A response is already being drafted.')
  const notes = instructions.trim()
  if (notes.length > MAX_NOTE_LENGTH) throw new HttpError(400, `Keep the notes to ${MAX_NOTE_LENGTH} characters.`)
  const { rowCount } = await pool.query(
    `UPDATE subpoenas SET status = 'drafting', instructions = $2, create_new = $3, based_on_material_id = NULL, error = NULL
     WHERE id = $1 AND responded_at IS NULL AND status IN ('open', 'failed')`,
    [id, notes, createNew],
  )
  if (!rowCount) throw new HttpError(409, 'A response is already being drafted.')
  // Read before the draft starts, so the instructor sees it drafting.
  const drafting = await findCourseSubpoena(courseId, id)
  queueSubpoena(id)
  return drafting
}
