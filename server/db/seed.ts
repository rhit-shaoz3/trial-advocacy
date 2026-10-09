import bcrypt from 'bcryptjs'
import { isProduction } from '../config.ts'
import { pool } from './pool.ts'

/**
 * Adds demo data for local development. Safe to re-run. Log in as the demo
 * instructor to manage the courses, or as the demo student and join them with
 * the entry codes printed below.
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

async function upsertUser(user: { name: string; email: string; role: string }) {
  const hash = await bcrypt.hash(DEMO_PASSWORD, 11)
  await pool.query(
    `INSERT INTO users (name, email, role, password_hash) VALUES ($1, $2, $3, $4)
     ON CONFLICT ((lower(email))) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [user.name, user.email, user.role, hash],
  )
  const { rows } = await pool.query<{ id: string }>('SELECT id FROM users WHERE lower(email) = $1', [
    user.email,
  ])
  console.log(`${user.role}: ${user.email} / ${DEMO_PASSWORD}`)
  return rows[0].id
}

try {
  const instructorId = await upsertUser(DEMO_INSTRUCTOR)
  await upsertUser(DEMO_STUDENT)
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
} finally {
  await pool.end()
}
