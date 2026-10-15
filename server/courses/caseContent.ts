import { pool } from '../db/pool.ts'
import type { Side } from './matchups.ts'

// What the instructor provides for a case: the case file (the pieces of the
// fact pattern: documents, images, audio, video), witnesses, tasks, and a note. Each item has an `audience`: everyone in the
// case, or only the teams on one side.

export const AUDIENCES = ['all', 'plaintiff', 'defense'] as const
export type Audience = (typeof AUDIENCES)[number]

/** The audiences someone on `side` can see; with no side yet, only shared items. */
export const visibleTo = (side: Side | null): Audience[] => (side ? ['all', side] : ['all'])

// Shapes sent to the client; match `CaseMaterial`, `Witness`, and `CaseTask` in src/courses/types.ts.
export interface CaseMaterial {
  id: string
  audience: Audience
  filename: string
  description: string
  contentType: string
  sizeBytes: number
  uploadedAt: Date
}

export interface Witness {
  id: string
  name: string
  role: string
  description: string
  audience: Audience
}

export interface CaseTask {
  id: string
  title: string
  description: string
  dueAt: Date | null
  audience: Audience
}

// Materials

const MATERIAL_COLUMNS = `id, audience, filename, description, content_type AS "contentType",
  size_bytes AS "sizeBytes", uploaded_at AS "uploadedAt"`

/** In upload order. */
export async function listMaterials(caseId: string, audiences: readonly Audience[] = AUDIENCES) {
  const { rows } = await pool.query<CaseMaterial>(
    `SELECT ${MATERIAL_COLUMNS} FROM case_materials
     WHERE case_id = $1 AND audience = ANY($2)
     ORDER BY uploaded_at, filename`,
    [caseId, audiences],
  )
  return rows
}

export async function createMaterial(input: {
  caseId: string
  audience: Audience
  filename: string
  description: string
  contentType: string
  data: Buffer
  uploadedBy: string
}) {
  const { rows } = await pool.query<CaseMaterial>(
    `INSERT INTO case_materials
       (case_id, audience, filename, description, content_type, size_bytes, data, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${MATERIAL_COLUMNS}`,
    [
      input.caseId,
      input.audience,
      input.filename,
      input.description,
      input.contentType,
      input.data.length,
      input.data,
      input.uploadedBy,
    ],
  )
  return rows[0]
}

/** Returns null if there was no such material. */
export async function updateMaterial(
  caseId: string,
  id: string,
  fields: { audience: Audience; description: string },
) {
  const { rows } = await pool.query<CaseMaterial>(
    `UPDATE case_materials SET audience = $3, description = $4
     WHERE case_id = $1 AND id = $2
     RETURNING ${MATERIAL_COLUMNS}`,
    [caseId, id, fields.audience, fields.description],
  )
  return rows[0] ?? null
}

export async function deleteMaterial(caseId: string, id: string) {
  const { rowCount } = await pool.query('DELETE FROM case_materials WHERE case_id = $1 AND id = $2', [
    caseId,
    id,
  ])
  return rowCount === 1
}

/** Includes the file contents; null unless the material exists and is visible to `audiences`. */
export async function findMaterialFile(caseId: string, id: string, audiences: readonly Audience[] = AUDIENCES) {
  const { rows } = await pool.query<{ filename: string; contentType: string; data: Buffer }>(
    `SELECT filename, content_type AS "contentType", data FROM case_materials
     WHERE case_id = $1 AND id = $2 AND audience = ANY($3)`,
    [caseId, id, audiences],
  )
  return rows[0] ?? null
}

// Witnesses

const WITNESS_COLUMNS = 'id, name, role, description, audience'

export async function listWitnesses(caseId: string, audiences: readonly Audience[] = AUDIENCES) {
  const { rows } = await pool.query<Witness>(
    `SELECT ${WITNESS_COLUMNS} FROM case_witnesses
     WHERE case_id = $1 AND audience = ANY($2)
     ORDER BY created_at, name`,
    [caseId, audiences],
  )
  return rows
}

