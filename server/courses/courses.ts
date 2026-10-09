import { pool } from '../db/pool.ts'

// Shape sent to the client; matches `Course` in src/courses/types.ts.
export interface PublicCourse {
  id: string
  code: string
  title: string
  term: string
  instructorName: string | null
}

const SELECT_COURSE = `
  SELECT c.id, c.code, c.title, c.term, u.name AS "instructorName"
  FROM courses c
  LEFT JOIN users u ON u.id = c.instructor_id`

/** The user's courses, newest term first. */
export async function listCoursesForUser(userId: string) {
  const { rows } = await pool.query<PublicCourse>(
    `${SELECT_COURSE}
     JOIN enrollments e ON e.course_id = c.id
     WHERE e.user_id = $1
     ORDER BY c.term_start DESC, c.code, c.title`,
    [userId],
  )
  return rows
}

export async function findCourseByEntryCode(entryCode: string) {
  const { rows } = await pool.query<PublicCourse>(
    `${SELECT_COURSE} WHERE c.entry_code = $1`,
    [entryCode],
  )
  return rows[0] ?? null
}

/** Returns false if the user was already enrolled. */
export async function enroll(userId: string, courseId: string) {
  const { rowCount } = await pool.query(
    `INSERT INTO enrollments (user_id, course_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [userId, courseId],
  )
  return rowCount === 1
}
