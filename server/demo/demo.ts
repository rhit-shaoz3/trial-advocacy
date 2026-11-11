import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { SessionData } from 'express-session'
import { copyCase } from '../courses/caseCopy.ts'
import { listStorageKeys, removeStoredFiles } from '../courses/caseContent.ts'
import { CASE_PHASES } from '../courses/cases.ts'
import { pool } from '../db/pool.ts'
import { HttpError } from '../httpError.ts'
import { DEPOSITION, scriptedTurn } from './script.ts'

// The demo: logging in as demo@demo.com gives a session that can switch
// between the course's instructor and one of its students (two accounts,
// since a user is one or the other). They share a ready-made Thrillville case
// world, rebuilt from a template on reset: the template is a copy of a
// Thrillville case, held in a course no one logs in to. See script.ts for the
// subpoena and deposition the demo walks through.

export const DEMO_EMAIL = 'demo@demo.com'
export const DEMO_STUDENT_EMAIL = 'demo.student@demo.com'
const TEMPLATE_OWNER_EMAIL = 'demo-template@demo.local'
const OPPONENT_EMAIL = 'sam.ortiz@demo.com'
const DEMO_ENTRY_CODE = 'DEMO01'
const TEMPLATE_ENTRY_CODE = 'DEMOTP'
const DEMO_CASE_TITLE = 'Crest v. Thrillville'

/** The guided tours, marked as seen so they don't start over the phase intros. */
const TOUR_KEYS = [
  'student-home', 'instructor-home', 'student-course', 'instructor-course', 'student-calendar',
  'instructor-calendar', 'student-cases', 'instructor-cases', 'instructor-case', 'instructor-review', 'student-case',
]

export type DemoRole = 'instructor' | 'student'

// Shape sent to the client; matches `DemoSession` in src/auth/types.ts.
export interface DemoSession {
  as: DemoRole
  courseId: string | null
  caseId: string | null
}

async function userId(email: string) {
  const { rows } = await pool.query<{ id: string }>('SELECT id FROM users WHERE lower(email) = lower($1)', [email])
  return rows[0]?.id ?? null
}

async function demoCourseId() {
  const { rows } = await pool.query<{ id: string }>('SELECT id FROM courses WHERE entry_code = $1', [DEMO_ENTRY_CODE])
  return rows[0]?.id ?? null
}

async function demoCaseId(courseId: string) {
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM cases WHERE course_id = $1 AND is_demo ORDER BY created_at DESC LIMIT 1',
    [courseId],
  )
  return rows[0]?.id ?? null
}

/** What the demo bar needs, for a demo session; null otherwise. */
export async function demoSession(session: Partial<SessionData>, role: DemoRole): Promise<DemoSession | null> {
  if (!session.demo) return null
  const courseId = await demoCourseId()
  return { as: role, courseId, caseId: courseId ? await demoCaseId(courseId) : null }
}

/** The account a demo session switches to. */
export async function demoAccount(as: DemoRole) {
  const id = await userId(as === 'instructor' ? DEMO_EMAIL : DEMO_STUDENT_EMAIL)
  if (!id) throw new HttpError(409, 'The demo is not set up. Run npm run demo:setup.')
  return id
}

async function upsertUser(name: string, email: string, role: DemoRole, password: string) {
  const hash = await bcrypt.hash(password, 11)
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (name, email, role, password_hash) VALUES ($1, $2, $3, $4)
     ON CONFLICT ((lower(email))) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name
     RETURNING id`,
    [name, email, role, hash],
  )
  return rows[0].id
}

async function upsertCourse(instructorId: string, entryCode: string, code: string, title: string) {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO courses (code, title, term, term_start, entry_code, instructor_id)
     VALUES ($1, $2, 'Fall 2026', '2026-09-15', $3, $4)
     ON CONFLICT (entry_code) DO UPDATE SET instructor_id = EXCLUDED.instructor_id
     RETURNING id`,
    [code, title, entryCode, instructorId],
  )
  return rows[0].id
}

