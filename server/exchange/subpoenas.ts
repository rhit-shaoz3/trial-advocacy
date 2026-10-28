import type { PoolClient } from 'pg'
import { shareMaterialWithTeam } from '../courses/caseContent.ts'
import type { Side } from '../courses/matchups.ts'
import { pool } from '../db/pool.ts'
import { HttpError } from '../httpError.ts'
import { findTeamWorld } from '../reviews/reviews.ts'
import type { PartSettings, TeamContext } from './exchange.ts'

// Subpoenas: from the information exchange phase on, a team serves a person or
// organization (a hospital, a regulator, the ride's maker) for records it
// doesn't have. The instructor answers each one on the Review page, as the
// recipient: complied, with a response and any case files produced (shared
// with the team), or quashed, with the reason. The other team in the case
// world gets notice of each subpoena (FRCP 45(a)(4)), but not what came back.

export const SUBPOENA_OUTCOMES = ['complied', 'quashed'] as const
export type SubpoenaOutcome = (typeof SUBPOENA_OUTCOMES)[number]

export const MAX_RECIPIENT_LENGTH = 200
export const MAX_RECORDS_LENGTH = 4000
export const MAX_RESPONSE_LENGTH = 4000

/** A produced case file, by the title students see. */
export interface ProducedDocument {
  materialId: string
  title: string
}

// Shape sent to the client; matches `TeamSubpoena` in src/courses/types.ts.
export interface TeamSubpoena {
  id: string
  recipient: string
  records: string
  sentBy: string | null
  sentAt: Date
  dueAt: Date
  outcome: SubpoenaOutcome | null
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
  records: string
  sentAt: Date
}

// Shape sent to the client; matches `CourseSubpoena` in src/courses/types.ts.
export interface CourseSubpoena extends Omit<TeamSubpoena, 'seen'> {
  caseId: string
  caseTitle: string
  worldNumber: number
  teamNumber: number
  side: Side
  /** The team's members, by name (or email). */
  team: string[]
  respondedBy: string | null
}

const DOCUMENTS = `coalesce((SELECT json_agg(json_build_object('materialId', d.material_id,
                                    'title', coalesce(nullif(cm.description, ''), cm.filename)) ORDER BY d.position)
                  FROM subpoena_documents d JOIN case_materials cm ON cm.id = d.material_id
                  WHERE d.subpoena_id = s.id), '[]') AS documents`

const COLUMNS = `s.id, s.recipient, s.records, su.name AS "sentBy", s.sent_at AS "sentAt", s.due_at AS "dueAt",
  s.outcome, s.response, s.responded_at AS "respondedAt", ${DOCUMENTS}`

/** How many subpoenas a team has served. */
export async function subpoenaCount(caseId: string, teamId: string, db: Pick<PoolClient, 'query'> = pool) {
  const { rows } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM subpoenas WHERE case_id = $1 AND team_id = $2', [
    caseId,
    teamId,
  ])
  return rows[0].n
}

/** The team's subpoenas, newest first, with the answers once they're in. */
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
export async function subpoenaNotices(caseId: string, teamId: string): Promise<SubpoenaNotice[]> {
  const { rows } = await pool.query<SubpoenaNotice>(
    `SELECT s.id, s.team_number AS "teamNumber", s.recipient, s.records, s.sent_at AS "sentAt"
     FROM subpoenas s JOIN matchup_teams me ON me.matchup_id = s.matchup_id AND me.team_id = $2
     WHERE s.case_id = $1 AND s.team_id <> $2
     ORDER BY s.sent_at DESC`,
    [caseId, teamId],
  )
  return rows
}

