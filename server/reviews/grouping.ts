import { ai, AiNotConfiguredError } from '../ai/ai.ts'
import { pool } from '../db/pool.ts'
import { HttpError } from '../httpError.ts'
import type { PendingFact } from './factsAi.ts'
import { finishIfRuled, type FactDecision } from './reviews.ts'

// Grouping similar new facts: whenever a review in a case opens, the AI looks
// over every fact still waiting for a ruling in the case and groups the ones
// that make the same claim, from different reviews (two teams both got the
// medical bills out of Paige). The instructor rules on a group at once: for
// each fact's own world, or for every world. Ungrouping sends each fact back
// to its review, never to be grouped again. Facts already in a group stay
// there; new facts can join it.

// Shape sent to the client; matches `FactGroup` in src/courses/types.ts.
export interface FactGroup {
  id: string
  caseId: string
  caseTitle: string
  headline: string
  differences: string
  createdAt: Date
  /** Each fact, with where it came from; `reviewId` is its review's card. */
  facts: { id: string; text: string; reviewId: string; teamNumber: number; worldNumber: number; source: string }[]
  /** How many different worlds the facts are in. */
  worlds: number
}

const running = new Map<string, Promise<void>>()
const again = new Set<string>()

/** Groups the case's pending facts in the background; one run per case at a time, and another after if asked meanwhile. */
export function queueGrouping(caseId: string) {
  if (running.has(caseId)) {
    again.add(caseId)
    return
  }
  const run = groupPendingFacts(caseId).finally(() => {
    running.delete(caseId)
    if (again.delete(caseId)) queueGrouping(caseId)
  })
  running.set(caseId, run)
}

/** Resolves once every grouping running now has finished (for tests). */
export async function groupingSettled() {
  while (running.size) await Promise.all(running.values())
}

/** Never throws: when grouping goes wrong, the facts are just ruled one by one. */
async function groupPendingFacts(caseId: string) {
  try {
    const { rows: facts } = await pool.query<PendingFact & { groupId: string | null }>(
      `SELECT f.id, f.text, f.review_id AS "reviewId", f.group_id AS "groupId",
              r.team_number AS "teamNumber", r.world_number AS "worldNumber",
              coalesce(w.name, 'the investigator') AS source
       FROM review_facts f
       JOIN interview_reviews r ON r.id = f.review_id
       LEFT JOIN case_witnesses w ON w.id = r.witness_id
       WHERE r.case_id = $1 AND r.status = 'open' AND f.decision IS NULL AND NOT f.ungrouped
       ORDER BY r.created_at, f.position`,
      [caseId],
    )
    const ungrouped = facts.filter((f) => !f.groupId)
    // Something new can only group with a fact from another review.
    if (!ungrouped.length || new Set(facts.map((f) => f.reviewId)).size < 2) return
    const proposals = await ai.groupFacts(
      facts.map((f) => ({ id: f.id, text: f.text, source: f.source, teamNumber: f.teamNumber, worldNumber: f.worldNumber, reviewId: f.reviewId })),
    )
    const groupOf = new Map(facts.map((f) => [f.id, f.groupId]))

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const proposal of proposals) {
        const newIds = proposal.factIds.filter((id) => !groupOf.get(id))
        if (!newIds.length) continue
        const existing = proposal.factIds.map((id) => groupOf.get(id)).find((g): g is string => !!g)
        let groupId = existing
        if (groupId) {
          await client.query('UPDATE fact_groups SET headline = $2, differences = $3 WHERE id = $1', [
            groupId,
            proposal.headline,
            proposal.differences,
          ])
        } else {
          const { rows } = await client.query<{ id: string }>(
            'INSERT INTO fact_groups (case_id, headline, differences) VALUES ($1, $2, $3) RETURNING id',
            [caseId, proposal.headline, proposal.differences],
          )
          groupId = rows[0].id
        }
        // Only facts nobody has ruled on meanwhile.
        await client.query(
          'UPDATE review_facts SET group_id = $2 WHERE id = ANY($1::uuid[]) AND decision IS NULL AND group_id IS NULL',
          [newIds, groupId],
        )
        for (const id of newIds) groupOf.set(id, groupId)
      }
      await dropSmallGroups(caseId, client)
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    if (!(err instanceof AiNotConfiguredError)) console.error(`Could not group the new facts in case ${caseId}:`, err)
  }
}

/** A group needs two pending facts from different reviews; the rest come apart. */
async function dropSmallGroups(caseId: string, db: Pick<typeof pool, 'query'> = pool) {
  await db.query(
    `DELETE FROM fact_groups g WHERE g.case_id = $1
       AND (SELECT count(DISTINCT f.review_id) FROM review_facts f WHERE f.group_id = g.id AND f.decision IS NULL) < 2`,
    [caseId],
  )
}

const GROUP_SELECT = `
  SELECT g.id, g.case_id AS "caseId", c.title AS "caseTitle", g.headline, g.differences, g.created_at AS "createdAt",
         json_agg(json_build_object('id', f.id, 'text', f.text, 'reviewId', r.id, 'teamNumber', r.team_number,
                                    'worldNumber', r.world_number,
                                    'source', CASE WHEN r.kind = 'investigation' THEN 'Investigation'
                                                   ELSE 'Interview of ' || coalesce(w.name, 'a witness') END)
                  ORDER BY r.team_number, f.position) AS facts,
         count(DISTINCT r.matchup_id)::int AS worlds
  FROM fact_groups g
  JOIN cases c ON c.id = g.case_id
  JOIN review_facts f ON f.group_id = g.id AND f.decision IS NULL
  JOIN interview_reviews r ON r.id = f.review_id AND r.status = 'open'
  LEFT JOIN case_witnesses w ON w.id = r.witness_id`

/** The course's groups still to rule on, oldest first. */
export async function listFactGroups(courseId: string) {
  const { rows } = await pool.query<FactGroup>(
    `${GROUP_SELECT} WHERE c.course_id = $1 GROUP BY g.id, c.title ORDER BY g.created_at`,
    [courseId],
  )
  return rows
}

async function findGroup(courseId: string, groupId: string) {
  const { rows } = await pool.query<FactGroup>(`${GROUP_SELECT} WHERE c.course_id = $1 AND g.id = $2 GROUP BY g.id, c.title`, [
    courseId,
    groupId,
  ])
  if (!rows[0]) throw new HttpError(404, 'That group was already ruled on or ungrouped.')
  return rows[0]
}

/**
 * Rules on every fact in the group: accept_world and deny_world each for the
 * fact's own world, the _case rulings for every world. Returns the reviews
 * that finished, for the caller to start writing investigators' reports.
 */
export async function decideGroup(courseId: string, groupId: string, decision: FactDecision, userId: string) {
  const group = await findGroup(courseId, groupId)
  const ids = group.facts.map((f) => f.id)
  await pool.query('UPDATE review_facts SET decision = $2, decided_at = now(), auto = false WHERE id = ANY($1::uuid[])', [
    ids,
    decision,
  ])
  await pool.query('DELETE FROM fact_groups WHERE id = $1', [groupId])
  const reviewIds = [...new Set(group.facts.map((f) => f.reviewId))]
  for (const id of reviewIds) await finishIfRuled(id, userId)
  return reviewIds
}

/** Sends each fact back to its own review, to rule on separately; they're never grouped again. */
export async function ungroup(courseId: string, groupId: string) {
  const group = await findGroup(courseId, groupId)
  await pool.query('UPDATE review_facts SET group_id = NULL, ungrouped = true WHERE group_id = $1', [group.id])
  await pool.query('DELETE FROM fact_groups WHERE id = $1', [group.id])
}
