import { randomInt } from 'node:crypto'
import type { PoolClient } from 'pg'
import { pool } from '../db/pool.ts'
import { HttpError } from '../httpError.ts'
import type { RosterEntry } from './roster.ts'

/** Two is the norm; three only absorbs the odd student out. */
export const MAX_TEAM_SIZE = 3

// Shapes sent to the client; match `Team` and `CaseTeams` in src/courses/types.ts.
export interface Team {
  id: string
  number: number
  members: RosterEntry[]
}

export interface CaseTeams {
  teams: Team[]
  /** Roster students not on a team for this case yet. */
  unpaired: RosterEntry[]
}

/** The case's teams by number, plus everyone on the roster still unpaired. */
export async function listTeams(courseId: string, caseId: string, db: Pick<PoolClient, 'query'> = pool) {
  const { rows: teams } = await db.query<Team>(
    `SELECT t.id, t.number,
            coalesce(
              json_agg(json_build_object('email', m.email, 'name', u.name, 'joined', e.user_id IS NOT NULL)
                       ORDER BY e.user_id IS NULL, lower(u.name), m.email)
                FILTER (WHERE m.email IS NOT NULL),
              '[]') AS members
     FROM teams t
     LEFT JOIN team_members m ON m.team_id = t.id
     LEFT JOIN enrollments e ON e.course_id = m.course_id AND e.email = m.email
     LEFT JOIN users u ON u.id = e.user_id
     WHERE t.case_id = $1
     GROUP BY t.id
     ORDER BY t.number`,
    [caseId],
  )
  const { rows: unpaired } = await db.query<RosterEntry>(
    `SELECT e.email, u.name, e.user_id IS NOT NULL AS joined
     FROM enrollments e
     LEFT JOIN users u ON u.id = e.user_id
     WHERE e.course_id = $1
       AND NOT EXISTS (SELECT 1 FROM team_members m WHERE m.case_id = $2 AND m.email = e.email)
     ORDER BY e.user_id IS NULL, lower(u.name), e.email`,
    [courseId, caseId],
  )
  return { teams, unpaired } satisfies CaseTeams
}

/**
 * Runs `change` in a transaction holding the case's row lock, so concurrent
 * edits to one case's teams (and their numbers) happen one at a time, and
 * returns the teams afterwards.
 */
