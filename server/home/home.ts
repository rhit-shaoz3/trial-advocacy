import { pool } from '../db/pool.ts'
import { casePhases, type CasePhase } from '../courses/cases.ts'
import type { Side } from '../courses/matchups.ts'

// The main dashboard, across every course: the active cases, and what needs
// doing (the instructor's reviews, or a student's tasks and discovery).

/** How many to-do items the dashboard lists; the rest are counted. */
const LATEST = 3

/** Shape sent to the client; matches `ActiveCase` in src/courses/types.ts. */
export interface ActiveCase {
  id: string
  title: string
  courseId: string
  courseCode: string
  phase: CasePhase
  phases: CasePhase[]
  /** Instructor: how many case worlds and teams. */
  worldCount?: number
  teamCount?: number
  /** Student: their side and team. */
  side?: Side | null
  teamNumber?: number
}

/** Shape sent to the client; matches `HomeTodo` in src/courses/types.ts. */
export interface HomeTodo {
  id: string
  kind: 'review' | 'task' | 'respond' | 'response'
  title: string
  detail: string
  courseId: string
  caseId: string
  /** When it's due (tasks, sets to answer), or when it came in (reviews, responses). */
  at: Date | null
}

const PHASE_COLUMNS = `c.phase, c.investigator_enabled AS "investigatorEnabled",
  EXISTS (SELECT 1 FROM information_exchange ie WHERE ie.case_id = c.id AND ie.setup_completed_at IS NOT NULL) AS "exchangeReady"`

type PhaseRow = { phase: CasePhase; investigatorEnabled: boolean; exchangeReady: boolean }
const withPhases = <T extends PhaseRow>({ investigatorEnabled, exchangeReady, ...row }: T) => ({
  ...row,
  phases: casePhases(investigatorEnabled, exchangeReady),
})

/** The instructor's active cases in every course they teach, and the reviews waiting for them. */
export async function instructorOverview(userId: string) {
  const { rows: cases } = await pool.query<ActiveCase & PhaseRow>(
    `SELECT c.id, c.title, co.id AS "courseId", co.code AS "courseCode", ${PHASE_COLUMNS},
            (SELECT count(*)::int FROM matchups mu WHERE mu.case_id = c.id) AS "worldCount",
            (SELECT count(*)::int FROM teams t WHERE t.case_id = c.id) AS "teamCount"
     FROM cases c JOIN courses co ON co.id = c.course_id
     WHERE co.instructor_id = $1 AND c.status = 'active'
     ORDER BY co.term_start DESC, co.code, c.created_at`,
    [userId],
  )
  // Finished reviews whose team report is still being written count as done.
  const { rows: reviews } = await pool.query<HomeTodo & { count: number }>(
    `SELECT r.id, 'review' AS kind,
            CASE WHEN r.kind = 'investigation' THEN 'Investigator report for Team ' || r.team_number
                 ELSE 'Interview of ' || coalesce(w.name, 'a witness') END AS title,
            co.code || ' · ' || c.title AS detail,
            co.id AS "courseId", c.id AS "caseId", r.created_at AS at,
            count(*) OVER ()::int AS count
     FROM interview_reviews r
     JOIN cases c ON c.id = r.case_id
     JOIN courses co ON co.id = c.course_id
     LEFT JOIN case_witnesses w ON w.id = r.witness_id
     WHERE co.instructor_id = $1 AND r.status NOT IN ('completed', 'finalizing')
     ORDER BY r.created_at DESC
     LIMIT ${LATEST}`,
    [userId],
  )
  return {
    activeCases: cases.map(withPhases),
    todos: {
      count: reviews[0]?.count ?? 0,
      latest: reviews.map((r) => ({ id: r.id, kind: r.kind, title: r.title, detail: r.detail, courseId: r.courseId, caseId: r.caseId, at: r.at })),
    },
  }
}

/** The student's active cases (on a team), and their open tasks and discovery to answer or read. */
export async function studentOverview(userId: string) {
  const { rows: cases } = await pool.query<ActiveCase & PhaseRow & { teamId: string }>(
    `SELECT c.id, c.title, co.id AS "courseId", co.code AS "courseCode", ${PHASE_COLUMNS},
            mt.side, t.number AS "teamNumber", t.id AS "teamId"
     FROM team_members m
     JOIN enrollments e ON e.course_id = m.course_id AND e.email = m.email
     JOIN teams t ON t.id = m.team_id
     JOIN cases c ON c.id = m.case_id
     JOIN courses co ON co.id = c.course_id
     LEFT JOIN matchup_teams mt ON mt.team_id = t.id
     WHERE e.user_id = $1 AND c.status = 'active'
     ORDER BY co.term_start DESC, co.code, c.created_at`,
    [userId],
  )
  const teamIds = cases.map((c) => c.teamId)

  const { rows: todos } = await pool.query<HomeTodo>(
    `WITH mine AS (SELECT unnest($2::uuid[]) AS team_id)
     -- Tasks the team hasn't done, for its side.
     SELECT t.id, 'task' AS kind, t.title, co.code || ' · ' || c.title AS detail,
            co.id AS "courseId", c.id AS "caseId", t.due_at AS at
     FROM mine
     JOIN teams tm ON tm.id = mine.team_id
     JOIN cases c ON c.id = tm.case_id AND c.status = 'active'
     JOIN courses co ON co.id = c.course_id
     LEFT JOIN matchup_teams mt ON mt.team_id = tm.id
     JOIN case_tasks t ON t.case_id = c.id AND t.audience IN ('all', coalesce(mt.side, 'all'))
     WHERE NOT EXISTS (SELECT 1 FROM task_completions tc WHERE tc.task_id = t.id AND tc.team_id = tm.id)
     UNION ALL
     -- Sets from the other team still to answer.
     SELECT r.id, 'respond', CASE r.kind WHEN 'rfas' THEN 'Answer requests for admission' ELSE 'Answer interrogatories' END,
            co.code || ' · ' || c.title, co.id, c.id, r.due_at
     FROM mine
     JOIN exchange_requests r ON r.to_team_id = mine.team_id AND r.responded_at IS NULL
     JOIN cases c ON c.id = r.case_id AND c.status = 'active'
     JOIN courses co ON co.id = c.course_id
     UNION ALL
     -- Answers to the team's sets that this student hasn't read.
     SELECT r.id, 'response', CASE r.kind WHEN 'rfas' THEN 'New answers to your requests for admission' ELSE 'New answers to your interrogatories' END,
            co.code || ' · ' || c.title, co.id, c.id, r.responded_at
     FROM mine
     JOIN exchange_requests r ON r.from_team_id = mine.team_id AND r.responded_at IS NOT NULL
     JOIN cases c ON c.id = r.case_id AND c.status = 'active'
     JOIN courses co ON co.id = c.course_id
     WHERE NOT EXISTS (SELECT 1 FROM exchange_seen s WHERE s.request_id = r.id AND s.user_id = $1)`,
    [userId, teamIds],
  )
  // New answers first, then whatever is due soonest.
  const rank = (t: HomeTodo) => (t.kind === 'response' ? 0 : 1)
  todos.sort((a, b) => rank(a) - rank(b) || (a.at?.getTime() ?? Infinity) - (b.at?.getTime() ?? Infinity))

  return {
    // The team id was only for finding the to-dos.
    activeCases: cases.map((c) => {
      const shown: Omit<typeof c, 'teamId'> & { teamId?: string } = { ...c }
      delete shown.teamId
      return withPhases(shown)
    }),
    todos: { count: todos.length, latest: todos.slice(0, LATEST) },
  }
}