/** Gives the copy's files the audiences the source had (a copy starts them instructor-only). */
async function copyAudiences(fromCaseId: string, toCaseId: string) {
  await pool.query(
    `UPDATE case_materials m SET audience = s.audience
     FROM case_materials s
     WHERE m.case_id = $2 AND s.case_id = $1 AND s.filename = m.filename AND s.source = 'instructor'`,
    [fromCaseId, toCaseId],
  )
}

/** Deletes a case with its stored files. */
async function deleteCase(caseId: string) {
  const keys = await listStorageKeys({ caseId })
  await pool.query('DELETE FROM cases WHERE id = $1', [caseId])
  await removeStoredFiles(keys)
}

/**
 * Sets up the demo accounts and courses, and makes the template from
 * `sourceCaseId` (a Thrillville case), replacing an older template. Then
 * resets the demo case world. Returns the demo login's password.
 */
export async function setupDemo(sourceCaseId: string) {
  const password = 'password'
  const instructorId = await upsertUser('Demo Instructor', DEMO_EMAIL, 'instructor', password)
  const studentId = await upsertUser('Jordan Lee', DEMO_STUDENT_EMAIL, 'student', randomBytes(24).toString('hex'))
  const opponentId = await upsertUser('Sam Ortiz', OPPONENT_EMAIL, 'student', randomBytes(24).toString('hex'))
  const ownerId = await upsertUser('Demo template', TEMPLATE_OWNER_EMAIL, 'instructor', randomBytes(24).toString('hex'))

  const courseId = await upsertCourse(instructorId, DEMO_ENTRY_CODE, 'LAW 540', 'Trial Advocacy (demo)')
  await pool.query(
    `INSERT INTO enrollments (course_id, email, user_id) VALUES ($1, $2, $3), ($1, $4, $5)
     ON CONFLICT (course_id, email) DO UPDATE SET user_id = EXCLUDED.user_id`,
    [courseId, DEMO_STUDENT_EMAIL, studentId, OPPONENT_EMAIL, opponentId],
  )

  const templateCourseId = await upsertCourse(ownerId, TEMPLATE_ENTRY_CODE, 'DEMO', 'Demo template')
  const { rows: old } = await pool.query<{ id: string }>('SELECT id FROM cases WHERE course_id = $1', [templateCourseId])
  for (const c of old) await deleteCase(c.id)
  const templateId = await copyCase(sourceCaseId, templateCourseId, ownerId, { includeTasks: true, title: DEMO_CASE_TITLE })
  await copyAudiences(sourceCaseId, templateId)

  await resetDemo()
  return password
}

/**
 * Rebuilds the demo case world from the template: the case in Introduction
 * (so every phase intro plays again), Team 1 (plaintiff, an opponent no one
 * logs in as) against Team 2 (defense, the demo student) in World A, with no
 * subpoenas or interviews yet.
 */
