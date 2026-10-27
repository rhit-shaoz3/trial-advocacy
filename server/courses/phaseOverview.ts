import { pool } from '../db/pool.ts'

// What the instructor's case dashboard shows for the investigate and
// deposition phases, like the information exchange card does for its phase.

/** How the class has used the background investigator. Matches `InvestigatorOverview` in src/courses/types.ts. */
export async function investigatorOverview(caseId: string) {
  const { rows } = await pool.query<{ teams: number; teamsUsed: number; requests: number; waiting: number }>(
    `SELECT (SELECT count(*)::int FROM matchup_teams WHERE case_id = $1) AS teams,
            count(DISTINCT r.team_id)::int AS "teamsUsed",
            count(r.id)::int AS requests,
            count(r.id) FILTER (WHERE r.status NOT IN ('completed', 'finalizing'))::int AS waiting
     FROM interview_reviews r
     WHERE r.case_id = $1 AND r.kind = 'investigation' AND r.team_id IS NOT NULL`,
    [caseId],
  )
  return rows[0]
}

/**
 * How the class is deposing witnesses: a deposition is a team questioning a
 * witness for the other side (instructors' test runs aren't counted).
 * Matches `DepositionOverview` in src/courses/types.ts.
 */
export async function depositionOverview(caseId: string) {
  const { rows } = await pool.query<{
    teams: number
    teamsDeposed: number
    depositions: number
    questions: number
    objections: number
    reviewsWaiting: number
  }>(
    `WITH depositions AS (
       SELECT i.id, i.team_id
       FROM interviews i JOIN case_witnesses w ON w.id = i.witness_id
       WHERE w.case_id = $1 AND i.team_id IS NOT NULL
         AND w.aligned_side IS NOT NULL AND w.aligned_side <> i.side
         AND EXISTS (SELECT 1 FROM interview_turns t WHERE t.interview_id = i.id)
     )
     SELECT (SELECT count(*)::int FROM matchup_teams WHERE case_id = $1) AS teams,
            (SELECT count(DISTINCT team_id)::int FROM depositions) AS "teamsDeposed",
            (SELECT count(*)::int FROM depositions) AS depositions,
            (SELECT count(*)::int FROM interview_turns t WHERE t.interview_id IN (SELECT id FROM depositions)) AS questions,
            (SELECT count(*)::int FROM interview_turns t
             WHERE t.interview_id IN (SELECT id FROM depositions) AND t.objection IS NOT NULL) AS objections,
            (SELECT count(*)::int FROM interview_reviews r
             WHERE r.case_id = $1 AND r.kind = 'interview' AND r.status NOT IN ('completed', 'finalizing')) AS "reviewsWaiting"`,
    [caseId],
  )
  return rows[0]
}
