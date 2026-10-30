import { ai, AiNotConfiguredError } from '../ai/ai.ts'
import { listMaterialTexts, witnessAvatarUrlSql } from '../courses/caseContent.ts'
import { finishPendingTranscriptions } from '../courses/materialText.ts'
import type { Side } from '../courses/matchups.ts'
import { pool } from '../db/pool.ts'
import { HttpError } from '../httpError.ts'
import { stripTags } from '../investigator/finalize.ts'
import type { SettledFacts } from '../witness/prompt.ts'
import { queueGrouping } from './grouping.ts'

// When a team ends an interview, the AI lists the new facts the witness added
// (in the background, like transcriptions). The instructor rules on each one:
// accept or deny, for the team's case world or for every world in the case.
// Once the review is completed, the rulings bind every later interview, and
// the team sees which facts were accepted and which denied.
//
// A team's request to the background investigator is reviewed the same way
// (kind 'investigation'; its lifecycle is in server/investigator/requests.ts),
// plus a ruling on each case file he'd unlock for the team.
//
// Similar facts from different reviews are grouped (grouping.ts) and ruled
// together. A review finishes on its own once everything in it is ruled, and
// rulings can still be changed afterwards. In review lite mode the AI's calls
// stand at once: every new fact is accepted for the team's world and every
// file the investigator found is allowed (marked `auto`), and students flag
// what they think is wrong (flags.ts).

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
  facts: { id: string; text: string; decision: FactDecision | null; groupId: string | null; auto: boolean }[]
  /** An investigation's assignment (what the team asked) and who sent it. */
  assignment: string | null
  askedBy: string | null
  /** An investigation's report as the investigator wrote it, without its review block. */
  report: string | null
  /** The report the team got (once completed). */
  finalReport: string | null
  /** Records the team asked for that need legal process, for the instructor's information. */
  recordsRequested: string[]
  /** The investigator left off his review block, so his new facts and files weren't listed. */
  reviewBlockMissing: boolean
  /** Case files the investigator would unlock for the team, and the instructor's call on each. */
  documents: { materialId: string; title: string; decision: DocumentDecision | null; auto: boolean }[]
}