export async function resetDemo() {
  const instructorId = await userId(DEMO_EMAIL)
  const studentId = await userId(DEMO_STUDENT_EMAIL)
  const courseId = await demoCourseId()
  const { rows: templates } = await pool.query<{ id: string }>(
    'SELECT c.id FROM cases c JOIN courses co ON co.id = c.course_id WHERE co.entry_code = $1 ORDER BY c.created_at DESC LIMIT 1',
    [TEMPLATE_ENTRY_CODE],
  )
  if (!instructorId || !studentId || !courseId || !templates[0]) {
    throw new HttpError(409, 'The demo is not set up. Run npm run demo:setup.')
  }

  const { rows: old } = await pool.query<{ id: string }>('SELECT id FROM cases WHERE course_id = $1', [courseId])
  for (const c of old) await deleteCase(c.id)
  const caseId = await copyCase(templates[0].id, courseId, instructorId, { includeTasks: true })
  await copyAudiences(templates[0].id, caseId)

  await pool.query(
    `UPDATE cases SET status = 'active', phase = 'introduction', phase_entered_at = NULL, worlds_locked_at = NULL,
       setup_step = 'tasks', setup_completed_at = now(), copy_setup = false, copied_from_title = NULL,
       copied_from_name = NULL, review_mode = 'all', investigator_enabled = true, is_demo = true
     WHERE id = $1`,
    [caseId],
  )
  await pool.query(
    `UPDATE information_exchange SET setup_completed_at = now(), subpoenas_enabled = true, subpoena_ai_feedback = true
     WHERE case_id = $1`,
    [caseId],
  )

  const teams: string[] = []
  for (const [number, email] of [[1, OPPONENT_EMAIL], [2, DEMO_STUDENT_EMAIL]] as const) {
    const { rows } = await pool.query<{ id: string }>('INSERT INTO teams (case_id, number) VALUES ($1, $2) RETURNING id', [
      caseId,
      number,
    ])
    await pool.query('INSERT INTO team_members (team_id, case_id, course_id, email) VALUES ($1, $2, $3, $4)', [
      rows[0].id,
      caseId,
      courseId,
      email,
    ])
    teams.push(rows[0].id)
  }
  const { rows: world } = await pool.query<{ id: string }>('INSERT INTO matchups (case_id, number) VALUES ($1, 1) RETURNING id', [caseId])
  await pool.query(
    `INSERT INTO matchup_teams (matchup_id, case_id, team_id, side) VALUES ($1, $2, $3, 'plaintiff'), ($1, $2, $4, 'defense')`,
    [world[0].id, caseId, teams[0], teams[1]],
  )

  // Every intro plays again; the guided tours stay out of the way.
  const seen = Object.fromEntries([...TOUR_KEYS, ...CASE_PHASES.map((p) => `phase:${caseId}:${p}`)].map((k) => [k, new Date()]))
  await pool.query('UPDATE users SET tours_seen = $2 WHERE id = ANY($1)', [[instructorId, studentId], JSON.stringify(seen)])
  return { courseId, caseId }
}

async function interviewIsDemo(interviewId: string) {
  const { rows } = await pool.query<{ demo: boolean }>(
    `SELECT c.is_demo AS demo FROM interviews i JOIN case_witnesses w ON w.id = i.witness_id JOIN cases c ON c.id = w.case_id
     WHERE i.id = $1`,
    [interviewId],
  )
  return rows[0]?.demo ?? false
}

/** The witness's scripted reply to a question asked in the demo case, in `ai.askWitness`'s shape; null to ask the AI. */
export async function demoReply(caseId: string, question: string) {
  const turn = scriptedTurn(question)
  if (!turn) return null
  const { rows } = await pool.query<{ demo: boolean }>('SELECT is_demo AS demo FROM cases WHERE id = $1', [caseId])
  if (!rows[0]?.demo) return null
  const [speaker, ...text] = (turn.objection ?? '').split(': ')
  return {
    reply: turn.objection ? `${turn.objection}\n\n${turn.answer}` : turn.answer,
    objection: turn.objection ? { speaker, text: text.join(': ') } : null,
    answer: turn.answer,
    model: 'demo-script',
  }
}

/**
 * Before a demo interview goes for review, adds the scripted questions it
 * didn't get to, so the instructor reviews the whole deposition.
 */
export async function finishDemoInterview(interviewId: string) {
  if (!(await interviewIsDemo(interviewId))) return
  const { rows } = await pool.query<{ question: string; askedBy: string | null }>(
    'SELECT question, asked_by AS "askedBy" FROM interview_turns WHERE interview_id = $1 ORDER BY position',
    [interviewId],
  )
  const asked = new Set(rows.map((r) => r.question.trim()))
  const askedBy = rows.at(-1)?.askedBy ?? null
  let position = rows.length
  for (const turn of DEPOSITION) {
    if (asked.has(turn.question)) continue
    await pool.query(
      `INSERT INTO interview_turns (interview_id, position, question, reply, objection, answer, asked_by, model)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'demo-script')`,
      [
        interviewId,
        position++,
        turn.question,
        turn.objection ? `${turn.objection}\n\n${turn.answer}` : turn.answer,
        turn.objection ?? null,
        turn.answer,
        askedBy,
      ],
    )
  }
}