/** Serves a subpoena, due `part.days` from now. Refused past the team's limit (partners serving at once are checked in turn). */
export async function serveSubpoena(ctx: TeamContext, part: PartSettings, recipient: string, records: string) {
  const to = recipient.trim()
  const what = records.trim()
  if (!to) throw new HttpError(400, 'Say who the subpoena is for.')
  if (!what) throw new HttpError(400, 'Describe the records you want.')
  if (to.length > MAX_RECIPIENT_LENGTH) throw new HttpError(400, `Keep the recipient to ${MAX_RECIPIENT_LENGTH} characters.`)
  if (what.length > MAX_RECORDS_LENGTH) throw new HttpError(400, `Keep the records to ${MAX_RECORDS_LENGTH} characters.`)
  const world = await findTeamWorld(ctx.teamId)
  if (!world) throw new HttpError(409, 'Your team needs a case world first.')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT 1 FROM teams WHERE id = $1 FOR UPDATE', [ctx.teamId])
    const left = part.limit - (await subpoenaCount(ctx.caseId, ctx.teamId, client))
    if (left <= 0) throw new HttpError(409, 'Your team is out of subpoenas.')
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO subpoenas (case_id, team_id, matchup_id, world_number, team_number, side, recipient, records, sent_by, due_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + make_interval(days => $10)) RETURNING id`,
      [ctx.caseId, ctx.teamId, world.matchupId, world.worldNumber, world.teamNumber, world.side, to, what, ctx.userId, part.days],
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

/** Marks the answers to the team's subpoenas as read by this student. */
export async function markSubpoenasSeen(caseId: string, teamId: string, userId: string) {
  await pool.query(
    `INSERT INTO subpoena_seen (subpoena_id, user_id)
     SELECT id, $3 FROM subpoenas WHERE case_id = $1 AND team_id = $2 AND responded_at IS NOT NULL
     ON CONFLICT DO NOTHING`,
    [caseId, teamId, userId],
  )
}

// The instructor's side ---------------------------------------------------------

const COURSE_SELECT = `
  SELECT ${COLUMNS}, s.case_id AS "caseId", c.title AS "caseTitle",
         s.world_number AS "worldNumber", s.team_number AS "teamNumber", s.side,
         coalesce((SELECT json_agg(coalesce(u.name, m.email) ORDER BY lower(coalesce(u.name, m.email)))
                   FROM team_members m
                   JOIN enrollments e ON e.course_id = m.course_id AND e.email = m.email
                   LEFT JOIN users u ON u.id = e.user_id
                   WHERE m.team_id = s.team_id), '[]') AS team,
         ru.name AS "respondedBy"
  FROM subpoenas s
  JOIN cases c ON c.id = s.case_id
  LEFT JOIN users su ON su.id = s.sent_by
  LEFT JOIN users ru ON ru.id = s.responded_by`

/** The course's subpoenas still to answer (soonest due first), or the answered ones (most recent first). */
export async function listCourseSubpoenas(courseId: string, which: 'open' | 'completed') {
  const { rows } = await pool.query<CourseSubpoena>(
    `${COURSE_SELECT}
     WHERE c.course_id = $1 AND (s.responded_at IS NOT NULL) = $2
     ORDER BY ${which === 'completed' ? 's.responded_at DESC' : 's.due_at, s.sent_at'}`,
    [courseId, which === 'completed'],
  )
  return rows
}

async function findCourseSubpoena(courseId: string, id: string) {
  const { rows } = await pool.query<CourseSubpoena>(`${COURSE_SELECT} WHERE c.course_id = $1 AND s.id = $2`, [courseId, id])
  if (!rows[0]) throw new HttpError(404, 'Subpoena not found.')
  return rows[0]
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

/**
 * The instructor's answer, once: complied (a response, files produced, or
 * both; the files are shared with the team) or quashed (with the reason).
 */
export async function answerSubpoena(
  courseId: string,
  id: string,
  userId: string,
  answer: { outcome: SubpoenaOutcome; response: string; materialIds: string[] },
) {
  const subpoena = await findCourseSubpoena(courseId, id)
  if (subpoena.respondedAt) throw new HttpError(409, 'This subpoena has already been answered.')
  const response = answer.response.trim()
  const materialIds = answer.outcome === 'complied' ? [...new Set(answer.materialIds)] : []
  if (response.length > MAX_RESPONSE_LENGTH) throw new HttpError(400, `Keep the response to ${MAX_RESPONSE_LENGTH} characters.`)
  if (answer.outcome === 'quashed' && !response) throw new HttpError(400, 'Say why the subpoena is quashed.')
  if (answer.outcome === 'complied' && !response && materialIds.length === 0) {
    throw new HttpError(400, 'Produce at least one case file, or write a response.')
  }
  if (materialIds.length > 0) {
    const { rows } = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM case_materials WHERE case_id = $1 AND id = ANY($2::uuid[])',
      [subpoena.caseId, materialIds],
    )
    if (rows[0].n !== materialIds.length) throw new HttpError(400, 'Produce files from this case.')
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<{ teamId: string }>(
      `UPDATE subpoenas SET outcome = $2, response = $3, responded_at = now(), responded_by = $4
       WHERE id = $1 AND responded_at IS NULL RETURNING team_id AS "teamId"`,
      [id, answer.outcome, response || null, userId],
    )
    if (!rows[0]) throw new HttpError(409, 'This subpoena has already been answered.')
    for (const [position, materialId] of materialIds.entries()) {
      await client.query('INSERT INTO subpoena_documents (subpoena_id, material_id, position) VALUES ($1, $2, $3)', [
        id,
        materialId,
        position,
      ])
      await shareMaterialWithTeam(materialId, rows[0].teamId, client)
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
  return findCourseSubpoena(courseId, id)
}
