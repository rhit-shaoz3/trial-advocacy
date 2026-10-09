import { findUserByEmail } from '../auth/users.ts'
import { pool } from '../db/pool.ts'

// Shape sent to the client; matches `RosterEntry` in src/courses/types.ts.
export interface RosterEntry {
  email: string
  /** Null until the student has an account. */
  name: string | null
  joined: boolean
}

/** Joined students by name, then pending emails. */
export async function listRoster(courseId: string) {
  const { rows } = await pool.query<RosterEntry>(
    `SELECT e.email, u.name, e.user_id IS NOT NULL AS joined
     FROM enrollments e
     LEFT JOIN users u ON u.id = e.user_id
     WHERE e.course_id = $1
     ORDER BY e.user_id IS NULL, lower(u.name), e.email`,
    [courseId],
  )
  return rows
}

export type AddResult = 'added' | 'already-enrolled' | 'instructor'

/** Adds a student by email, linking their account right away if they have one. */
export async function addToRoster(courseId: string, email: string): Promise<AddResult> {
  const user = await findUserByEmail(email)
  if (user?.role === 'instructor') return 'instructor'

  const { rowCount } = await pool.query(
    `INSERT INTO enrollments (course_id, email, user_id) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [courseId, email, user?.id ?? null],
  )
  return rowCount === 1 ? 'added' : 'already-enrolled'
}

/** Returns false if the email was not on the roster. */
export async function removeFromRoster(courseId: string, email: string) {
  const { rowCount } = await pool.query(
    'DELETE FROM enrollments WHERE course_id = $1 AND email = $2',
    [courseId, email],
  )
  return rowCount === 1
}

/** Called at sign-up: claims every roster spot an instructor added for this email. */
export async function claimPendingEnrollments(userId: string, email: string) {
  await pool.query(
    'UPDATE enrollments SET user_id = $1 WHERE email = $2 AND user_id IS NULL',
    [userId, email.toLowerCase()],
  )
}
