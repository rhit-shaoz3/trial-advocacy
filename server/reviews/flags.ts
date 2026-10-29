import { pool } from '../db/pool.ts'
import { getCourseSubpoena, reopenSubpoena, type CourseSubpoena } from '../exchange/subpoenas.ts'
import { HttpError } from '../httpError.ts'
import {
  decideDocument,
  decideFact,
  DOCUMENT_DECISIONS,
  FACT_DECISIONS,
  getReview,
  type DocumentDecision,
  type FactDecision,
  type InterviewReview,
} from './reviews.ts'

// In review lite mode the AI's calls stand without the instructor, so students
// flag the ones they think are wrong: a fact a witness or the investigator
// added, a file the investigator gave them, or a subpoena's answer (appealing
// a denial). A flag waits on the Review page with what it's about, laid out
// as it would have been for review; the instructor keeps the call or changes
// it, and the team sees which.

export const FLAG_KINDS = ['fact', 'document', 'subpoena'] as const
export type FlagKind = (typeof FLAG_KINDS)[number]
export const MAX_REASON_LENGTH = 1000

// Shape sent to students; matches `TeamFlag` in src/courses/types.ts.
export interface TeamFlag {
  id: string
  kind: FlagKind
  /** The fact, file, or subpoena flagged. */
  targetId: string
  /** For a file: the investigator report it came with. */
  reviewId: string | null
  reason: string
  status: 'open' | 'resolved'
  resolution: 'kept' | 'changed' | null
  createdAt: Date
  resolvedAt: Date | null
  /** Whether this student has read the instructor's answer. */
  seen: boolean
}

// Shape sent to the instructor; matches `CourseFlag` in src/courses/types.ts.
export interface CourseFlag {
  id: string
  kind: FlagKind
  caseId: string
  caseTitle: string
  teamNumber: number
  worldNumber: number | null
  raisedBy: string | null
  reason: string
  createdAt: Date
  /** The flagged fact, in its review. */
  factId: string | null
  /** The flagged file, in its investigator review. */
  materialId: string | null
  review: InterviewReview | null
  subpoena: CourseSubpoena | null
}

const TARGET = `coalesce(f.review_fact_id, f.material_id, f.subpoena_id)`

/** The team's flags, newest first. */
export async function teamFlags(caseId: string, teamId: string, userId: string): Promise<TeamFlag[]> {
  const { rows } = await pool.query<TeamFlag>(
    `SELECT f.id, f.kind, ${TARGET} AS "targetId", f.review_id AS "reviewId", f.reason, f.status, f.resolution,
            f.created_at AS "createdAt", f.resolved_at AS "resolvedAt",
            EXISTS (SELECT 1 FROM flag_seen s WHERE s.flag_id = f.id AND s.user_id = $3) AS seen
     FROM review_flags f WHERE f.case_id = $1 AND f.team_id = $2
     ORDER BY f.created_at DESC`,
    [caseId, teamId, userId],
  )
  return rows
}

/** Whether the team may flag this: theirs, decided automatically, and standing. */
async function flaggable(kind: FlagKind, teamId: string, targetId: string, reviewId: string | null) {
  const query =
    kind === 'fact'
      ? `SELECT r.id FROM review_facts f JOIN interview_reviews r ON r.id = f.review_id
         WHERE f.id = $1 AND r.team_id = $2 AND r.status = 'completed' AND f.auto AND f.decision = 'accept_world'`
      : kind === 'document'
        ? `SELECT r.id FROM review_documents d JOIN interview_reviews r ON r.id = d.review_id
           WHERE d.material_id = $1 AND r.team_id = $2 AND r.id = $3 AND r.status = 'completed' AND d.auto AND d.decision = 'allow'`
        : `SELECT s.id FROM subpoenas s WHERE s.id = $1 AND s.team_id = $2 AND s.responded_at IS NOT NULL AND s.auto`
  const { rows } = await pool.query(query, kind === 'document' ? [targetId, teamId, reviewId] : [targetId, teamId])
  return rows.length > 0
}