async function changeTeams(
  courseId: string,
  caseId: string,
  change: (client: PoolClient) => Promise<void>,
): Promise<CaseTeams> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT 1 FROM cases WHERE id = $1 FOR UPDATE', [caseId])
    await change(client)
    const result = await listTeams(courseId, caseId, client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/** Throws unless every email is on the roster and not yet on a team for this case. */
async function assertUnpaired(client: PoolClient, courseId: string, caseId: string, emails: string[]) {
  const { rows } = await client.query<{ email: string; paired: boolean }>(
    `SELECT e.email,
            EXISTS (SELECT 1 FROM team_members m WHERE m.case_id = $2 AND m.email = e.email) AS paired
     FROM enrollments e
     WHERE e.course_id = $1 AND e.email = ANY($3)`,
    [courseId, caseId, emails],
  )
  const found = new Map(rows.map((r) => [r.email, r.paired]))
  for (const email of emails) {
    if (!found.has(email)) throw new HttpError(400, `${email} is not on the course roster.`)
    if (found.get(email)) throw new HttpError(409, `${email} is already on a team for this case.`)
  }
}

async function insertTeam(client: PoolClient, courseId: string, caseId: string, emails: string[]) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO teams (case_id, number)
     SELECT $1, coalesce(max(number), 0) + 1 FROM teams WHERE case_id = $1
     RETURNING id`,
    [caseId],
  )
  await insertMembers(client, courseId, caseId, rows[0].id, emails)
}

async function insertMembers(
  client: PoolClient,
  courseId: string,
  caseId: string,
  teamId: string,
  emails: string[],
) {
  await client.query(
    `INSERT INTO team_members (team_id, case_id, course_id, email)
     SELECT $1, $2, $3, unnest($4::text[])`,
    [teamId, caseId, courseId, emails],
  )
}

/** Pairs the given students into a new team. */
export function createTeam(courseId: string, caseId: string, emails: string[]) {
  return changeTeams(courseId, caseId, async (client) => {
    await assertUnpaired(client, courseId, caseId, emails)
    await insertTeam(client, courseId, caseId, emails)
  })
}

export function addMember(courseId: string, caseId: string, teamId: string, email: string) {
  return changeTeams(courseId, caseId, async (client) => {
    const { rows } = await client.query<{ size: number }>(
      `SELECT (SELECT count(*)::int FROM team_members m WHERE m.team_id = t.id) AS size
       FROM teams t WHERE t.id = $1 AND t.case_id = $2`,
      [teamId, caseId],
    )
    if (!rows[0]) throw new HttpError(404, 'Team not found.')
    if (rows[0].size >= MAX_TEAM_SIZE) {
      throw new HttpError(409, `A team can have at most ${MAX_TEAM_SIZE} students.`)
    }
    await assertUnpaired(client, courseId, caseId, [email])
    await insertMembers(client, courseId, caseId, teamId, [email])
  })
}

/** Takes a student off a team; a team left with no one is deleted. */
export function removeMember(courseId: string, caseId: string, teamId: string, email: string) {
  return changeTeams(courseId, caseId, async (client) => {
    const { rowCount } = await client.query(
      'DELETE FROM team_members WHERE team_id = $1 AND case_id = $2 AND email = $3',
      [teamId, caseId, email],
    )
    if (rowCount !== 1) throw new HttpError(404, 'That student is not on this team.')
    await deleteEmptyTeams(client, caseId)
  })
}

export function deleteTeam(courseId: string, caseId: string, teamId: string) {
  return changeTeams(courseId, caseId, async (client) => {
    const { rowCount } = await client.query('DELETE FROM teams WHERE id = $1 AND case_id = $2', [
      teamId,
      caseId,
    ])
    if (rowCount !== 1) throw new HttpError(404, 'Team not found.')
  })
}

/** Unpairs everyone in the case. */
export function clearTeams(courseId: string, caseId: string) {
  return changeTeams(courseId, caseId, async (client) => {
    await client.query('DELETE FROM teams WHERE case_id = $1', [caseId])
  })
}

async function deleteEmptyTeams(client: PoolClient, caseId: string) {
  await client.query(
    `DELETE FROM teams t
     WHERE t.case_id = $1 AND NOT EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = t.id)`,
    [caseId],
  )
}

/**
 * Pairs every unpaired student in the case at random, avoiding anyone they
 * were teamed with in the course's other cases where possible.
 */
export function autoPair(courseId: string, caseId: string) {
  return changeTeams(courseId, caseId, async (client) => {
    const { unpaired } = await listTeams(courseId, caseId, client)
    if (unpaired.length === 0) throw new HttpError(409, 'Everyone is already on a team.')

    const { rows } = await client.query<{ a: string; b: string }>(
      `SELECT a.email AS a, b.email AS b
       FROM team_members a
       JOIN team_members b ON b.team_id = a.team_id AND b.email <> a.email
       WHERE a.course_id = $1 AND a.case_id <> $2`,
      [courseId, caseId],
    )
    const past = new Set(rows.map((r) => partnerKey(r.a, r.b)))

    for (const group of pairStudents(unpaired.map((s) => s.email), past)) {
      await insertTeam(client, courseId, caseId, group)
    }
  })
}

export const partnerKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

/**
 * Splits students into random pairs, preferring partners who are not in
 * `pastPartners` (keys from `partnerKey`). With an odd count, the last
 * student joins one of the pairs; a lone student makes a team of one.
 */
export function pairStudents(
  emails: string[],
  pastPartners: Set<string>,
  random: (max: number) => number = randomInt,
): string[][] {
  const remaining = [...emails]
  for (let i = remaining.length - 1; i > 0; i--) {
    const j = random(i + 1)
    ;[remaining[i], remaining[j]] = [remaining[j], remaining[i]]
  }

  const fresh = (a: string, b: string) => !pastPartners.has(partnerKey(a, b))
  const groups: string[][] = []
  while (remaining.length >= 2) {
    const a = remaining.shift()!
    const index = Math.max(0, remaining.findIndex((b) => fresh(a, b)))
    groups.push([a, ...remaining.splice(index, 1)])
  }

  if (remaining.length === 1) {
    const [last] = remaining
    const group = groups.find((g) => g.every((m) => fresh(last, m))) ?? groups.at(-1)
    if (group) group.push(last)
    else groups.push([last])
  }
  return groups
}

// Shape sent to the client; matches `MyCase` in src/courses/types.ts.
export interface MyCase {
  id: string
  title: string
  summary: string
  status: 'active' | 'closed'
  /** Null until the instructor pairs this student for the case. */
  team: { number: number; members: (RosterEntry & { you: boolean })[] } | null
}

/** A student's view of the course's cases: everything but drafts, with their team in each. */
export async function listMyCases(courseId: string, userId: string) {
  const { rows } = await pool.query<MyCase>(
    `SELECT c.id, c.title, c.summary, c.status,
            (SELECT json_build_object(
                      'number', t.number,
                      'members', (SELECT json_agg(
                                           json_build_object('email', m.email, 'name', u.name,
                                                             'joined', e.user_id IS NOT NULL,
                                                             'you', e.user_id IS NOT DISTINCT FROM $2::uuid)
                                           ORDER BY e.user_id IS DISTINCT FROM $2::uuid, lower(u.name), m.email)
                                  FROM team_members m
                                  JOIN enrollments e ON e.course_id = m.course_id AND e.email = m.email
                                  LEFT JOIN users u ON u.id = e.user_id
                                  WHERE m.team_id = t.id))
             FROM team_members mine
             JOIN enrollments me ON me.course_id = mine.course_id AND me.email = mine.email
             JOIN teams t ON t.id = mine.team_id
             WHERE mine.case_id = c.id AND me.user_id = $2) AS team
     FROM cases c
     WHERE c.course_id = $1 AND c.status <> 'draft'
     ORDER BY c.created_at, c.title`,
    [courseId, userId],
  )
  return rows
}
