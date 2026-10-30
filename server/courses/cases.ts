import { pool } from '../db/pool.ts'

export const CASE_STATUSES = ['draft', 'active', 'closed'] as const
export type CaseStatus = (typeof CASE_STATUSES)[number]

/** In order. Every case starts in introduction; the instructor moves it on (or back). */
export const CASE_PHASES = ['introduction', 'information_exchange', 'investigate', 'deposition'] as const
export type CasePhase = (typeof CASE_PHASES)[number]

/**
 * A case's phases: there's no information exchange phase until its setup is
 * finished, and no investigate phase without a background investigator.
 */
export const casePhases = (investigatorEnabled: boolean, exchangeReady: boolean): CasePhase[] =>
  CASE_PHASES.filter(
    (p) => (p !== 'investigate' || investigatorEnabled) && (p !== 'information_exchange' || exchangeReady),
  )

/** What every case's background investigator is called until the instructor renames him. */
export const DEFAULT_INVESTIGATOR_NAME = 'John Hastings'

/** The case's background investigator, the same for every team. */
export interface InvestigatorSettings {
  enabled: boolean
  name: string
  /** The instructor's extra instructions, added to his prompt. Instructors only. */
  instructions: string
}

/** The guided setup's steps, in order; a case remembers the furthest one reached. */
/**
 * How the instructor reviews the case. all: every new fact, file, and subpoena
 * response waits for them. lite: the AI's calls stand at once, for the team's
 * case world only, and students flag what they think is wrong.
 */
export const REVIEW_MODES = ['all', 'lite'] as const
export type ReviewMode = (typeof REVIEW_MODES)[number]

export const SETUP_STEPS = ['details', 'facts', 'files', 'teams', 'worlds', 'witnesses', 'investigator', 'tasks'] as const
export type SetupStep = (typeof SETUP_STEPS)[number]

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
  /** The parties' names; empty when the instructor hasn't named them. */
  parties: CaseParties
  /** Instructors and AI witnesses only; never sent to students. */
  importantFacts: ImportantFacts
  /** The furthest step of the guided setup the instructor has reached. */
  setupStep: SetupStep
  /** When the instructor finished the guided setup; null until then. */
  setupCompletedAt: Date | null
  investigator: InvestigatorSettings
  reviewMode: ReviewMode
  /** Whether the information exchange setup is finished (so students see it, and the case has its phase). */
  exchangeReady: boolean
  /** A copy whose guided setup is just its teams and worlds, until finished. */
  copySetup: boolean
  /** The case it was copied from, and whose it was; null for a case made from scratch. */
  copiedFrom: { title: string; owner: string | null } | null
  createdAt: Date
  updatedAt: Date
}

export interface CaseParties {
  plaintiff: string
  defendant: string
}

/** The parties named by an "X v. Y" title, or empty names. */
export function partiesFromTitle(title: string): CaseParties {
  const [plaintiff, defendant] = title.split(/\s+v\.?\s+/i)
  return plaintiff?.trim() && defendant?.trim()
    ? { plaintiff: plaintiff.trim(), defendant: defendant.trim() }
    : { plaintiff: '', defendant: '' }
}

/** The editable fields, already validated. Without `importantFacts` or `parties`, an edit keeps the current ones. */
export interface CaseFields {
  title: string
  summary: string
  status: CaseStatus
  importantFacts?: ImportantFacts
  parties?: CaseParties
}

