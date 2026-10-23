import { ai, AiNotConfiguredError } from '../ai/ai.ts'
import { listMaterialTexts, witnessAvatarUrlSql } from '../courses/caseContent.ts'
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
//
// A team's request to the background investigator is reviewed the same way
// (kind 'investigation'; its lifecycle is in server/investigator/requests.ts),
// plus a ruling on each case file he'd unlock for the team.

export const FACT_DECISIONS = ['accept_world', 'deny_world', 'accept_case', 'deny_case'] as const
export type FactDecision = (typeof FACT_DECISIONS)[number]
/**
 * summarizing: the AI is reading the interview (or investigating); failed: try
 * again; open: waiting for the instructor; finalizing: the AI is writing the
 * investigator's clean report; completed: done, and the rulings stand.
 */
export type ReviewStatus = 'summarizing' | 'failed' | 'open' | 'finalizing' | 'completed'
export type ReviewKind = 'interview' | 'investigation'
export const DOCUMENT_DECISIONS = ['allow', 'deny'] as const
export type DocumentDecision = (typeof DOCUMENT_DECISIONS)[number]

// Shapes sent to the client; match `InterviewReview` and `ReviewResult` in src/courses/types.ts.
export interface InterviewReview {
  id: string
  kind: ReviewKind
  caseId: string
  caseTitle: string
  /** The witness interviewed; null for an investigation. */
  witness: { id: string; name: string; role: string; avatarUrl: string | null } | null
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
  /** An investigation's assignment (what the team asked) and who sent it. */
  assignment: string | null
  askedBy: string | null
  /** An investigation's report as the investigator wrote it, without its review block. */
  report: string | null
  /** The report the team got (once completed). */
  finalReport: string | null
  /** Records the team asked for that need legal process, for the instructor's information. */
  recordsRequested: string[]
  /** Case files the investigator would unlock for the team, and the instructor's call on each. */
  documents: { materialId: string; title: string; decision: DocumentDecision | null }[]
}

