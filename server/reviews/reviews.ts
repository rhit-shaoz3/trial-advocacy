import { ai, AiNotConfiguredError } from '../ai/ai.ts'
import { listMaterialTexts } from '../courses/caseContent.ts'
import { finishPendingTranscriptions } from '../courses/materialText.ts'
import type { Side } from '../courses/matchups.ts'
import { pool } from '../db/pool.ts'
import { HttpError } from '../httpError.ts'
import type { SettledFacts } from '../witness/prompt.ts'

// When a team ends an interview, the AI lists the new facts the witness added
// (in the background, like transcriptions). The instructor rules on each one:
// accept or deny, for the team's case world or for every world in the case.
// Once the review is completed, the rulings bind every later interview, and
// the team sees which facts were accepted and which denied.

export const FACT_DECISIONS = ['accept_world', 'deny_world', 'accept_case', 'deny_case'] as const
export type FactDecision = (typeof FACT_DECISIONS)[number]
export type ReviewStatus = 'summarizing' | 'failed' | 'open' | 'completed'

// Shapes sent to the client; match `InterviewReview` and `ReviewResult` in src/courses/types.ts.
export interface InterviewReview {
  id: string
  caseId: string
  caseTitle: string
  witness: { id: string; name: string; role: string }
  worldNumber: number
  teamNumber: number
  side: Side
  /** The team's members, by name (or email). */
  team: string[]
  status: ReviewStatus
  error: string | null
  createdAt: Date
  completedAt: Date | null
  facts: { id: string; text: string; decision: FactDecision | null }[]
}

/** What students see of a completed review: only whether each fact stands. */
export interface ReviewResult {
  id: string
  witness: { id: string; name: string }
  completedAt: Date
  accepted: string[]
  denied: string[]
  /** Whether this student has opened the results. */
  seen: boolean
}

/** Rulings from completed reviews that bind interviews in this world (or, with no world, the case). */
export async function settledFacts(caseId: string, matchupId: string | null): Promise<SettledFacts> {
  const { rows } = await pool.query<{ text: string; decision: FactDecision }>(
    `SELECT f.text, f.decision
     FROM review_facts f JOIN interview_reviews r ON r.id = f.review_id
     WHERE r.case_id = $1 AND r.status = 'completed'
       AND (f.decision IN ('accept_case', 'deny_case')
            OR (f.decision IN ('accept_world', 'deny_world') AND r.matchup_id = $2))
     ORDER BY r.completed_at, f.position`,
    [caseId, matchupId],
  )
  return {
    accepted: rows.filter((r) => r.decision.startsWith('accept')).map((r) => r.text),
    denied: rows.filter((r) => r.decision.startsWith('deny')).map((r) => r.text),
  }
}

/** The team's case world, number, and side; null before the team is matched. */
export async function findTeamWorld(teamId: string) {
  const { rows } = await pool.query<{ matchupId: string; worldNumber: number; teamNumber: number; side: Side }>(
    `SELECT mt.matchup_id AS "matchupId", mu.number AS "worldNumber", t.number AS "teamNumber", mt.side
     FROM matchup_teams mt
     JOIN matchups mu ON mu.id = mt.matchup_id
     JOIN teams t ON t.id = mt.team_id
     WHERE mt.team_id = $1`,
    [teamId],
  )
  return rows[0] ?? null
}

/**
 * Sends an ended team interview for review and starts summarizing it.
 * Returns null (nothing to review) for an empty interview or an unmatched team.
 */