export type WitnessFields = Omit<Witness, 'id'>

export async function createWitness(caseId: string, fields: WitnessFields) {
  const { rows } = await pool.query<Witness>(
    `INSERT INTO case_witnesses (case_id, name, role, description, audience)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${WITNESS_COLUMNS}`,
    [caseId, fields.name, fields.role, fields.description, fields.audience],
  )
  return rows[0]
}

export async function updateWitness(caseId: string, id: string, fields: WitnessFields) {
  const { rows } = await pool.query<Witness>(
    `UPDATE case_witnesses SET name = $3, role = $4, description = $5, audience = $6
     WHERE case_id = $1 AND id = $2
     RETURNING ${WITNESS_COLUMNS}`,
    [caseId, id, fields.name, fields.role, fields.description, fields.audience],
  )
  return rows[0] ?? null
}

export async function deleteWitness(caseId: string, id: string) {
  const { rowCount } = await pool.query('DELETE FROM case_witnesses WHERE case_id = $1 AND id = $2', [
    caseId,
    id,
  ])
  return rowCount === 1
}

// Tasks

const TASK_COLUMNS = 'id, title, description, due_at AS "dueAt", audience'

/** Soonest due first; tasks without a due date last. */
export async function listTasks(caseId: string, audiences: readonly Audience[] = AUDIENCES) {
  const { rows } = await pool.query<CaseTask>(
    `SELECT ${TASK_COLUMNS} FROM case_tasks
     WHERE case_id = $1 AND audience = ANY($2)
     ORDER BY due_at NULLS LAST, created_at`,
    [caseId, audiences],
  )
  return rows
}

export type TaskFields = Omit<CaseTask, 'id'>

export async function createTask(caseId: string, fields: TaskFields) {
  const { rows } = await pool.query<CaseTask>(
    `INSERT INTO case_tasks (case_id, title, description, due_at, audience)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${TASK_COLUMNS}`,
    [caseId, fields.title, fields.description, fields.dueAt, fields.audience],
  )
  return rows[0]
}

export async function updateTask(caseId: string, id: string, fields: TaskFields) {
  const { rows } = await pool.query<CaseTask>(
    `UPDATE case_tasks SET title = $3, description = $4, due_at = $5, audience = $6
     WHERE case_id = $1 AND id = $2
     RETURNING ${TASK_COLUMNS}`,
    [caseId, id, fields.title, fields.description, fields.dueAt, fields.audience],
  )
  return rows[0] ?? null
}

export async function deleteTask(caseId: string, id: string) {
  const { rowCount } = await pool.query('DELETE FROM case_tasks WHERE case_id = $1 AND id = $2', [
    caseId,
    id,
  ])
  return rowCount === 1
}

/** When each of the case's tasks was completed by `teamId`, and by whom. */
export async function listCompletions(caseId: string, teamId: string) {
  const { rows } = await pool.query<{ taskId: string; completedAt: Date; completedBy: string | null }>(
    `SELECT c.task_id AS "taskId", c.completed_at AS "completedAt", u.name AS "completedBy"
     FROM task_completions c
     JOIN case_tasks t ON t.id = c.task_id
     LEFT JOIN users u ON u.id = c.completed_by
     WHERE t.case_id = $1 AND c.team_id = $2`,
    [caseId, teamId],
  )
  return rows
}

export async function setTaskDone(taskId: string, teamId: string, userId: string, done: boolean) {
  if (done) {
    await pool.query(
      `INSERT INTO task_completions (task_id, team_id, completed_by) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [taskId, teamId, userId],
    )
  } else {
    await pool.query('DELETE FROM task_completions WHERE task_id = $1 AND team_id = $2', [taskId, teamId])
  }
}

// Note

export async function setInstructorNote(caseId: string, note: string) {
  await pool.query('UPDATE cases SET instructor_note = $2, updated_at = now() WHERE id = $1', [caseId, note])
}