const CASE_COLUMNS = `id, title, summary, status, phase, instructor_note AS "instructorNote",
  to_char(in_world_date, 'YYYY-MM-DD') AS "inWorldDate", disputed_issues AS "disputedIssues",
  json_build_object('plaintiff', plaintiff_name, 'defendant', defendant_name) AS parties,
  json_build_object('plaintiff', plaintiff_key_facts, 'defense', defense_key_facts) AS "importantFacts",
  setup_step AS "setupStep", setup_completed_at AS "setupCompletedAt",
  json_build_object('enabled', investigator_enabled, 'name', investigator_name,
                    'instructions', investigator_instructions) AS investigator,
  review_mode AS "reviewMode",
  EXISTS (SELECT 1 FROM information_exchange ie
          WHERE ie.case_id = cases.id AND ie.setup_completed_at IS NOT NULL) AS "exchangeReady",
  copy_setup AS "copySetup",
  CASE WHEN copied_from_title IS NULL THEN NULL
       ELSE json_build_object('title', copied_from_title, 'owner', copied_from_name) END AS "copiedFrom",
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
    `INSERT INTO cases (course_id, title, summary, status, plaintiff_key_facts, defense_key_facts, plaintiff_name, defendant_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${CASE_COLUMNS}`,
    [
      courseId,
      fields.title,
      fields.summary,
      fields.status,
      fields.importantFacts?.plaintiff ?? [],
      fields.importantFacts?.defense ?? [],
      // Unnamed, they come from an "X v. Y" title.
      (fields.parties ?? partiesFromTitle(fields.title)).plaintiff,
      (fields.parties ?? partiesFromTitle(fields.title)).defendant,
    ],
  )
  return rows[0]
}

/** Returns null if there was no such case. */
export async function updateCase(courseId: string, id: string, fields: CaseFields) {
  const { rows } = await pool.query<CourseCase>(
    `UPDATE cases SET title = $3, summary = $4, status = $5, plaintiff_key_facts = coalesce($6, plaintiff_key_facts),
       defense_key_facts = coalesce($7, defense_key_facts), plaintiff_name = coalesce($8, plaintiff_name),
       defendant_name = coalesce($9, defendant_name), updated_at = now()
     WHERE course_id = $1 AND id = $2
     RETURNING ${CASE_COLUMNS}`,
    [
      courseId,
      id,
      fields.title,
      fields.summary,
      fields.status,
      fields.importantFacts?.plaintiff ?? null,
      fields.importantFacts?.defense ?? null,
      fields.parties?.plaintiff ?? null,
      fields.parties?.defendant ?? null,
    ],
  )
  return rows[0] ?? null
}

/** Records that the guided setup reached `step`; it only ever moves forward. */
export async function reachSetupStep(courseId: string, id: string, step: SetupStep) {
  const { rows } = await pool.query<CourseCase>(
    `UPDATE cases SET setup_step = CASE
         WHEN array_position($4::text[], $3) > array_position($4::text[], setup_step) THEN $3 ELSE setup_step END
     WHERE course_id = $1 AND id = $2
     RETURNING ${CASE_COLUMNS}`,
    [courseId, id, step, SETUP_STEPS],
  )
  return rows[0] ?? null
}

/** Finishes the guided setup (once; finishing again keeps the first time); a copy's too. */
export async function completeSetup(courseId: string, id: string) {
  const { rows } = await pool.query<CourseCase>(
    `UPDATE cases SET setup_completed_at = coalesce(setup_completed_at, now()), copy_setup = false
     WHERE course_id = $1 AND id = $2
     RETURNING ${CASE_COLUMNS}`,
    [courseId, id],
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

/** Saves the case's background investigator settings. Returns null if there was no such case. */
export async function setInvestigator(courseId: string, id: string, settings: InvestigatorSettings) {
  const { rows } = await pool.query<CourseCase>(
    `UPDATE cases SET investigator_enabled = $3, investigator_name = $4, investigator_instructions = $5,
       updated_at = now()
     WHERE course_id = $1 AND id = $2
     RETURNING ${CASE_COLUMNS}`,
    [courseId, id, settings.enabled, settings.name, settings.instructions],
  )
  return rows[0] ?? null
}

/** Sets how the instructor reviews the case. Returns null if there was no such case. */
export async function setReviewMode(courseId: string, id: string, mode: ReviewMode) {
  const { rows } = await pool.query<CourseCase>(
    `UPDATE cases SET review_mode = $3, updated_at = now()
     WHERE course_id = $1 AND id = $2
     RETURNING ${CASE_COLUMNS}`,
    [courseId, id, mode],
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