/** Flags something decided automatically for the instructor: `{ kind, targetId, reviewId (for a file), reason }`. */
export async function raiseFlag(ctx: { caseId: string; teamId: string; userId: string }, body: unknown) {
  const value = (body ?? {}) as Record<string, unknown>
  const kind = value.kind as FlagKind
  if (!FLAG_KINDS.includes(kind)) throw new HttpError(400, 'Say what you are flagging.')
  const targetId = typeof value.targetId === 'string' ? value.targetId : ''
  const reviewId = kind === 'document' && typeof value.reviewId === 'string' ? value.reviewId : null
  const reason = typeof value.reason === 'string' ? value.reason.trim() : ''
  if (!reason) throw new HttpError(400, 'Say what you think is wrong.')
  if (reason.length > MAX_REASON_LENGTH) throw new HttpError(400, `Keep it to ${MAX_REASON_LENGTH} characters.`)
  const uuid = /^[0-9a-f-]{36}$/i
  if (!uuid.test(targetId) || (kind === 'document' && !uuid.test(reviewId ?? ''))) throw new HttpError(404, 'Not found.')
  if (!(await flaggable(kind, ctx.teamId, targetId, reviewId))) {
    throw new HttpError(409, 'Only something decided automatically, and still standing, can be flagged.')
  }
  try {
    await pool.query(
      `INSERT INTO review_flags (case_id, team_id, kind, review_fact_id, review_id, material_id, subpoena_id, reason, raised_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        ctx.caseId,
        ctx.teamId,
        kind,
        kind === 'fact' ? targetId : null,
        reviewId,
        kind === 'document' ? targetId : null,
        kind === 'subpoena' ? targetId : null,
        reason,
        ctx.userId,
      ],
    )
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new HttpError(409, 'This is already flagged for your instructor.')
    throw err
  }
  return teamFlags(ctx.caseId, ctx.teamId, ctx.userId)
}

/** Marks the instructor's answers to the team's flags as read by this student. */
export async function markFlagsSeen(caseId: string, teamId: string, userId: string) {
  await pool.query(
    `INSERT INTO flag_seen (flag_id, user_id)
     SELECT id, $3 FROM review_flags WHERE case_id = $1 AND team_id = $2 AND status = 'resolved'
     ON CONFLICT DO NOTHING`,
    [caseId, teamId, userId],
  )
}

interface FlagRow extends Omit<CourseFlag, 'review' | 'subpoena'> {
  courseId: string
  reviewId: string | null
  subpoenaId: string | null
  /** For a fact, the review it's in. */
  factReviewId: string | null
}

const FLAG_SELECT = `
  SELECT f.id, f.kind, f.case_id AS "caseId", c.title AS "caseTitle", c.course_id AS "courseId",
         t.number AS "teamNumber", mu.number AS "worldNumber", u.name AS "raisedBy", f.reason, f.created_at AS "createdAt",
         f.review_fact_id AS "factId", f.material_id AS "materialId", f.review_id AS "reviewId", f.subpoena_id AS "subpoenaId",
         (SELECT rf.review_id FROM review_facts rf WHERE rf.id = f.review_fact_id) AS "factReviewId"
  FROM review_flags f
  JOIN cases c ON c.id = f.case_id
  JOIN teams t ON t.id = f.team_id
  LEFT JOIN matchup_teams mt ON mt.team_id = f.team_id
  LEFT JOIN matchups mu ON mu.id = mt.matchup_id
  LEFT JOIN users u ON u.id = f.raised_by`

async function withTarget(row: FlagRow): Promise<CourseFlag> {
  const { courseId, reviewId, subpoenaId, factReviewId, ...flag } = row
  const ofReview = factReviewId ?? reviewId
  return {
    ...flag,
    review: ofReview ? await getReview(courseId, ofReview) : null,
    subpoena: subpoenaId ? await getCourseSubpoena(courseId, subpoenaId) : null,
  }
}

/** The course's flags waiting for the instructor, oldest first. */
export async function listOpenFlags(courseId: string) {
  const { rows } = await pool.query<FlagRow>(`${FLAG_SELECT} WHERE c.course_id = $1 AND f.status = 'open' ORDER BY f.created_at`, [
    courseId,
  ])
  return Promise.all(rows.map(withTarget))
}

export async function openFlagCount(courseId: string) {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM review_flags f JOIN cases c ON c.id = f.case_id
     WHERE c.course_id = $1 AND f.status = 'open'`,
    [courseId],
  )
  return rows[0].n
}

/**
 * Answers a flag. A fact: `{ decision }`, any ruling (accept_world keeps it).
 * A file: `{ decision }`, allow (keep) or deny (take it back from the team).
 * A subpoena: `{ action }`, keep, or reopen (take the answer back, for the
 * instructor to answer again). Returns the review it changed, if any, so the
 * caller can start rewriting an investigator's report.
 */
export async function resolveFlag(courseId: string, flagId: string, userId: string, body: unknown) {
  const { rows } = await pool.query<FlagRow>(`${FLAG_SELECT} WHERE c.course_id = $1 AND f.id = $2 AND f.status = 'open'`, [
    courseId,
    flagId,
  ])
  const flag = rows[0]
  if (!flag) throw new HttpError(404, 'That flag was already answered.')
  const value = (body ?? {}) as Record<string, unknown>
  let changed = false
  let review: InterviewReview | null = null
  let subpoena: CourseSubpoena | null = null
  if (flag.kind === 'fact') {
    const decision = value.decision as FactDecision
    if (!FACT_DECISIONS.includes(decision)) throw new HttpError(400, 'Choose a ruling for this fact.')
    changed = decision !== 'accept_world'
    review = changed ? await decideFact(courseId, flag.factReviewId!, flag.factId!, decision, userId) : null
  } else if (flag.kind === 'document') {
    const decision = value.decision as DocumentDecision
    if (!DOCUMENT_DECISIONS.includes(decision)) throw new HttpError(400, 'Choose whether the team keeps this file.')
    changed = decision === 'deny'
    review = changed ? await decideDocument(courseId, flag.reviewId!, flag.materialId!, decision, userId) : null
  } else {
    if (value.action !== 'keep' && value.action !== 'reopen') throw new HttpError(400, 'Choose to keep the answer or reopen it.')
    changed = value.action === 'reopen'
    subpoena = changed ? await reopenSubpoena(courseId, flag.subpoenaId!) : null
  }
  await pool.query(
    `UPDATE review_flags SET status = 'resolved', resolution = $2, resolved_by = $3, resolved_at = now() WHERE id = $1`,
    [flagId, changed ? 'changed' : 'kept', userId],
  )
  return { review, subpoena }
}
