import { pool } from '../db/pool.ts'
import type { Db } from '../db/transaction.ts'
import { HttpError } from '../httpError.ts'
import { makeJoinCode } from './joinCode.ts'

export const CLASS_NOT_FOUND = "Sorry, we can't find a class associated with this code."

// Codes start with 3 random digits; if those keep colliding, switch to 4.
const SHORT_CODE_ATTEMPTS = 5
const MAX_CODE_ATTEMPTS = 10

interface ClassRow {
  id: string
  name: string
  join_code: string
  created_by: string
  created_at: Date
}

interface Person {
  id: string
  name: string
  email: string
}

// Shapes sent to the client; match the types in src/classes/types.ts.
export interface InstructorClass {
  id: string
  name: string
  joinCode: string
  students: Person[]
  invitations: { id: string; email: string; hasAccount: boolean; name: string | null }[]
  pendingRequests: Person[]
}

export interface StudentClass {
  id: string
  name: string
  instructors: string[]
}

/** Inserts the class with a fresh join code, retrying if the code is taken. */
async function insertClass(db: Db, name: string, createdBy: string) {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = makeJoinCode(name, attempt < SHORT_CODE_ATTEMPTS ? 3 : 4)
    const { rows } = await db.query<ClassRow>(
      `INSERT INTO classes (name, join_code, created_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (join_code) DO NOTHING
       RETURNING *`,
      [name, code, createdBy],
    )
    if (rows[0]) return rows[0]
  }
  throw new Error(`Could not find an unused join code for "${name}".`)
}

/** Creates the class, makes `instructorId` its instructor and invites `emails`. */
export async function createClass(
  db: Db,
  input: { name: string; instructorId: string; emails: string[] },
) {
  const row = await insertClass(db, input.name, input.instructorId)
  await db.query('INSERT INTO class_instructors (class_id, user_id) VALUES ($1, $2)', [
    row.id,
    input.instructorId,
  ])
  await db.query(
    `INSERT INTO class_invitations (class_id, email)
     SELECT $1::uuid, unnest($2::text[])
     ON CONFLICT DO NOTHING`,
    [row.id, input.emails],
  )
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*) FROM users WHERE role = 'student' AND lower(email) = ANY($1::text[])`,
    [input.emails],
  )
  return {
    class: { id: row.id, name: row.name, joinCode: row.join_code },
    invited: input.emails.length,
    withAccounts: Number(rows[0].count),
  }
}

export async function findClassByCode(db: Db, code: string) {
  const { rows } = await db.query<ClassRow>('SELECT * FROM classes WHERE join_code = $1', [code])
  return rows[0] ?? null
}

export async function isInstructorOf(classId: string, userId: string) {
  const { rowCount } = await pool.query(
    'SELECT 1 FROM class_instructors WHERE class_id = $1 AND user_id = $2',
    [classId, userId],
  )
  return rowCount === 1
}

/** Every class the instructor teaches, with its roster, invitations and requests. */
export async function listInstructorClasses(instructorId: string): Promise<InstructorClass[]> {
  const { rows: classes } = await pool.query<ClassRow>(
    `SELECT c.* FROM classes c
     JOIN class_instructors ci ON ci.class_id = c.id
     WHERE ci.user_id = $1
     ORDER BY c.created_at DESC`,
    [instructorId],
  )
  const ids = classes.map((c) => c.id)

  const [students, invitations, requests] = await Promise.all([
    pool.query<Person & { class_id: string }>(
      `SELECT cs.class_id, u.id, u.name, u.email
       FROM class_students cs JOIN users u ON u.id = cs.user_id
       WHERE cs.class_id = ANY($1::uuid[])
       ORDER BY u.name`,
      [ids],
    ),
    pool.query<{ class_id: string; id: string; email: string; name: string | null }>(
      `SELECT i.class_id, i.id, i.email, u.name
       FROM class_invitations i
       LEFT JOIN users u ON lower(u.email) = lower(i.email) AND u.role = 'student'
       WHERE i.class_id = ANY($1::uuid[])
       ORDER BY i.created_at, i.email`,
      [ids],
    ),
    pool.query<Person & { class_id: string }>(
      `SELECT r.class_id, u.id, u.name, u.email
       FROM class_join_requests r JOIN users u ON u.id = r.user_id
       WHERE r.class_id = ANY($1::uuid[]) AND r.status = 'pending'
       ORDER BY r.created_at`,
      [ids],
    ),
  ])

  return classes.map((c) => ({
    id: c.id,
    name: c.name,
    joinCode: c.join_code,
    students: students.rows
      .filter((s) => s.class_id === c.id)
      .map(({ id, name, email }) => ({ id, name, email })),
    invitations: invitations.rows
      .filter((i) => i.class_id === c.id)
      .map(({ id, email, name }) => ({ id, email, name, hasAccount: name !== null })),
    pendingRequests: requests.rows
      .filter((r) => r.class_id === c.id)
      .map(({ id, name, email }) => ({ id, name, email })),
  }))
}

/** Classes the student is enrolled in. */
export async function listStudentClasses(studentId: string): Promise<StudentClass[]> {
  const { rows } = await pool.query<StudentClass>(
    `SELECT c.id, c.name,
            coalesce(array_agg(u.name ORDER BY u.name) FILTER (WHERE u.id IS NOT NULL), '{}')
              AS instructors
     FROM class_students cs
     JOIN classes c ON c.id = cs.class_id
     LEFT JOIN class_instructors ci ON ci.class_id = c.id
     LEFT JOIN users u ON u.id = ci.user_id
     WHERE cs.user_id = $1
     GROUP BY c.id
     ORDER BY c.name`,
    [studentId],
  )
  return rows
}

/**
 * A student entering a join code. If they were already invited to the class
 * they're enrolled straight away; otherwise the instructor has to admit them.
 */
export async function joinClass(
  db: Db,
  cls: { id: string; name: string },
  student: { id: string; email: string },
) {
  const enrolled = await db.query(
    'SELECT 1 FROM class_students WHERE class_id = $1 AND user_id = $2',
    [cls.id, student.id],
  )
  if (enrolled.rowCount) throw new HttpError(409, `You're already in ${cls.name}.`)

  const invited = await db.query(
    'DELETE FROM class_invitations WHERE class_id = $1 AND lower(email) = lower($2)',
    [cls.id, student.email],
  )
  if (invited.rowCount) {
    await enroll(db, cls.id, student.id)
    return { status: 'enrolled' as const, className: cls.name }
  }

  // A student who was denied before can ask again.
  await db.query(
    `INSERT INTO class_join_requests (class_id, user_id) VALUES ($1, $2)
     ON CONFLICT (class_id, user_id) DO UPDATE SET status = 'pending', created_at = now()`,
    [cls.id, student.id],
  )
  return { status: 'requested' as const, className: cls.name }
}

