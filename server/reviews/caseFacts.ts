import type { CourseCase } from '../courses/cases.ts'
import type { Side } from '../courses/matchups.ts'
import { pool } from '../db/pool.ts'
import type { FactDecision } from './reviews.ts'

// The instructor's running list of new facts for a case, beside the review
// queue: what's been ruled for every world, and what's been ruled in each
// world. The rulings follow the same rule as settledFacts in reviews.ts:
// completed reviews only.

// Shapes sent to the client; match `CaseFacts` in src/courses/types.ts.
export interface RuledFact {
  text: string
  /** Where it came from: "Interview of Paige Turner · Team 1", or "Investigation · Team 2". */
  source: string
  /** Decided automatically (review lite), not by the instructor. */
  auto: boolean
}

export interface WorldFacts {
  matchupId: string
  number: number
  teams: { number: number; side: Side }[]
  accepted: RuledFact[]
  denied: RuledFact[]
}

export interface CaseFacts {
  allWorlds: { accepted: RuledFact[]; denied: RuledFact[] }
  worlds: WorldFacts[]
}

/** The case's running list of new facts: what's ruled for all worlds, and in each. */
export async function caseFacts(courseCase: CourseCase): Promise<CaseFacts> {
  const [{ rows: ruled }, { rows: worlds }] = await Promise.all([
    pool.query<RuledFact & { decision: FactDecision; matchupId: string | null }>(
      `SELECT f.text, f.decision, f.auto, r.matchup_id AS "matchupId",
              CASE WHEN r.kind = 'investigation' THEN 'Investigation · Team ' || r.team_number
                   ELSE 'Interview of ' || coalesce(w.name, 'a witness') || ' · Team ' || r.team_number END AS source
       FROM review_facts f
       JOIN interview_reviews r ON r.id = f.review_id
       LEFT JOIN case_witnesses w ON w.id = r.witness_id
       WHERE r.case_id = $1 AND r.status = 'completed' AND f.decision IS NOT NULL
       ORDER BY r.completed_at, f.position`,
      [courseCase.id],
    ),
    pool.query<Omit<WorldFacts, 'accepted' | 'denied'>>(
      `SELECT mu.id AS "matchupId", mu.number,
              coalesce((SELECT json_agg(json_build_object('number', t.number, 'side', mt.side) ORDER BY mt.side DESC)
                        FROM matchup_teams mt JOIN teams t ON t.id = mt.team_id
                        WHERE mt.matchup_id = mu.id), '[]') AS teams
       FROM matchups mu WHERE mu.case_id = $1 ORDER BY mu.number`,
      [courseCase.id],
    ),
  ])
  const strip = ({ text, source, auto }: RuledFact): RuledFact => ({ text, source, auto })
  const pick = (decision: FactDecision, matchupId?: string) =>
    ruled.filter((f) => f.decision === decision && (matchupId === undefined || f.matchupId === matchupId)).map(strip)
  return {
    allWorlds: { accepted: pick('accept_case'), denied: pick('deny_case') },
    worlds: worlds.map((w) => ({ ...w, accepted: pick('accept_world', w.matchupId), denied: pick('deny_world', w.matchupId) })),
  }
}
