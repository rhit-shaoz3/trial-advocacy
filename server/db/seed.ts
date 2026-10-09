import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { isProduction } from '../config.ts'
import { pool } from './pool.ts'

/**
 * Adds demo data for local development. Safe to re-run. Log in as the demo
 * student below, then join courses from the dashboard with the entry codes
 * printed below.
 */
const DEMO_STUDENT = { email: 'demo-student@example.com', password: 'demo-password' }
if (isProduction) throw new Error('Refusing to seed demo data in production.')

const COURSES = [
  { code: 'LAW 540', title: 'Trial Advocacy', term: 'Fall 2026', termStart: '2026-09-22', entryCode: 'TRIAL1' },
  { code: 'LAW 612', title: 'Pretrial Litigation', term: 'Fall 2026', termStart: '2026-09-22', entryCode: 'PRETRL' },
  { code: 'LAW 520', title: 'Evidence', term: 'Spring 2026', termStart: '2026-03-30', entryCode: 'EVID26' },
]

try {
  // Nobody can log in as the demo instructor: its password is random and discarded.
  const hash = await bcrypt.hash(randomBytes(32).toString('hex'), 11)
  await pool.query(
    `INSERT INTO users (name, email, role, password_hash)
     VALUES ('Demo Instructor', 'demo-instructor@example.com', 'instructor', $1)
     ON CONFLICT ((lower(email))) DO NOTHING`,
    [hash],
  )
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE lower(email) = 'demo-instructor@example.com'`,
  )
  const instructorId = rows[0].id

  await pool.query(
    `INSERT INTO users (name, email, role, password_hash)
     VALUES ('Demo Student', $1, 'student', $2)
     ON CONFLICT ((lower(email))) DO NOTHING`,
    [DEMO_STUDENT.email, await bcrypt.hash(DEMO_STUDENT.password, 11)],
  )
  console.log(`Demo student: ${DEMO_STUDENT.email} / ${DEMO_STUDENT.password}\n`)

  for (const c of COURSES) {
    await pool.query(
      `INSERT INTO courses (code, title, term, term_start, entry_code, instructor_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (entry_code) DO NOTHING`,
      [c.code, c.title, c.term, c.termStart, c.entryCode, instructorId],
    )
    console.log(`${c.entryCode}  ${c.code} ${c.title} (${c.term})`)
  }
} finally {
  await pool.end()
}
