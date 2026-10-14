import { randomInt } from 'node:crypto'
import { pool } from '../db/pool.ts'
import type { Db } from '../db/transaction.ts'

// Shapes sent to the client; match `Course` and `TaughtCourse` in src/courses/types.ts.
export interface PublicCourse {
  id: string
  code: string
  title: string
  term: string
  instructorName: string | null
}

/** What the course's instructor sees: adds the private entry code. */
export interface TaughtCourse extends PublicCourse {
  /** `term` split back into its parts, e.g. "Fall" and 2026, to prefill the edit form. */
  season: string
  year: number
  entryCode: string
  /** Joined students. */
  studentCount: number
  /** Students who entered the entry code and are waiting to be admitted. */
  requestCount: number
  /** Emails the instructor invited that haven't accepted yet. */
  invitedCount: number
}

/** The editable fields, already validated. */
export interface CourseFields {
  code: string
  title: string
  term: string
  termStart: string
}

const SELECT_COURSE = `
  SELECT c.id, c.code, c.title, c.term, u.name AS "instructorName"
  FROM courses c
  LEFT JOIN users u ON u.id = c.instructor_id`

const SELECT_TAUGHT_COURSE = `
  SELECT c.id, c.code, c.title, c.term, u.name AS "instructorName",
         split_part(c.term, ' ', 1) AS season,
         extract(year FROM c.term_start)::int AS year,
         c.entry_code AS "entryCode",
         (SELECT count(*)::int FROM enrollments e
          WHERE e.course_id = c.id AND e.status = 'joined') AS "studentCount",
         (SELECT count(*)::int FROM enrollments e
          WHERE e.course_id = c.id AND e.status = 'requested') AS "requestCount",
         (SELECT count(*)::int FROM enrollments e
          WHERE e.course_id = c.id AND e.status = 'invited') AS "invitedCount"
  FROM courses c
  LEFT JOIN users u ON u.id = c.instructor_id`

const NEWEST_FIRST = 'ORDER BY c.term_start DESC, c.code, c.title'

/** Courses the user has joined, newest term first. */
export async function listCoursesForUser(userId: string) {
  const { rows } = await pool.query<PublicCourse>(
    `${SELECT_COURSE}
     JOIN enrollments e ON e.course_id = c.id
     WHERE e.user_id = $1 AND e.status = 'joined'
     ${NEWEST_FIRST}`,
    [userId],
  )
  return rows
}

/** Courses the instructor teaches, newest term first. */
export async function listTaughtCourses(instructorId: string) {
  const { rows } = await pool.query<TaughtCourse>(
    `${SELECT_TAUGHT_COURSE} WHERE c.instructor_id = $1 ${NEWEST_FIRST}`,
    [instructorId],
  )
  return rows
}

/** Null unless the course exists and `instructorId` teaches it. */
export async function findTaughtCourse(courseId: string, instructorId: string) {
  const { rows } = await pool.query<TaughtCourse>(
    `${SELECT_TAUGHT_COURSE} WHERE c.id = $1 AND c.instructor_id = $2`,
    [courseId, instructorId],
  )
  return rows[0] ?? null
}

/** Null unless the user has joined the course or teaches it. Invitations and requests don't count. */
export async function findCourseForMember(courseId: string, userId: string) {
  const { rows } = await pool.query<PublicCourse>(
    `${SELECT_COURSE}
     WHERE c.id = $1
       AND (c.instructor_id = $2
            OR EXISTS (SELECT 1 FROM enrollments e
                       WHERE e.course_id = c.id AND e.user_id = $2 AND e.status = 'joined'))`,
    [courseId, userId],
  )
  return rows[0] ?? null
}

export async function findCourseByEntryCode(entryCode: string) {
  const { rows } = await pool.query<PublicCourse>(
    `${SELECT_COURSE} WHERE c.entry_code = $1`,
    [entryCode],
  )
  return rows[0] ?? null
}

export const NO_COURSE_FOR_CODE = "Sorry, we can't find a course with that code."

export type JoinResult = 'joined' | 'requested' | 'already-joined' | 'already-requested'

/**
 * A student entering the entry code. If the instructor already invited them
 * they're in straight away; otherwise it's a request the instructor admits or
 * denies. Someone who was denied can ask again.
 */
export async function requestToJoin(
  user: { id: string; email: string },
  courseId: string,
  db: Db = pool,
): Promise<JoinResult> {
  const email = user.email.toLowerCase()
  const { rows } = await db.query<{ status: string }>(
    'SELECT status FROM enrollments WHERE course_id = $1 AND email = $2',
    [courseId, email],
  )
  const current = rows[0]?.status
  if (current === 'joined') return 'already-joined'
  if (current === 'requested') return 'already-requested'
  if (current === 'invited') {
    await db.query(
      `UPDATE enrollments SET status = 'joined', user_id = $3 WHERE course_id = $1 AND email = $2`,
      [courseId, email, user.id],
    )
    return 'joined'
  }
  await db.query(
    `INSERT INTO enrollments (course_id, email, user_id, status) VALUES ($1, $2, $3, 'requested')
     ON CONFLICT (course_id, email) DO UPDATE SET status = 'requested', user_id = EXCLUDED.user_id,
       added_at = now()`,
    [courseId, email, user.id],
  )
  return 'requested'
}

// No 0/O or 1/I, so codes survive being read aloud or copied by hand.
const ENTRY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const ENTRY_CODE_LENGTH = 6

function randomEntryCode() {
  let code = ''
  for (let i = 0; i < ENTRY_CODE_LENGTH; i++) {
    code += ENTRY_CODE_ALPHABET[randomInt(ENTRY_CODE_ALPHABET.length)]
  }
  return code
}

export async function createCourse(input: CourseFields & { instructorId: string }) {
  // ~10^9 possible codes, so a collision is rare; retry a few times if one happens.
  for (let attempt = 0; attempt < 5; attempt++) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO courses (code, title, term, term_start, entry_code, instructor_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (entry_code) DO NOTHING
       RETURNING id`,
      [input.code, input.title, input.term, input.termStart, randomEntryCode(), input.instructorId],
    )
    if (rows[0]) return (await findTaughtCourse(rows[0].id, input.instructorId))!
  }
  throw new Error('Could not generate a unique entry code.')
}

/** Changes the details; the entry code and roster stay the same. Returns the updated course. */
export async function updateCourse(courseId: string, fields: CourseFields) {
  const { rows } = await pool.query<{ instructor_id: string }>(
    `UPDATE courses SET code = $2, title = $3, term = $4, term_start = $5
     WHERE id = $1 RETURNING instructor_id`,
    [courseId, fields.code, fields.title, fields.term, fields.termStart],
  )
  return (await findTaughtCourse(courseId, rows[0].instructor_id))!
}

/** Deletes the course; its roster and fact patterns go with it (ON DELETE CASCADE). */
export async function deleteCourse(courseId: string) {
  await pool.query('DELETE FROM courses WHERE id = $1', [courseId])
}