/** What students see of a completed review: only whether each fact stands. */
export interface ReviewResult {
  id: string
  witness: { id: string; name: string; avatarUrl: string | null }
  completedAt: Date
  accepted: string[]
  denied: string[]
  /** Each fact, for flagging the ones decided automatically. */
  items: { id: string; text: string; accepted: boolean; auto: boolean }[]
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
      lite: boolean
    }>(
      `SELECT r.case_id AS "caseId", r.matchup_id AS "matchupId", r.interview_id AS "interviewId",
              c.title AS "caseTitle", w.name AS "witnessName", c.review_mode = 'lite' AS lite
       FROM interview_reviews r
       JOIN cases c ON c.id = r.case_id
       JOIN case_witnesses w ON w.id = r.witness_id
       WHERE r.id = $1`,
      [id],
    )
    const review = rows[0]
    if (!review) return // deleted meanwhile

    let materials = await listMaterialTexts(review.caseId, review.matchupId)
    if (materials.some((m) => m.textStatus === 'pending')) {
      await finishPendingTranscriptions(materials)
      materials = await listMaterialTexts(review.caseId, review.matchupId)
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
        // Review lite: the testimony stands, for this world only.
        await client.query(
          `INSERT INTO review_facts (review_id, position, text, links, decision, decided_at, auto)
           VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN 'accept_world' END, CASE WHEN $5 THEN now() END, $5)`,
          [id, position, fact.text, JSON.stringify({ producedBy: fact.producedBy, builtOn: fact.builtOn }), review.lite],
        )
      }
      // Nothing new means nothing to rule on, so the review is done; so is everything in review lite.
      const done = !facts.length || review.lite
      await client.query(
        `UPDATE interview_reviews
         SET status = $2, error = NULL, completed_at = CASE WHEN $2 = 'completed' THEN now() END
         WHERE id = $1`,
        [id, done ? 'completed' : 'open'],
      )
      await client.query('COMMIT')
      if (!done) queueGrouping(review.caseId)
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
         coalesce((SELECT json_agg(json_build_object('id', f.id, 'text', f.text, 'decision', f.decision,
                                                     'groupId', f.group_id, 'auto', f.auto)
                                   ORDER BY f.position)
                   FROM review_facts f WHERE f.review_id = r.id), '[]') AS facts,
         r.assignment, (SELECT u.name FROM users u WHERE u.id = r.asked_by) AS "askedBy",
         r.report, r.final_report AS "finalReport", r.records_requested AS "recordsRequested",
         r.review_block_missing AS "reviewBlockMissing",
         coalesce((SELECT json_agg(json_build_object('materialId', d.material_id,
                                                     'title', coalesce(nullif(cm.description, ''), cm.filename),
                                                     'decision', d.decision, 'auto', d.auto) ORDER BY d.position)
                   FROM review_documents d JOIN case_materials cm ON cm.id = d.material_id
                   WHERE d.review_id = r.id), '[]') AS documents
  FROM interview_reviews r
  JOIN cases c ON c.id = r.case_id
  LEFT JOIN case_witnesses w ON w.id = r.witness_id`

/**
 * The investigator's report as the instructor reads it: without the source
 * tags naming files (the files are listed to allow or not). The tagged
 * original stays stored, for writing the team's report.
 */
const forInstructor = (r: InterviewReview): InterviewReview => (r.report ? { ...r, report: stripTags(r.report) } : r)

/**
 * The course's reviews still to do (newest first), or the completed ones (most
 * recently completed first). A review the instructor has finished counts as
 * completed while the team's report is still being written.
 */
export async function listReviews(courseId: string, which: 'open' | 'completed') {
  const { rows } = await pool.query<InterviewReview>(
    `${REVIEW_SELECT}
     WHERE c.course_id = $1 AND (r.status IN ('completed', 'finalizing')) = $2
     ORDER BY ${which === 'completed' ? 'r.completed_at DESC NULLS FIRST' : 'r.created_at DESC'}`,
    [courseId, which === 'completed'],
  )
  return rows.map(forInstructor)
}

async function findReview(courseId: string, reviewId: string) {
  const { rows } = await pool.query<InterviewReview>(`${REVIEW_SELECT} WHERE c.course_id = $1 AND r.id = $2`, [
    courseId,
    reviewId,
  ])
  if (!rows[0]) throw new HttpError(404, 'Review not found.')
  return forInstructor(rows[0])
}

export async function getReview(courseId: string, reviewId: string) {
  return findReview(courseId, reviewId)
}

/**
 * Records the instructor's ruling on one fact, or changes it once the review
 * is done. A fact in a group is ruled with its group while the review is
 * open. Ruling the last thing in a review finishes it (see finishIfRuled);
 * changing a ruling on a finished investigation rewrites the team's report,
 * so the caller starts that when the review comes back `finalizing`.
 */
export async function decideFact(courseId: string, reviewId: string, factId: string, decision: FactDecision, userId: string | null) {
  const review = await findReview(courseId, reviewId)
  assertRuleable(review)
  const fact = review.facts.find((f) => f.id === factId)
  if (!fact) throw new HttpError(404, 'Fact not found.')
  if (review.status === 'open' && fact.groupId) throw new HttpError(409, 'Rule on this fact with its group, or ungroup it first.')
  await pool.query('UPDATE review_facts SET decision = $3, decided_at = now(), auto = false WHERE review_id = $1 AND id = $2', [
    reviewId,
    factId,
    decision,
  ])
  // An investigator report says what's true, so it's rewritten when a fact goes from standing to denied, or back.
  const flipped = fact.decision !== null && fact.decision.startsWith('deny') !== decision.startsWith('deny')
  return afterRuling(courseId, review, userId, flipped)
}

/** Records the instructor's call on letting the team have one case file the investigator found, or changes it. */
export async function decideDocument(
  courseId: string,
  reviewId: string,
  materialId: string,
  decision: DocumentDecision,
  userId: string | null,
) {
  const review = await findReview(courseId, reviewId)
  assertRuleable(review)
  const doc = review.documents.find((d) => d.materialId === materialId)
  if (!doc) throw new HttpError(404, 'File not found.')
  await pool.query('UPDATE review_documents SET decision = $3, auto = false WHERE review_id = $1 AND material_id = $2', [
    reviewId,
    materialId,
    decision,
  ])
  return afterRuling(courseId, review, userId, doc.decision !== null && doc.decision !== decision)
}

function assertRuleable(review: InterviewReview) {
  if (review.status === 'finalizing') throw new HttpError(409, 'The team’s report is being written. Try again in a moment.')
  if (review.status !== 'open' && review.status !== 'completed') {
    throw new HttpError(409, 'The new facts in this conversation are not listed yet.')
  }
}

/**
 * After a ruling: an open review finishes once everything in it is ruled; a
 * finished investigation whose ruling changed goes back to `finalizing` so
 * the team's report (and its files) match. The caller starts that.
 */
async function afterRuling(courseId: string, review: InterviewReview, userId: string | null, changed: boolean) {
  if (review.status === 'open') await finishIfRuled(review.id, userId)
  else if (review.kind === 'investigation' && changed) {
    await pool.query(`UPDATE interview_reviews SET status = 'finalizing' WHERE id = $1 AND status = 'completed'`, [review.id])
  }
  return findReview(courseId, review.id)
}

/**
 * Finishes an open review once every fact (and, for an investigation, every
 * file) has a ruling. An interview's rulings take effect now; an
 * investigation goes on to `finalizing` while the team's clean report is
 * written (the caller starts that), and its rulings take effect when it's done.
 */
export async function finishIfRuled(reviewId: string, userId: string | null) {
  await pool.query(
    `UPDATE interview_reviews r
     SET status = CASE WHEN r.kind = 'investigation' THEN 'finalizing' ELSE 'completed' END,
         completed_at = CASE WHEN r.kind = 'investigation' THEN r.completed_at ELSE now() END,
         completed_by = $2
     WHERE r.id = $1 AND r.status = 'open'
       AND NOT EXISTS (SELECT 1 FROM review_facts f WHERE f.review_id = r.id AND f.decision IS NULL)
       AND NOT EXISTS (SELECT 1 FROM review_documents d WHERE d.review_id = r.id AND d.decision IS NULL)`,
    [reviewId, userId],
  )
}

/**
 * Sends on a review with nothing to rule on: an investigator's report that
 * turned up no new facts or files waits for the instructor to read it first.
 * (Everything else finishes on its own once ruled.)
 */
export async function completeReview(courseId: string, reviewId: string, userId: string) {
  const review = await findReview(courseId, reviewId)
  if (review.status === 'completed' || review.status === 'finalizing') throw new HttpError(409, 'This review is already completed.')
  if (review.status !== 'open') throw new HttpError(409, 'The new facts in this conversation are not listed yet.')
  if (review.facts.some((f) => f.decision === null)) throw new HttpError(409, 'Rule on every fact first.')
  if (review.documents.some((d) => d.decision === null)) throw new HttpError(409, 'Decide on every file first.')
  await finishIfRuled(reviewId, userId)
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
     WHERE c.course_id = $1 AND r.status NOT IN ('completed', 'finalizing')`,
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
            coalesce((SELECT json_agg(json_build_object('id', f.id, 'text', f.text,
                                                        'accepted', f.decision LIKE 'accept%', 'auto', f.auto)
                                      ORDER BY f.position)
                      FROM review_facts f WHERE f.review_id = r.id), '[]') AS items,
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

/** Where the student's newest unread result is: its case, and whether it's an interview's rulings or an investigator report. */
export async function newestUnseenResult(courseId: string, userId: string) {
  const { rows } = await pool.query<{ caseId: string; kind: 'interview' | 'investigation' }>(
    `SELECT r.case_id AS "caseId", r.kind
     FROM interview_reviews r
     JOIN cases c ON c.id = r.case_id
     JOIN team_members m ON m.team_id = r.team_id
     JOIN enrollments e ON e.course_id = m.course_id AND e.email = m.email
     WHERE c.course_id = $1 AND e.user_id = $2 AND r.status = 'completed'
       AND NOT EXISTS (SELECT 1 FROM review_seen s WHERE s.review_id = r.id AND s.user_id = $2)
     ORDER BY r.completed_at DESC
     LIMIT 1`,
    [courseId, userId],
  )
  return rows[0] ?? null
}
