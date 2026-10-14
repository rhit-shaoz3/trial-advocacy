import { findUserByEmail } from '../auth/users.ts'
import { pool } from '../db/pool.ts'

export type RosterStatus = 'joined' | 'invited' | 'requested'

// Shape sent to the client; matches `RosterEntry` in src/courses/types.ts.
export interface RosterEntry {
  email: string
  /** Null until the student has an account. */
  name: string | null
  /** The student's account, if they have one. */
  userId: string | null
  status: RosterStatus
}

/**
 * Everyone on the roster except denied requests: joined students by name, then
 * people asking to join, then invitations.
 */
export async function listRoster(courseId: string) {
  const { rows } = await pool.query<RosterEntry>(
    `SELECT e.email, u.name, u.id AS "userId", e.status
     FROM enrollments e
     LEFT JOIN users u ON u.id = e.user_id
     WHERE e.course_id = $1 AND e.status <> 'denied'
     ORDER BY array_position(ARRAY['joined', 'requested', 'invited'], e.status),
              lower(u.name), e.email`,
    [courseId],
  )
  return rows
}

export type AddResult = 'added' | 'already-enrolled' | 'already-invited' | 'instructor'

/**
 * Invites a student by email. They accept or reject the invitation when they
 * log in (or after they sign up with that email). Someone already asking to
 * join is simply admitted.
 */
export async function addToRoster(courseId: string, email: string): Promise<AddResult> {
  const user = await findUserByEmail(email)
  if (user?.role === 'instructor') return 'instructor'

  const { rows } = await pool.query<{ status: string }>(
    'SELECT status FROM enrollments WHERE course_id = $1 AND email = $2',
    [courseId, email],
  )
  const current = rows[0]?.status
  if (current === 'joined') return 'already-enrolled'
  if (current === 'invited') return 'already-invited'

  await pool.query(
    `INSERT INTO enrollments (course_id, email, user_id, status) VALUES ($1, $2, $3, 'invited')
     ON CONFLICT (course_id, email) DO UPDATE
       SET status = CASE WHEN enrollments.status = 'requested' THEN 'joined' ELSE 'invited' END`,
    [courseId, email, user?.id ?? null],
  )
  return 'added'
}

/** Returns false if the email was not on the roster. */
export async function removeFromRoster(courseId: string, email: string) {
  const { rowCount } = await pool.query(
    'DELETE FROM enrollments WHERE course_id = $1 AND email = $2',
    [courseId, email],
  )
  return rowCount === 1
}

/** Called at sign-up: links invitations sent to this email, so the student sees them. */
export async function claimPendingEnrollments(userId: string, email: string) {
  await pool.query(
    'UPDATE enrollments SET user_id = $1 WHERE email = $2 AND user_id IS NULL',
    [userId, email.toLowerCase()],
  )
}

/** Admits or denies students who asked to join. Returns how many changed. */
export async function decideRequests(courseId: string, userIds: string[], admit: boolean) {
  const { rowCount } = await pool.query(
    `UPDATE enrollments SET status = $3
     WHERE course_id = $1 AND user_id = ANY($2::uuid[]) AND status = 'requested'`,
    [courseId, userIds, admit ? 'joined' : 'denied'],
  )
  return rowCount ?? 0
}

interface InboxRow {
  courseId: string
  /** e.g. "LAW 540: Trial Advocacy" */
  courseName: string
  status: string
}

/** What a student needs to see on their dashboard besides their courses. */
export async function getInbox(userId: string) {
  const { rows } = await pool.query<InboxRow>(
    `SELECT c.id AS "courseId", c.code || ': ' || c.title AS "courseName", e.status
     FROM enrollments e JOIN courses c ON c.id = e.course_id
     WHERE e.user_id = $1 AND e.status <> 'joined'
     ORDER BY e.added_at`,
    [userId],
  )
  const pick = (status: string) =>
    rows.filter((r) => r.status === status).map(({ courseId, courseName }) => ({ courseId, courseName }))
  return {
    invitations: pick('invited'),
    pendingRequests: pick('requested'),
    denials: pick('denied'),
  }
}

/** Accepts or rejects an invitation. Rejecting takes the email off the roster. */
export async function answerInvitation(courseId: string, userId: string, accept: boolean) {
  const { rowCount } = await pool.query(
    accept
      ? `UPDATE enrollments SET status = 'joined'
         WHERE course_id = $1 AND user_id = $2 AND status = 'invited'`
      : `DELETE FROM enrollments WHERE course_id = $1 AND user_id = $2 AND status = 'invited'`,
    [courseId, userId],
  )
  return rowCount === 1
}

/** Clears a "your request was denied" notice once the student has seen it. */
export async function dismissDenial(courseId: string, userId: string) {
  await pool.query(
    `DELETE FROM enrollments WHERE course_id = $1 AND user_id = $2 AND status = 'denied'`,
    [courseId, userId],
  )
}