async function enroll(db: Db, classId: string, studentId: string) {
  await db.query(
    'INSERT INTO class_students (class_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [classId, studentId],
  )
  await db.query('DELETE FROM class_join_requests WHERE class_id = $1 AND user_id = $2', [
    classId,
    studentId,
  ])
}

/** Moves pending requesters into the class. Returns how many were admitted. */
export async function admitRequests(classId: string, studentIds: string[]) {
  const { rowCount } = await pool.query(
    `WITH admitted AS (
       DELETE FROM class_join_requests
       WHERE class_id = $1 AND user_id = ANY($2::uuid[]) AND status = 'pending'
       RETURNING user_id
     )
     INSERT INTO class_students (class_id, user_id)
     SELECT $1::uuid, user_id FROM admitted
     ON CONFLICT DO NOTHING`,
    [classId, studentIds],
  )
  return rowCount ?? 0
}

/** Marks pending requests denied, which hides them from the instructor. */
export async function denyRequests(classId: string, studentIds: string[]) {
  const { rowCount } = await pool.query(
    `UPDATE class_join_requests SET status = 'denied'
     WHERE class_id = $1 AND user_id = ANY($2::uuid[]) AND status = 'pending'`,
    [classId, studentIds],
  )
  return rowCount ?? 0
}

/** What a student needs to see on their dashboard besides their classes. */
export async function getStudentInbox(student: { id: string; email: string }) {
  const [invitations, requests] = await Promise.all([
    pool.query<{ id: string; className: string }>(
      `SELECT i.id, c.name AS "className"
       FROM class_invitations i JOIN classes c ON c.id = i.class_id
       WHERE lower(i.email) = lower($1)
         AND NOT EXISTS (
           SELECT 1 FROM class_students cs WHERE cs.class_id = i.class_id AND cs.user_id = $2
         )
       ORDER BY i.created_at`,
      [student.email, student.id],
    ),
    pool.query<{ classId: string; className: string; status: 'pending' | 'denied' }>(
      `SELECT r.class_id AS "classId", c.name AS "className", r.status
       FROM class_join_requests r JOIN classes c ON c.id = r.class_id
       WHERE r.user_id = $1
       ORDER BY r.created_at`,
      [student.id],
    ),
  ])
  const pick = (status: 'pending' | 'denied') =>
    requests.rows
      .filter((r) => r.status === status)
      .map(({ classId, className }) => ({ classId, className }))

  return {
    invitations: invitations.rows,
    pendingRequests: pick('pending'),
    denials: pick('denied'),
  }
}

/** Accepts the student's invitation. Returns false if it isn't theirs or doesn't exist. */
export async function acceptInvitation(
  db: Db,
  invitationId: string,
  student: { id: string; email: string },
) {
  const { rows } = await db.query<{ class_id: string }>(
    'DELETE FROM class_invitations WHERE id = $1 AND lower(email) = lower($2) RETURNING class_id',
    [invitationId, student.email],
  )
  if (!rows[0]) return false
  await enroll(db, rows[0].class_id, student.id)
  return true
}

/** Deletes the student's invitation, which also takes it off the instructor's list. */
export async function rejectInvitation(invitationId: string, studentEmail: string) {
  const { rowCount } = await pool.query(
    'DELETE FROM class_invitations WHERE id = $1 AND lower(email) = lower($2)',
    [invitationId, studentEmail],
  )
  return rowCount === 1
}

export async function dismissDenial(classId: string, studentId: string) {
  await pool.query(
    `DELETE FROM class_join_requests
     WHERE class_id = $1 AND user_id = $2 AND status = 'denied'`,
    [classId, studentId],
  )
}
