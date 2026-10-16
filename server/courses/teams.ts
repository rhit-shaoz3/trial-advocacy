import { randomInt } from 'node:crypto'
import type { PoolClient } from 'pg'
import { pool } from '../db/pool.ts'
import { HttpError } from '../httpError.ts'
import type { RosterEntry } from './roster.ts'

/** The largest team auto-pair aims for; a leftover student can push a team one past it. */
export const MAX_AUTO_TEAM_SIZE = 5
export const MAX_TEAM_SIZE = MAX_AUTO_TEAM_SIZE + 1

// Shapes sent to the client; match `Team`, `Matchup`, and `CaseTeams` in src/courses/types.ts.
export interface Team {
  id: string
  number: number
  members: RosterEntry[]
}

/** One case world: two teams on opposite sides. `number` 1 is World A. */
export interface Matchup {
  id: string
  number: number
  plaintiffTeamId: string
  defenseTeamId: string
}

/** Everything about how a case is paired. Every team or matchup change responds with this. */
export interface CaseTeams {
  teams: Team[]
  /** Roster students not on a team for this case yet. */
  unpaired: RosterEntry[]
  matchups: Matchup[]
}

/** Roster statuses that can be put on a team: members, and students the instructor invited. */
const TEAMABLE = "('joined', 'invited')"

/**
 * The case's teams by number, everyone still unpaired, and the matchups.
 * Students the instructor added count even before they accept their
 * invitation; students who asked to join (not yet admitted) or were denied don't.
 */
export async function listTeams(courseId: string, caseId: string, db: Pick<PoolClient, 'query'> = pool) {
  const { rows: teams } = await db.query<Team>(
    `SELECT t.id, t.number,
            coalesce(
              json_agg(json_build_object('email', m.email, 'name', u.name, 'userId', u.id, 'status', e.status)
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
    `SELECT e.email, u.name, u.id AS "userId", e.status
     FROM enrollments e
     LEFT JOIN users u ON u.id = e.user_id
     WHERE e.course_id = $1 AND e.status IN ${TEAMABLE}
       AND NOT EXISTS (SELECT 1 FROM team_members m WHERE m.case_id = $2 AND m.email = e.email)
     ORDER BY e.user_id IS NULL, lower(u.name), e.email`,
    [courseId, caseId],
  )
  const { rows: matchups } = await db.query<Matchup>(
    `SELECT mu.id, mu.number, p.team_id AS "plaintiffTeamId", d.team_id AS "defenseTeamId"
     FROM matchups mu
     JOIN matchup_teams p ON p.matchup_id = mu.id AND p.side = 'plaintiff'
     JOIN matchup_teams d ON d.matchup_id = mu.id AND d.side = 'defense'
     WHERE mu.case_id = $1
     ORDER BY mu.number`,
    [caseId],
  )
  return { teams, unpaired, matchups } satisfies CaseTeams
}

/**
 * Runs `change` in a transaction holding the case's row lock, so concurrent
 * edits to one case's teams and matchups (and their numbers) happen one at a
 * time, and returns the pairing afterwards. A matchup that lost a team is
 * deleted, putting its other team back in the pool.
 */
export async function changeTeams(
  courseId: string,
  caseId: string,
  change: (client: PoolClient) => Promise<void>,
): Promise<CaseTeams> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT 1 FROM cases WHERE id = $1 FOR UPDATE', [caseId])
    await change(client)
    await client.query(
      `DELETE FROM matchups mu
       WHERE mu.case_id = $1 AND (SELECT count(*) FROM matchup_teams mt WHERE mt.matchup_id = mu.id) < 2`,
      [caseId],
    )
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
     WHERE e.course_id = $1 AND e.email = ANY($3) AND e.status IN ${TEAMABLE}`,
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

/** Takes a student off a team; a team left with no one is deleted, with its matchup. */
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

/** Also deletes the team's matchup. */
export function deleteTeam(courseId: string, caseId: string, teamId: string) {
  return changeTeams(courseId, caseId, async (client) => {
    const { rowCount } = await client.query('DELETE FROM teams WHERE id = $1 AND case_id = $2', [
      teamId,
      caseId,
    ])
    if (rowCount !== 1) throw new HttpError(404, 'Team not found.')
  })
}

/** Unpairs everyone in the case, which also removes the matchups. */
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
 * Pairs every unpaired student in the case at random into teams of
 * `teamSize`, avoiding anyone they were teamed with in the course's other
 * cases where possible.
 */
export function autoPair(courseId: string, caseId: string, teamSize = 2) {
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

    for (const group of pairStudents(unpaired.map((s) => s.email), past, randomInt, teamSize)) {
      await insertTeam(client, courseId, caseId, group)
    }
  })
}

export const partnerKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

/**
 * Splits students into random teams of `size`, preferring partners who are
 * not in `pastPartners` (keys from `partnerKey`). Students left over join
 * the teams one each, or make a smaller team of their own when there are
 * more of them than teams (a lone student makes a team of one).
 */
export function pairStudents(
  emails: string[],
  pastPartners: Set<string>,
  random: (max: number) => number = randomInt,
  size = 2,
): string[][] {
  const remaining = [...emails]
  for (let i = remaining.length - 1; i > 0; i--) {
    const j = random(i + 1)
    ;[remaining[i], remaining[j]] = [remaining[j], remaining[i]]
  }

  const fresh = (a: string, b: string) => !pastPartners.has(partnerKey(a, b))
  const groups: string[][] = []
  while (remaining.length >= size) {
    const group = [remaining.shift()!]
    while (group.length < size) {
      const index = Math.max(0, remaining.findIndex((b) => group.every((m) => fresh(m, b))))
      group.push(...remaining.splice(index, 1))
    }
    groups.push(group)
  }

  if (remaining.length > groups.length) {
    if (remaining.length > 0) groups.push(remaining)
    return groups
  }
  const open = [...groups]
  for (const last of remaining) {
    const group = open.find((g) => g.every((m) => fresh(last, m))) ?? open.at(-1)!
    group.push(last)
    open.splice(open.indexOf(group), 1)
  }
  return groups
}
