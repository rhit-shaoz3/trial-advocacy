import { pool } from '../db/pool.ts'
import type { Side } from './matchups.ts'
import type { RosterEntry } from './roster.ts'

type Member = RosterEntry & { you: boolean }

// Shape sent to the client; matches `MyCase` in src/courses/types.ts.
export interface MyCase {
  id: string
  title: string
  summary: string
  status: 'active' | 'closed'
  /** Null until the instructor pairs this student for the case. */
  team: { number: number; members: Member[] } | null
  /** The student's case world; null until their team is matched. `number` 1 is World A. */
  world: { number: number; side: Side; opponents: { number: number; members: Member[] } } | null
}

/**
 * A student's view of the course's cases: everything but drafts, with their
 * team and case world (side and opposing team) in each.
 */
export async function listMyCases(courseId: string, userId: string): Promise<MyCase[]> {
  const { rows } = await pool.query<{
    id: string
    title: string
    summary: string
    status: MyCase['status']
    teamId: string | null
    teamNumber: number | null
    worldNumber: number | null
    side: Side | null
    opponentTeamId: string | null
    opponentNumber: number | null
  }>(
    `SELECT c.id, c.title, c.summary, c.status,
            mine.team_id AS "teamId", t.number AS "teamNumber",
            mu.number AS "worldNumber", mt.side,
            opp.team_id AS "opponentTeamId", ot.number AS "opponentNumber"
     FROM cases c
     LEFT JOIN (team_members mine
                JOIN enrollments me ON me.course_id = mine.course_id AND me.email = mine.email
                                   AND me.user_id = $2)
       ON mine.case_id = c.id
     LEFT JOIN teams t ON t.id = mine.team_id
     LEFT JOIN matchup_teams mt ON mt.team_id = mine.team_id
     LEFT JOIN matchups mu ON mu.id = mt.matchup_id
     LEFT JOIN matchup_teams opp ON opp.matchup_id = mt.matchup_id AND opp.side <> mt.side
     LEFT JOIN teams ot ON ot.id = opp.team_id
     WHERE c.course_id = $1 AND c.status <> 'draft'
     ORDER BY c.created_at, c.title`,
    [courseId, userId],
  )

  const teamIds = rows.flatMap((r) => [r.teamId, r.opponentTeamId]).filter((id) => id !== null)
  const { rows: memberRows } = await pool.query<Member & { teamId: string }>(
    `SELECT m.team_id AS "teamId", m.email, u.name, e.user_id IS NOT NULL AS joined,
            e.user_id IS NOT DISTINCT FROM $2::uuid AS you
     FROM team_members m
     JOIN enrollments e ON e.course_id = m.course_id AND e.email = m.email
     LEFT JOIN users u ON u.id = e.user_id
     WHERE m.team_id = ANY($1::uuid[])
     ORDER BY e.user_id IS DISTINCT FROM $2::uuid, e.user_id IS NULL, lower(u.name), m.email`,
    [teamIds, userId],
  )
  const membersOf = (teamId: string) =>
    memberRows
      .filter((m) => m.teamId === teamId)
      .map(({ email, name, joined, you }) => ({ email, name, joined, you }))

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary,
    status: r.status,
    team: r.teamId ? { number: r.teamNumber!, members: membersOf(r.teamId) } : null,
    world:
      r.worldNumber && r.opponentTeamId
        ? {
            number: r.worldNumber,
            side: r.side!,
            opponents: { number: r.opponentNumber!, members: membersOf(r.opponentTeamId) },
          }
        : null,
  }))
}

// Shape sent to the client; matches `CaseSummary` in src/workspace/types.ts.
export interface CaseSummary {
  id: string
  title: string
  summary: string
  status: 'active' | 'closed'
  /** The student's case world and role in it, once their team is matched. */
  world: { number: number; side: Side } | null
  /** How many case worlds the case has (the instructor's view). */
  worldCount: number | null
  /** Not tracked yet. */
  progress: null
  nextMilestone: null
  participants: { name: string }[]
}

const nameOf = (m: RosterEntry) => ({ name: m.name ?? m.email })

/** A student's course-home cases: the non-draft cases they are on a team in. */
export async function homeCasesForStudent(courseId: string, userId: string): Promise<CaseSummary[]> {
  const cases = await listMyCases(courseId, userId)
  return cases
    .filter((c) => c.team)
    .map((c) => ({
      id: c.id,
      title: c.title,
      summary: c.summary,
      status: c.status,
      world: c.world && { number: c.world.number, side: c.world.side },
      worldCount: null,
      progress: null,
      nextMilestone: null,
      // Everyone in the student's world: their pairing, then the opposition.
      participants: [...c.team!.members, ...(c.world?.opponents.members ?? [])].map(nameOf),
    }))
}

/** The instructor's course-home cases: every non-draft case, with all its paired students. */
export async function homeCasesForInstructor(courseId: string): Promise<CaseSummary[]> {
  const { rows } = await pool.query<Omit<CaseSummary, 'world' | 'progress' | 'nextMilestone'>>(
    `SELECT c.id, c.title, c.summary, c.status,
            (SELECT count(*)::int FROM matchups mu WHERE mu.case_id = c.id) AS "worldCount",
            coalesce((SELECT json_agg(json_build_object('name', coalesce(u.name, m.email))
                                      ORDER BY t.number, lower(u.name), m.email)
                      FROM team_members m
                      JOIN teams t ON t.id = m.team_id
                      JOIN enrollments e ON e.course_id = m.course_id AND e.email = m.email
                      LEFT JOIN users u ON u.id = e.user_id
                      WHERE m.case_id = c.id), '[]') AS participants
     FROM cases c
     WHERE c.course_id = $1 AND c.status <> 'draft'
     ORDER BY c.created_at, c.title`,
    [courseId],
  )
  return rows.map((r) => ({ ...r, world: null, progress: null, nextMilestone: null }))
}
