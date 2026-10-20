import { pool } from '../db/pool.ts'

export const CASE_STATUSES = ['draft', 'active', 'closed'] as const
export type CaseStatus = (typeof CASE_STATUSES)[number]

/** In order. Every case starts in subpoena; the instructor moves it on (or back). */
export const CASE_PHASES = ['subpoena', 'investigate', 'deposition'] as const
export type CasePhase = (typeof CASE_PHASES)[number]

/** The most important facts for each side; the AI witnesses never contradict them. */
export interface ImportantFacts {
  plaintiff: string[]
  defense: string[]
}

// Shape sent to the client; matches `CourseCase` in src/courses/types.ts.
export interface CourseCase {
  id: string
  title: string
  summary: string
  status: CaseStatus
  /** Shared by all of the case's worlds. */
  phase: CasePhase
  /** Shown on every student's case dashboard. */
  instructorNote: string
  /** "Today" inside the case for its AI witnesses, YYYY-MM-DD; null means the real date. */
  inWorldDate: string | null
  /** Issues the AI witnesses must leave disputed (one per line). */
  disputedIssues: string
  /** Instructors and AI witnesses only; never sent to students. */
  importantFacts: ImportantFacts
  createdAt: Date
  updatedAt: Date
}

/** The editable fields, already validated. */
export interface CaseFields {
  title: string
  summary: string
  status: CaseStatus
  importantFacts: ImportantFacts
}

const CASE_COLUMNS = `id, title, summary, status, phase, instructor_note AS "instructorNote",
  to_char(in_world_date, 'YYYY-MM-DD') AS "inWorldDate", disputed_issues AS "disputedIssues",
  json_build_object('plaintiff', plaintiff_key_facts, 'defense', defense_key_facts) AS "importantFacts",
  created_at AS "createdAt", updated_at AS "updatedAt"`

/** Oldest first, so the term's first case stays on top. */
export async function listCases(courseId: string) {
  const { rows } = await pool.query<CourseCase>(
    `SELECT ${CASE_COLUMNS} FROM cases WHERE course_id = $1 ORDER BY created_at, title`,
    [courseId],
  )
  return rows
}

export async function findCase(courseId: string, id: string) {
  const { rows } = await pool.query<CourseCase>(
    `SELECT ${CASE_COLUMNS} FROM cases WHERE course_id = $1 AND id = $2`,
    [courseId, id],
  )
  return rows[0] ?? null
}

export async function createCase(courseId: string, fields: CaseFields) {
  const { rows } = await pool.query<CourseCase>(
    `INSERT INTO cases (course_id, title, summary, status, plaintiff_key_facts, defense_key_facts)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${CASE_COLUMNS}`,
    [
      courseId,
      fields.title,
      fields.summary,
      fields.status,
      fields.importantFacts.plaintiff,
      fields.importantFacts.defense,
    ],
  )
  return rows[0]
}

/** Returns null if there was no such case. */
export async function updateCase(courseId: string, id: string, fields: CaseFields) {
  const { rows } = await pool.query<CourseCase>(
    `UPDATE cases SET title = $3, summary = $4, status = $5, plaintiff_key_facts = $6,
       defense_key_facts = $7, updated_at = now()
     WHERE course_id = $1 AND id = $2
     RETURNING ${CASE_COLUMNS}`,
    [
      courseId,
      id,
      fields.title,
      fields.summary,
      fields.status,
      fields.importantFacts.plaintiff,
      fields.importantFacts.defense,
    ],
  )
  return rows[0] ?? null
}

/** Moves every world in the case to `phase`. Returns null if there was no such case. */
export async function setCasePhase(courseId: string, id: string, phase: CasePhase) {
  const { rows } = await pool.query<CourseCase>(
    `UPDATE cases SET phase = $3, updated_at = now()
     WHERE course_id = $1 AND id = $2
     RETURNING ${CASE_COLUMNS}`,
    [courseId, id, phase],
  )
  return rows[0] ?? null
}

/** Returns false if there was no such case. */
export async function deleteCase(courseId: string, id: string) {
  const { rowCount } = await pool.query('DELETE FROM cases WHERE course_id = $1 AND id = $2', [
    courseId,
    id,
  ])
  return rowCount === 1
}