/** What students see of a completed review: only whether each fact stands. */
export interface ReviewResult {
  id: string
  witness: { id: string; name: string; avatarUrl: string | null }
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
      for (const [position, fact] of facts.entries()) {
        await client.query('INSERT INTO review_facts (review_id, position, text, links) VALUES ($1, $2, $3, $4)', [
          id,
          position,
          fact.text,
          JSON.stringify({ producedBy: fact.producedBy, builtOn: fact.builtOn }),
        ])
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
  SELECT r.id, r.kind, r.case_id AS "caseId", c.title AS "caseTitle",
         CASE WHEN w.id IS NULL THEN NULL
              ELSE json_build_object('id', w.id, 'name', w.name, 'role', w.role, 'avatarUrl', ${witnessAvatarUrlSql('w')})
         END AS witness,
         r.world_number AS "worldNumber", r.team_number AS "teamNumber", r.side,
         coalesce((SELECT json_agg(coalesce(u.name, m.email) ORDER BY lower(coalesce(u.name, m.email)))
                   FROM team_members m
                   JOIN enrollments e ON e.course_id = m.course_id AND e.email = m.email
                   LEFT JOIN users u ON u.id = e.user_id
                   WHERE m.team_id = r.team_id), '[]') AS team,
         r.status, r.error, r.created_at AS "createdAt", r.completed_at AS "completedAt",
         coalesce((SELECT json_agg(json_build_object('id', f.id, 'text', f.text, 'decision', f.decision)
                                   ORDER BY f.position)
                   FROM review_facts f WHERE f.review_id = r.id), '[]') AS facts,
         r.assignment, (SELECT u.name FROM users u WHERE u.id = r.asked_by) AS "askedBy",
         r.report, r.final_report AS "finalReport", r.records_requested AS "recordsRequested",
         coalesce((SELECT json_agg(json_build_object('materialId', d.material_id,
                                                     'title', coalesce(nullif(cm.description, ''), cm.filename),
                                                     'decision', d.decision) ORDER BY d.position)
                   FROM review_documents d JOIN case_materials cm ON cm.id = d.material_id
                   WHERE d.review_id = r.id), '[]') AS documents
  FROM interview_reviews r
  JOIN cases c ON c.id = r.case_id
  LEFT JOIN case_witnesses w ON w.id = r.witness_id`

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

/** Records the instructor's call on letting the team have one case file the investigator found. */
export async function decideDocument(courseId: string, reviewId: string, materialId: string, decision: DocumentDecision) {
  const review = await findReview(courseId, reviewId)
  if (review.status !== 'open') throw new HttpError(409, 'This review is already completed.')
  const { rowCount } = await pool.query('UPDATE review_documents SET decision = $3 WHERE review_id = $1 AND material_id = $2', [
    reviewId,
    materialId,
    decision,
  ])
  if (rowCount !== 1) throw new HttpError(404, 'File not found.')
  return findReview(courseId, reviewId)
}

/**
 * Finishes a review once every fact (and, for an investigation, every file)
 * has a ruling. An interview's rulings take effect now; an investigation goes
 * on to `finalizing` while the team's clean report is written (the caller
 * starts that), and its rulings take effect when it's done.
 */
export async function completeReview(courseId: string, reviewId: string, userId: string) {
  const review = await findReview(courseId, reviewId)
  if (review.status === 'completed' || review.status === 'finalizing') throw new HttpError(409, 'This review is already completed.')
  if (review.status !== 'open') throw new HttpError(409, 'The new facts in this conversation are not listed yet.')
  if (review.facts.some((f) => f.decision === null)) throw new HttpError(409, 'Rule on every fact first.')
  if (review.documents.some((d) => d.decision === null)) throw new HttpError(409, 'Decide on every file first.')
  await pool.query(
    review.kind === 'investigation'
      ? `UPDATE interview_reviews SET status = 'finalizing', completed_by = $2 WHERE id = $1`
      : `UPDATE interview_reviews SET status = 'completed', completed_at = now(), completed_by = $2 WHERE id = $1`,
    [reviewId, userId],
  )
  return findReview(courseId, reviewId)
}

/**
 * Starts a failed review again: lists an interview's new facts, or, for an
 * investigation, investigates again (no report yet) or rewrites the team's
 * report (the instructor had finished). The caller starts an investigation's work.
 */
export async function retryReview(courseId: string, reviewId: string) {
  const review = await findReview(courseId, reviewId)
  if (review.status !== 'failed') throw new HttpError(409, 'Only a review that failed can be retried.')
  const next = review.kind === 'investigation' && review.report !== null ? 'finalizing' : 'summarizing'
  await pool.query(`UPDATE interview_reviews SET status = $2, error = NULL WHERE id = $1`, [reviewId, next])
  // Read it before the work starts, or a quick summary could finish first and the reply skip "summarizing".
  const retried = await findReview(courseId, reviewId)
  if (review.kind === 'interview') queueReview(reviewId)
  return retried
}

/** Why an exchange is struck out: it stated a denied fact, or its question built on one. */
export interface StrikeReason {
  kind: 'produced' | 'builtOn'
  fact: string
}

// Shape sent to the client; matches `ReviewTurn` in src/courses/types.ts.
export interface MarkedTurn {
  position: number
  question: string
  objection: string | null
  answer: string
  askedBy: string | null
  /** all: the question and answer rest on a denied fact; question: only the question does; null: it stands. */
  struck: 'all' | 'question' | null
  reasons: StrikeReason[]
}

interface FactLinks {
  producedBy: number[]
  builtOn: { turn: number; answer: boolean }[]
}

/**
 * The conversation behind an interview review, with the exchanges tied to a
 * denied fact struck out: the ones that stated it (question and answer), and
 * later questions that built on it (their answers too, if they rely on it).
 * `marked` is false for reviews from before facts were linked to exchanges.
 */
export async function markedTranscript(reviewId: string): Promise<{ turns: MarkedTurn[]; marked: boolean }> {
  const { rows: turns } = await pool.query<Omit<MarkedTurn, 'struck' | 'reasons'>>(
    `SELECT t.position, t.question, t.objection, t.answer, u.name AS "askedBy"
     FROM interview_turns t
     JOIN interview_reviews r ON r.interview_id = t.interview_id
     LEFT JOIN users u ON u.id = t.asked_by
     WHERE r.id = $1 ORDER BY t.position`,
    [reviewId],
  )
  const { rows: facts } = await pool.query<{ text: string; decision: FactDecision | null; links: FactLinks | null }>(
    'SELECT text, decision, links FROM review_facts WHERE review_id = $1 ORDER BY position',
    [reviewId],
  )
  const marked = turns.map((t): MarkedTurn => ({ ...t, struck: null, reasons: [] }))
  const at = (position: number) => marked.find((t) => t.position === position)
  const strike = (turn: MarkedTurn | undefined, how: 'all' | 'question', reason: StrikeReason) => {
    if (!turn) return
    if (turn.struck !== 'all') turn.struck = how
    if (!turn.reasons.some((r) => r.kind === reason.kind && r.fact === reason.fact)) turn.reasons.push(reason)
  }
  for (const fact of facts) {
    if (!fact.decision?.startsWith('deny') || !fact.links) continue
    for (const p of fact.links.producedBy) strike(at(p), 'all', { kind: 'produced', fact: fact.text })
    for (const b of fact.links.builtOn) strike(at(b.turn), b.answer ? 'all' : 'question', { kind: 'builtOn', fact: fact.text })
  }
  return { turns: marked, marked: facts.length === 0 || facts.some((f) => f.links !== null) }
}

/** The conversation behind a review, for the instructor: marked as the rulings so far stand. */
export async function reviewTranscript(courseId: string, reviewId: string) {
  await findReview(courseId, reviewId)
  return markedTranscript(reviewId)
}

/** A completed interview review of the student's team, or null (someone else's, still open, or an investigation). */
export async function findTeamInterviewReview(caseId: string, teamId: string, reviewId: string) {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM interview_reviews
     WHERE id = $1 AND case_id = $2 AND team_id = $3 AND kind = 'interview' AND status = 'completed'`,
    [reviewId, caseId, teamId],
  )
  return rows[0]?.id ?? null
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
    `SELECT r.id, json_build_object('id', w.id, 'name', w.name, 'avatarUrl', ${witnessAvatarUrlSql('w')}) AS witness, r.completed_at AS "completedAt",
            coalesce((SELECT json_agg(f.text ORDER BY f.position) FROM review_facts f
                      WHERE f.review_id = r.id AND f.decision LIKE 'accept%'), '[]') AS accepted,
            coalesce((SELECT json_agg(f.text ORDER BY f.position) FROM review_facts f
                      WHERE f.review_id = r.id AND f.decision LIKE 'deny%'), '[]') AS denied,
            EXISTS (SELECT 1 FROM review_seen s WHERE s.review_id = r.id AND s.user_id = $3) AS seen
     FROM interview_reviews r JOIN case_witnesses w ON w.id = r.witness_id
     WHERE r.case_id = $1 AND r.team_id = $2 AND r.status = 'completed' AND r.kind = 'interview'
     ORDER BY r.completed_at DESC`,
    [caseId, teamId, userId],
  )
  return rows
}

/** Marks every completed review of the team (interviews, or investigator reports) as read by this student. */
export async function markReviewsSeen(caseId: string, teamId: string, userId: string, kind: ReviewKind = 'interview') {
  await pool.query(
    `INSERT INTO review_seen (review_id, user_id)
     SELECT id, $3 FROM interview_reviews WHERE case_id = $1 AND team_id = $2 AND status = 'completed' AND kind = $4
     ON CONFLICT DO NOTHING`,
    [caseId, teamId, userId, kind],
  )
}

/** Completed reviews (and investigator reports) of the student's teams in this course that they haven't opened yet. */
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
