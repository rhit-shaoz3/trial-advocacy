import { randomInt } from 'node:crypto'
import type { PoolClient } from 'pg'
import { avatarUrlSql } from '../auth/users.ts'
import { pool } from '../db/pool.ts'
import { HttpError } from '../httpError.ts'
import type { RosterEntry } from './roster.ts'

/** Two is the norm; three only absorbs the odd student out. */
/** Auto-pair makes teams of this many students, as the instructor chooses. */
export const MIN_AUTO_TEAM_SIZE = 2
export const MAX_AUTO_TEAM_SIZE = 6
/** The most a team can hold, leaving room to add a leftover student by hand. */
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
  /** The world has facts or files of its own, so its teams are set. */
  locked: boolean
}

/** Everything about how a case is paired. Every team or matchup change responds with this. */
export interface CaseTeams {
  teams: Team[]
  /** Roster students not on a team for this case yet. */
  unpaired: RosterEntry[]
  matchups: Matchup[]
  /** The case has left the introduction phase: every world is locked, and no new teams or worlds can be made. */
  worldsLocked: boolean
}

type Db = Pick<PoolClient, 'query'>

/** The case world's letter: 1 → "A", 27 → "AA" (like worldLabel in src/courses). */
export const worldLetter = (number: number) => {
  let label = ''
  for (let n = number; n > 0; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + ((n - 1) % 26)) + label
  return label
}

/** Whether the case has left the introduction phase, which locks the worlds it had then for good. */
async function caseLocked(db: Db, caseId: string) {
  const { rows } = await db.query<{ locked: boolean }>(
    'SELECT worlds_locked_at IS NOT NULL AS locked FROM cases WHERE id = $1',
    [caseId],
  )
  return rows[0]?.locked ?? false
}

/**
 * The case's locked worlds: every world made before the case left the
 * introduction phase, and otherwise each world with something of its own,
 * since changing its teams would strand it: an interview a team has had
 * answers in, a review or investigator request, a subpoena or exchange
 * request, or a file only that world has. Instructor test interviews (with no
 * team) don't count.
 */
export async function lockedWorlds(db: Db, caseId: string) {
  const { rows } = await db.query<{ id: string; number: number; plaintiffTeamId: string; defenseTeamId: string }>(
    `SELECT mu.id, mu.number, p.team_id AS "plaintiffTeamId", d.team_id AS "defenseTeamId"
     FROM matchups mu
     JOIN cases c ON c.id = mu.case_id
     JOIN matchup_teams p ON p.matchup_id = mu.id AND p.side = 'plaintiff'
     JOIN matchup_teams d ON d.matchup_id = mu.id AND d.side = 'defense'
     WHERE mu.case_id = $1 AND (
       mu.created_at <= c.worlds_locked_at
       OR EXISTS (SELECT 1 FROM interview_reviews r WHERE r.matchup_id = mu.id OR r.team_id IN (p.team_id, d.team_id))
       OR EXISTS (SELECT 1 FROM interviews i JOIN interview_turns it ON it.interview_id = i.id
                  WHERE i.team_id IN (p.team_id, d.team_id))
       OR EXISTS (SELECT 1 FROM subpoenas s WHERE s.matchup_id = mu.id OR s.team_id IN (p.team_id, d.team_id))
       OR EXISTS (SELECT 1 FROM exchange_requests e
                  WHERE e.from_team_id IN (p.team_id, d.team_id) OR e.to_team_id IN (p.team_id, d.team_id))
       OR EXISTS (SELECT 1 FROM case_materials cm WHERE cm.matchup_id = mu.id)
     )
     ORDER BY mu.number`,
    [caseId],
  )
  return rows
}

/** Throws if a change left a locked world with different teams. */
async function assertLockedKept(db: Db, caseId: string, before: Awaited<ReturnType<typeof lockedWorlds>>) {
  if (before.length === 0) return
  const { rows } = await db.query<{ matchupId: string; teamId: string; side: string }>(
    'SELECT matchup_id AS "matchupId", team_id AS "teamId", side FROM matchup_teams WHERE case_id = $1',
    [caseId],
  )
  for (const world of before) {
    const sides = rows.filter((r) => r.matchupId === world.id)
    if (
      sides.find((r) => r.side === 'plaintiff')?.teamId !== world.plaintiffTeamId ||
      sides.find((r) => r.side === 'defense')?.teamId !== world.defenseTeamId
    ) {
      throw new HttpError(
        409,
        `World ${worldLetter(world.number)} is locked because it already has its own facts, so its teams can't change. You can still move students between teams.`,
      )
    }
  }
}

