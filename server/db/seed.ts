import bcrypt from 'bcryptjs'
import { isProduction } from '../config.ts'
import { pool } from './pool.ts'

/**
 * Adds demo data for local development. Safe to re-run: existing accounts,
 * courses, and enrollments are left as they are (demo account passwords are
 * reset to the demo password). Log in as the demo instructor to manage the
 * courses, or as any demo student. LAW 540 also gets a draft placeholder case
 * with placeholder materials, witnesses, and tasks.
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

/** A placeholder case shell; its facts arrive with the structured fact pattern. */
const DEMO_CASE = {
  title: 'Rivera v. Thrill Park',
  summary:
    'A rollercoaster stalls at the top of its lift hill, and a rider is injured during the ' +
    'evacuation. The rider sues the park for negligence. Placeholder case: the full fact ' +
    'pattern is still to come.',
}

/**
 * Placeholder content for the demo case's workspace, until the real fact
 * pattern arrives. Files are plain text so they open anywhere.
 */
const DEMO_FILES = [
  {
    audience: 'all',
    filename: 'Rivera v. Thrill Park - fact pattern (placeholder).txt',
    description: 'Placeholder fact pattern. Read this first.',
    text: [
      'Rivera v. Thrill Park (placeholder fact pattern)',
      '',
      'On a summer evening, the Cyclone rollercoaster at Thrill Park stalled at the top of its lift',
      'hill. Riders waited about 40 minutes before staff began an evacuation down the maintenance',
      'stairway. During the evacuation, rider Maria Rivera slipped and fractured her wrist. Rivera',
      'sued Thrill Park for negligence. The park says the stall was unforeseeable and that the',
      'evacuation followed its written procedure.',
    ].join('\n'),
  },
  {
    audience: 'all',
    filename: 'Cyclone maintenance log.txt',
    description: 'Ride maintenance entries, March to October.',
    text: [
      'Mar 3: lift chain inspected, OK.',
      'Jun 2: lift motor overheated, reset.',
      'Jun 9: lift motor overheated, reset.',
    ].join('\n'),
  },
  {
    audience: 'plaintiff',
    filename: 'Rivera medical summary.txt',
    description: "From the plaintiff's treating physician.",
    text: 'Distal radius fracture, right wrist. Surgery recommended.',
  },
  {
    audience: 'defense',
    filename: 'Thrill Park incident report.txt',
    description: 'Internal report filed the night of the incident.',
    text: 'Evacuation began 38 minutes after the stall, per procedure 4.2.',
  },
]

const DEMO_WITNESSES = [
  { name: 'Elena Torres', role: 'Ride operator', description: 'Was at the controls when the train stalled.', audience: 'all' },
  { name: 'Marcus Bell', role: 'Rider, eyewitness', description: 'Sat two rows behind the plaintiff.', audience: 'all' },
  { name: 'Dr. Rachel Lin', role: 'Treating physician', description: "Treated the plaintiff's wrist.", audience: 'plaintiff' },
  { name: 'Sam Okoro', role: 'Maintenance supervisor', description: 'Signed off on the June repairs.', audience: 'defense' },
]

const DAY = 24 * 60 * 60 * 1000
const DEMO_TASKS = [
  { title: 'Read the fact pattern', description: 'Note every fact about notice and timing.', dueInDays: 3, audience: 'all' },
  { title: 'Review the maintenance log', description: 'What did the park know before the stall?', dueInDays: 7, audience: 'all' },
  { title: "Outline the treating physician's testimony", description: '', dueInDays: 10, audience: 'plaintiff' },
  { title: "Outline the maintenance supervisor's testimony", description: '', dueInDays: 10, audience: 'defense' },
]

const DEMO_NOTE = "Focus on what the maintenance log shows about notice. Don't overlook the timeline."

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
      `INSERT INTO enrollments (course_id, email, user_id) VALUES ($1, $2, $3)
       ON CONFLICT (course_id, email) DO UPDATE SET user_id = EXCLUDED.user_id
         WHERE enrollments.user_id IS NULL`,
      [classCourse.id, student.email, userId],
    )
  }

  // A draft case to pair the class into. Matched by title so re-seeding doesn't duplicate it.
  await pool.query(
    `INSERT INTO cases (course_id, title, summary)
     SELECT $1, $2, $3
     WHERE NOT EXISTS (SELECT 1 FROM cases WHERE course_id = $1 AND title = $2)`,
    [classCourse.id, DEMO_CASE.title, DEMO_CASE.summary],
  )

  // Workspace content for the demo case, only if it has none yet, so re-seeding
  // never duplicates it or mixes with what an instructor added.
  const { rows: demoCase } = await pool.query<{ id: string; empty: boolean }>(
    `SELECT c.id,
            NOT EXISTS (SELECT 1 FROM case_materials WHERE case_id = c.id)
              AND NOT EXISTS (SELECT 1 FROM case_witnesses WHERE case_id = c.id)
              AND NOT EXISTS (SELECT 1 FROM case_tasks WHERE case_id = c.id) AS empty
     FROM cases c WHERE c.course_id = $1 AND c.title = $2`,
    [classCourse.id, DEMO_CASE.title],
  )
  if (demoCase[0]?.empty) {
    const caseId = demoCase[0].id
    for (const f of DEMO_FILES) {
      const data = Buffer.from(f.text)
      await pool.query(
        `INSERT INTO case_materials
           (case_id, audience, filename, description, content_type, size_bytes, data, uploaded_by)
         VALUES ($1, $2, $3, $4, 'text/plain; charset=utf-8', $5, $6, $7)`,
        [caseId, f.audience, f.filename, f.description, data.length, data, instructorId],
      )
    }
    for (const w of DEMO_WITNESSES) {
      await pool.query(
        'INSERT INTO case_witnesses (case_id, name, role, description, audience) VALUES ($1, $2, $3, $4, $5)',
        [caseId, w.name, w.role, w.description, w.audience],
      )
    }
    for (const t of DEMO_TASKS) {
      await pool.query(
        'INSERT INTO case_tasks (case_id, title, description, due_at, audience) VALUES ($1, $2, $3, $4, $5)',
        [caseId, t.title, t.description, new Date(Date.now() + t.dueInDays * DAY), t.audience],
      )
    }
    await pool.query(`UPDATE cases SET instructor_note = $2 WHERE id = $1 AND instructor_note = ''`, [
      caseId,
      DEMO_NOTE,
    ])
    console.log(`Added placeholder materials, witnesses, and tasks to ${DEMO_CASE.title}.`)
  }

  const { rows: counts } = await pool.query<{ total: number }>(
    'SELECT count(*)::int AS total FROM enrollments WHERE course_id = $1 AND user_id IS NOT NULL',
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