export async function createReview(interviewId: string, teamId: string) {
  const { rows: turns } = await pool.query('SELECT 1 FROM interview_turns WHERE interview_id = $1 LIMIT 1', [interviewId])
  const world = await findTeamWorld(teamId)
  if (turns.length === 0 || !world) return null
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO interview_reviews
       (interview_id, case_id, witness_id, team_id, matchup_id, team_number, world_number, side)
     SELECT i.id, w.case_id, i.witness_id, $2, $3, $4, $5, $6
     FROM interviews i JOIN case_witnesses w ON w.id = i.witness_id
     WHERE i.id = $1
     ON CONFLICT (interview_id) DO NOTHING
     RETURNING id`,
    [interviewId, teamId, world.matchupId, world.teamNumber, world.worldNumber, world.side],
  )
  if (rows[0]) queueReview(rows[0].id)
  return rows[0]?.id ?? null
}

const running = new Map<string, Promise<void>>()

/** Starts listing a review's new facts in the background. */
export function queueReview(id: string) {
  if (running.has(id)) return
  const run = summarize(id).finally(() => running.delete(id))
  running.set(id, run)
}

/** Resolves once every summary running now has finished (for tests). */
export async function reviewsSettled() {
  await Promise.all(running.values())
}

/** Asks the AI for the new facts and records them; never throws. */
async function summarize(id: string) {
  try {
    const { rows } = await pool.query<{
      caseId: string
      matchupId: string | null
      interviewId: string
      caseTitle: string
      witnessName: string
    }>(
      `SELECT r.case_id AS "caseId", r.matchup_id AS "matchupId", r.interview_id AS "interviewId",
              c.title AS "caseTitle", w.name AS "witnessName"
       FROM interview_reviews r
       JOIN cases c ON c.id = r.case_id
       JOIN case_witnesses w ON w.id = r.witness_id
       WHERE r.id = $1`,
      [id],
    )
    const review = rows[0]
    if (!review) return // deleted meanwhile

    let materials = await listMaterialTexts(review.caseId)
    if (materials.some((m) => m.textStatus === 'pending')) {
      await finishPendingTranscriptions(materials)
      materials = await listMaterialTexts(review.caseId)
    }
    const facts = await ai.findNewFacts({
      caseName: review.caseTitle,
      witnessName: review.witnessName,
      documents: materials
        .filter((m) => m.textStatus === 'ready' && m.text)
        .map((m) => ({ title: m.description || m.filename, content: m.text! })),
      settled: await settledFacts(review.caseId, review.matchupId),
      transcript: await transcriptOf(review.interviewId),
    })

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM review_facts WHERE review_id = $1', [id])
      for (const [position, text] of facts.entries()) {
        await client.query('INSERT INTO review_facts (review_id, position, text) VALUES ($1, $2, $3)', [id, position, text])
      }
      // Nothing new means nothing to rule on, so the review is done.
      await client.query(
        `UPDATE interview_reviews
         SET status = $2, error = NULL, completed_at = CASE WHEN $2 = 'completed' THEN now() END
         WHERE id = $1`,
        [id, facts.length ? 'open' : 'completed'],
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    if (!(err instanceof AiNotConfiguredError)) console.error(`Could not summarize review ${id}:`, err)
    const error =
      err instanceof AiNotConfiguredError ? err.message : 'Could not list the new facts in this conversation. Try again.'
    await pool.query(`UPDATE interview_reviews SET status = 'failed', error = $2 WHERE id = $1`, [id, error]).catch(() => {})
  }
}

async function transcriptOf(interviewId: string) {
  const { rows } = await pool.query<{ question: string; answer: string }>(
    'SELECT question, answer FROM interview_turns WHERE interview_id = $1 ORDER BY position',
    [interviewId],
  )
  return rows
}

const REVIEW_SELECT = `
  SELECT r.id, r.case_id AS "caseId", c.title AS "caseTitle",
         json_build_object('id', w.id, 'name', w.name, 'role', w.role) AS witness,
         r.world_number AS "worldNumber", r.team_number AS "teamNumber", r.side,
         coalesce((SELECT json_agg(coalesce(u.name, m.email) ORDER BY lower(coalesce(u.name, m.email)))
                   FROM team_members m
                   JOIN enrollments e ON e.course_id = m.course_id AND e.email = m.email
                   LEFT JOIN users u ON u.id = e.user_id
                   WHERE m.team_id = r.team_id), '[]') AS team,
         r.status, r.error, r.created_at AS "createdAt", r.completed_at AS "completedAt",
         coalesce((SELECT json_agg(json_build_object('id', f.id, 'text', f.text, 'decision', f.decision)
                                   ORDER BY f.position)
                   FROM review_facts f WHERE f.review_id = r.id), '[]') AS facts
  FROM interview_reviews r
  JOIN cases c ON c.id = r.case_id
  JOIN case_witnesses w ON w.id = r.witness_id`

/** The course's reviews still to do (newest first), or the completed ones (most recently completed first). */
export async function listReviews(courseId: string, which: 'open' | 'completed') {
  const { rows } = await pool.query<InterviewReview>(
    `${REVIEW_SELECT}
     WHERE c.course_id = $1 AND (r.status = 'completed') = $2
     ORDER BY ${which === 'completed' ? 'r.completed_at DESC' : 'r.created_at DESC'}`,
    [courseId, which === 'completed'],
  )
  return rows
}

async function findReview(courseId: string, reviewId: string) {
  const { rows } = await pool.query<InterviewReview>(`${REVIEW_SELECT} WHERE c.course_id = $1 AND r.id = $2`, [
    courseId,
    reviewId,
  ])
  if (!rows[0]) throw new HttpError(404, 'Review not found.')
  return rows[0]
}

export async function getReview(courseId: string, reviewId: string) {
  return findReview(courseId, reviewId)
}

/** Records the instructor's ruling on one fact. */
export async function decideFact(courseId: string, reviewId: string, factId: string, decision: FactDecision) {
  const review = await findReview(courseId, reviewId)
  if (review.status === 'completed') throw new HttpError(409, 'This review is already completed.')
  const { rowCount } = await pool.query(
    'UPDATE review_facts SET decision = $3, decided_at = now() WHERE review_id = $1 AND id = $2',
    [reviewId, factId, decision],
  )
  if (rowCount !== 1) throw new HttpError(404, 'Fact not found.')
  return findReview(courseId, reviewId)
}

/** Finishes a review once every fact has a ruling; the rulings take effect now. */
export async function completeReview(courseId: string, reviewId: string, userId: string) {
  const review = await findReview(courseId, reviewId)
  if (review.status === 'completed') throw new HttpError(409, 'This review is already completed.')
  if (review.status !== 'open') throw new HttpError(409, 'The new facts in this conversation are not listed yet.')
  if (review.facts.some((f) => f.decision === null)) throw new HttpError(409, 'Rule on every fact first.')
  await pool.query(
    `UPDATE interview_reviews SET status = 'completed', completed_at = now(), completed_by = $2 WHERE id = $1`,
    [reviewId, userId],
  )
  return findReview(courseId, reviewId)
}

/** Lists a failed review's new facts again. */
export async function retryReview(courseId: string, reviewId: string) {
  const review = await findReview(courseId, reviewId)
  if (review.status !== 'failed') throw new HttpError(409, 'Only a review that failed can be retried.')
  await pool.query(`UPDATE interview_reviews SET status = 'summarizing', error = NULL WHERE id = $1`, [reviewId])
  // Read it before the summary starts, or a quick summary could finish first and the reply skip "summarizing".
  const retried = await findReview(courseId, reviewId)
  queueReview(reviewId)
  return retried
}

/** The conversation behind a review, for the instructor to check how a fact came up. */
export async function reviewTranscript(courseId: string, reviewId: string) {
  await findReview(courseId, reviewId)
  const { rows } = await pool.query<{ question: string; objection: string | null; answer: string; askedBy: string | null }>(
    `SELECT t.question, t.objection, t.answer, u.name AS "askedBy"
     FROM interview_turns t
     JOIN interview_reviews r ON r.interview_id = t.interview_id
     LEFT JOIN users u ON u.id = t.asked_by
     WHERE r.id = $1 ORDER BY t.position`,
    [reviewId],
  )
  return rows
}

/** How many reviews in the course still need the instructor. */
export async function openReviewCount(courseId: string) {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM interview_reviews r JOIN cases c ON c.id = r.case_id
     WHERE c.course_id = $1 AND r.status <> 'completed'`,
    [courseId],
  )
  return rows[0].n
}