/** Throws if taking a student off `teamId` left it empty while its world is locked (an empty team is deleted). */
async function assertNotEmptied(db: Db, caseId: string, teamId: string) {
  const { rows } = await db.query<{ number: number; members: number }>(
    `SELECT t.number, (SELECT count(*)::int FROM team_members m WHERE m.team_id = t.id) AS members
     FROM teams t WHERE t.id = $1`,
    [teamId],
  )
  if (!rows[0] || rows[0].members > 0) return
  const world = (await lockedWorlds(db, caseId)).find((w) => w.plaintiffTeamId === teamId || w.defenseTeamId === teamId)
  if (world) {
    throw new HttpError(
      409,
      `Team ${rows[0].number} is in World ${worldLetter(world.number)}, which is locked, so it needs at least one student.`,
    )
  }
}

/** The case's teams by number, everyone on the roster still unpaired, and the matchups. */
export async function listTeams(courseId: string, caseId: string, db: Db = pool) {
  const { rows: teams } = await db.query<Team>(
    `SELECT t.id, t.number,
            coalesce(
              json_agg(json_build_object('email', m.email, 'name', u.name, 'joined', e.user_id IS NOT NULL,
                                'avatarUrl', ${avatarUrlSql('u')})
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
    `SELECT e.email, u.name, e.user_id IS NOT NULL AS joined, ${avatarUrlSql('u')} AS "avatarUrl"
     FROM enrollments e
     LEFT JOIN users u ON u.id = e.user_id
     WHERE e.course_id = $1
       AND NOT EXISTS (SELECT 1 FROM team_members m WHERE m.case_id = $2 AND m.email = e.email)
     ORDER BY e.user_id IS NULL, lower(u.name), e.email`,
    [courseId, caseId],
  )
  const { rows: worlds } = await db.query<Omit<Matchup, 'locked'>>(
    `SELECT mu.id, mu.number, p.team_id AS "plaintiffTeamId", d.team_id AS "defenseTeamId"
     FROM matchups mu
     JOIN matchup_teams p ON p.matchup_id = mu.id AND p.side = 'plaintiff'
     JOIN matchup_teams d ON d.matchup_id = mu.id AND d.side = 'defense'
     WHERE mu.case_id = $1
     ORDER BY mu.number`,
    [caseId],
  )
  const locked = new Set((await lockedWorlds(db, caseId)).map((w) => w.id))
  const matchups = worlds.map((m) => ({ ...m, locked: locked.has(m.id) }))
  return { teams, unpaired, matchups, worldsLocked: await caseLocked(db, caseId) } satisfies CaseTeams
}

/**
 * Runs `change` in a transaction holding the case's row lock, so concurrent
 * edits to one case's teams and matchups (and their numbers) happen one at a
 * time, and returns the pairing afterwards. A matchup that lost a team is
 * deleted, putting its other team back in the pool. A locked world must come
 * out with the same teams on the same sides, each with someone on it.
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
    const locked = await lockedWorlds(client, caseId)
    await change(client)
    await assertLockedKept(client, caseId, locked)
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

/** Throws unless the team is in the case and has room for one more. */
async function assertRoom(client: PoolClient, caseId: string, teamId: string) {
  const { rows } = await client.query<{ size: number }>(
    `SELECT (SELECT count(*)::int FROM team_members m WHERE m.team_id = t.id) AS size
     FROM teams t WHERE t.id = $1 AND t.case_id = $2`,
    [teamId, caseId],
  )
  if (!rows[0]) throw new HttpError(404, 'Team not found.')
  if (rows[0].size >= MAX_TEAM_SIZE) {
    throw new HttpError(409, `A team can have at most ${MAX_TEAM_SIZE} students.`)
  }
}

export function addMember(courseId: string, caseId: string, teamId: string, email: string) {
  return changeTeams(courseId, caseId, async (client) => {
    await assertRoom(client, caseId, teamId)
    await assertUnpaired(client, courseId, caseId, [email])
    await insertMembers(client, courseId, caseId, teamId, [email])
  })
}

/**
 * Moves a student from their team onto `teamId` in one step, so a locked
 * world's team is never empty in between. They take on the new team's world.
 */
export function moveMember(courseId: string, caseId: string, teamId: string, email: string) {
  return changeTeams(courseId, caseId, async (client) => {
    await assertRoom(client, caseId, teamId)
    const { rows } = await client.query<{ teamId: string }>(
      'SELECT team_id AS "teamId" FROM team_members WHERE case_id = $1 AND email = $2',
      [caseId, email],
    )
    if (!rows[0]) throw new HttpError(404, 'That student is not on a team for this case.')
    if (rows[0].teamId === teamId) return
    await client.query('DELETE FROM team_members WHERE case_id = $1 AND email = $2', [caseId, email])
    await insertMembers(client, courseId, caseId, teamId, [email])
    await assertNotEmptied(client, caseId, rows[0].teamId)
    await deleteEmptyTeams(client, caseId)
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
    await assertNotEmptied(client, caseId, teamId)
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

/** Unpairs everyone in the case, which also removes the matchups, except the teams of locked worlds. */
export function clearTeams(courseId: string, caseId: string) {
  return changeTeams(courseId, caseId, async (client) => {
    const kept = (await lockedWorlds(client, caseId)).flatMap((w) => [w.plaintiffTeamId, w.defenseTeamId])
    await client.query('DELETE FROM teams WHERE case_id = $1 AND NOT (id = ANY($2::uuid[]))', [caseId, kept])
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
 * Puts the students not on a team into new teams of exactly `teamSize`, at
 * random, avoiding anyone they were teamed with in the course's other cases
 * where possible. Students left over stay off a team, for the instructor to
 * place by hand.
 */
export function autoPair(courseId: string, caseId: string, teamSize = MIN_AUTO_TEAM_SIZE) {
  return changeTeams(courseId, caseId, async (client) => {
    const { unpaired } = await listTeams(courseId, caseId, client)
    if (unpaired.length === 0) throw new HttpError(409, 'Everyone is already on a team.')
    if (unpaired.length < teamSize) {
      throw new HttpError(
        409,
        `Only ${unpaired.length} ${unpaired.length === 1 ? 'student is' : 'students are'} left, not enough for a team of ${teamSize}. Add them to a team by hand.`,
      )
    }

    const { rows } = await client.query<{ a: string; b: string }>(
      `SELECT a.email AS a, b.email AS b
       FROM team_members a
       JOIN team_members b ON b.team_id = a.team_id AND b.email <> a.email
       WHERE a.course_id = $1 AND a.case_id <> $2`,
      [courseId, caseId],
    )
    const past = new Set(rows.map((r) => partnerKey(r.a, r.b)))

    for (const group of pairStudents(unpaired.map((s) => s.email), past, randomInt, teamSize).teams) {
      await insertTeam(client, courseId, caseId, group)
    }
  })
}

export const partnerKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

/**
 * Splits students into random teams of exactly `size`, preferring partners
 * who are not in `pastPartners` (keys from `partnerKey`). The students left
 * over (fewer than `size`) come back in `leftover`, not on any team.
 */
export function pairStudents(
  emails: string[],
  pastPartners: Set<string>,
  random: (max: number) => number = randomInt,
  size = MIN_AUTO_TEAM_SIZE,
): { teams: string[][]; leftover: string[] } {
  const remaining = [...emails]
  for (let i = remaining.length - 1; i > 0; i--) {
    const j = random(i + 1)
    ;[remaining[i], remaining[j]] = [remaining[j], remaining[i]]
  }

  const fresh = (a: string, b: string) => !pastPartners.has(partnerKey(a, b))
  const teams: string[][] = []
  while (remaining.length >= size) {
    const team = [remaining.shift()!]
    while (team.length < size) {
      // The next student who hasn't worked with anyone already on the team, or else the next one.
      const index = Math.max(0, remaining.findIndex((b) => team.every((m) => fresh(m, b))))
      team.push(...remaining.splice(index, 1))
    }
    teams.push(team)
  }
  return { teams, leftover: remaining }
}
