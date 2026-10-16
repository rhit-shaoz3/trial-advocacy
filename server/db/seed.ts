import bcrypt from 'bcryptjs'
import { isProduction } from '../config.ts'
import { pool } from './pool.ts'

/**
 * Adds demo data for local development. Safe to re-run: existing accounts,
 * courses, and enrollments are left as they are (demo account passwords are
 * reset to the demo password). Log in as the demo instructor to manage the
 * courses, or as any demo student. LAW 540 also gets a draft placeholder case
 * if it has no cases yet.
 */
if (isProduction) throw new Error('Refusing to seed demo data in production.')

const DEMO_PASSWORD = 'demo-password'
const DEMO_INSTRUCTOR = { name: 'Demo Instructor', email: 'demo-instructor@example.com', role: 'instructor' }
const DEMO_STUDENT = { name: 'Demo Student', email: 'demo-student@example.com', role: 'student' }

const COURSES = [
  { code: 'LAW 540', title: 'Trial Advocacy', term: 'Fall 2026', termStart: '2026-09-15', entryCode: 'TRIAL1' },
  { code: 'LAW 612', title: 'Pretrial Litigation', term: 'Fall 2026', termStart: '2026-09-15', entryCode: 'PRETRL' },
  { code: 'LAW 520', title: 'Evidence', term: 'Spring 2026', termStart: '2026-03-25', entryCode: 'EVID26' },
]

/** The course the class below is enrolled in, so there are enough students to pair into teams. */
const CLASS_ENTRY_CODE = 'TRIAL1'

// 30 students; with the demo student (and a real account or two) LAW 540 has
// a full class of about 32, enough for 16 pairs and 8 two-team matchups.
const CLASS_NAMES = [
  'Ava Thompson', 'Benjamin Okafor', 'Chloe Nguyen', 'Daniel Rivera', 'Emma Schultz',
  'Ethan Patel', 'Fatima Hassan', 'Gabriel Moreau', 'Grace Kim', 'Henry Adeyemi',
  'Isabella Rossi', 'Jack Sullivan', 'Jasmine Wright', 'Kai Nakamura', 'Laura Becker',
  'Liam O’Connor', 'Maya Desai', 'Mateo Alvarez', 'Nadia Petrova', 'Noah Fischer',
  'Olivia Chen', 'Omar Haddad', 'Priya Raman', 'Ryan Murphy', 'Sofia Lindqvist',
  'Samuel Brooks', 'Tara Mitchell', 'Victor Lin', 'Wen Zhao', 'Zoe Carter',
]

/** "Liam O’Connor" → "liam.oconnor@example.com" */
function demoEmail(name: string) {
  const local = name
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .trim()
    .split(/\s+/)
    .join('.')
  return `${local}@example.com`
}

/**
 * A placeholder case shell for a fresh database. The real case and its files
 * are confidential, so they are entered through the app, not seeded.
 */
const DEMO_CASE = {
  title: 'Practice case (placeholder)',
  summary: 'A placeholder case to practice pairing students into teams and case worlds.',
}

const CLASS = CLASS_NAMES.map((name) => ({ name, email: demoEmail(name), role: 'student' }))

async function upsertUser(user: { name: string; email: string; role: string }, hash: string) {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (name, email, role, password_hash) VALUES ($1, $2, $3, $4)
     ON CONFLICT ((lower(email))) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING id`,
    [user.name, user.email, user.role, hash],
  )
  return rows[0].id
}

try {
  // One hash for every demo account keeps re-seeding fast.
  const hash = await bcrypt.hash(DEMO_PASSWORD, 11)

  const instructorId = await upsertUser(DEMO_INSTRUCTOR, hash)
  await upsertUser(DEMO_STUDENT, hash)
  console.log(`instructor: ${DEMO_INSTRUCTOR.email} / ${DEMO_PASSWORD}`)
  console.log(`student:    ${DEMO_STUDENT.email} / ${DEMO_PASSWORD}`)
  console.log()

  for (const c of COURSES) {
    await pool.query(
      `INSERT INTO courses (code, title, term, term_start, entry_code, instructor_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (entry_code) DO NOTHING`,
      [c.code, c.title, c.term, c.termStart, c.entryCode, instructorId],
    )
    console.log(`${c.entryCode}  ${c.code} ${c.title} (${c.term})`)
  }

  const { rows } = await pool.query<{ id: string; code: string }>(
    'SELECT id, code FROM courses WHERE entry_code = $1',
    [CLASS_ENTRY_CODE],
  )
  const classCourse = rows[0]
  for (const student of [DEMO_STUDENT, ...CLASS]) {
    const userId = await upsertUser(student, hash)
    // Claims a pending roster row for this email if the instructor already added one.
    await pool.query(
      `INSERT INTO enrollments (course_id, email, user_id, status) VALUES ($1, $2, $3, 'joined')
       ON CONFLICT (course_id, email) DO UPDATE SET user_id = EXCLUDED.user_id, status = 'joined'
         WHERE enrollments.status <> 'joined'`,
      [classCourse.id, student.email, userId],
    )
  }

  // A draft case to pair the class into, only while the course has no cases, so
  // re-seeding never adds one next to the instructor's real cases.
  await pool.query(
    `INSERT INTO cases (course_id, title, summary)
     SELECT $1, $2, $3
     WHERE NOT EXISTS (SELECT 1 FROM cases WHERE course_id = $1)`,
    [classCourse.id, DEMO_CASE.title, DEMO_CASE.summary],
  )

  const { rows: counts } = await pool.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM enrollments WHERE course_id = $1 AND status = 'joined'`,
    [classCourse.id],
  )
  console.log()
  console.log(
    `${CLASS.length} class students (e.g. ${CLASS[0].email}) / ${DEMO_PASSWORD}; ` +
      `${classCourse.code} now has ${counts[0].total} joined students.`,
  )
} finally {
  await pool.end()
}