/** The team's completed reviews, newest first: which facts stand and which don't. */
export async function teamReviewResults(caseId: string, teamId: string, userId: string): Promise<ReviewResult[]> {
  const { rows } = await pool.query<ReviewResult>(
    `SELECT r.id, json_build_object('id', w.id, 'name', w.name) AS witness, r.completed_at AS "completedAt",
            coalesce((SELECT json_agg(f.text ORDER BY f.position) FROM review_facts f
                      WHERE f.review_id = r.id AND f.decision LIKE 'accept%'), '[]') AS accepted,
            coalesce((SELECT json_agg(f.text ORDER BY f.position) FROM review_facts f
                      WHERE f.review_id = r.id AND f.decision LIKE 'deny%'), '[]') AS denied,
            EXISTS (SELECT 1 FROM review_seen s WHERE s.review_id = r.id AND s.user_id = $3) AS seen
     FROM interview_reviews r JOIN case_witnesses w ON w.id = r.witness_id
     WHERE r.case_id = $1 AND r.team_id = $2 AND r.status = 'completed'
     ORDER BY r.completed_at DESC`,
    [caseId, teamId, userId],
  )
  return rows
}

/** Marks every completed review of the team as read by this student. */
export async function markReviewsSeen(caseId: string, teamId: string, userId: string) {
  await pool.query(
    `INSERT INTO review_seen (review_id, user_id)
     SELECT id, $3 FROM interview_reviews WHERE case_id = $1 AND team_id = $2 AND status = 'completed'
     ON CONFLICT DO NOTHING`,
    [caseId, teamId, userId],
  )
}

/** Completed reviews of the student's teams in this course that they haven't opened yet. */
export async function unseenReviewCount(courseId: string, userId: string) {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n
     FROM interview_reviews r
     JOIN cases c ON c.id = r.case_id
     JOIN team_members m ON m.team_id = r.team_id
     JOIN enrollments e ON e.course_id = m.course_id AND e.email = m.email
     WHERE c.course_id = $1 AND e.user_id = $2 AND r.status = 'completed'
       AND NOT EXISTS (SELECT 1 FROM review_seen s WHERE s.review_id = r.id AND s.user_id = $2)`,
    [courseId, userId],
  )
  return rows[0].n
}
