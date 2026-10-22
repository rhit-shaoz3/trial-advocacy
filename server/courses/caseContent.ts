import { pool } from '../db/pool.ts'
import { storage } from '../storage/storage.ts'
import type { Side } from './matchups.ts'

// What the instructor provides for a case: the case file (the pieces of the
// fact pattern: documents, images, audio, video), witnesses, tasks, and a note.
// Each item has an `audience`: everyone in the case, or only the teams on one
// side. Case files can also be for instructors only, such as a witness's
// deposition that trains an AI witness.

export const AUDIENCES = ['all', 'plaintiff', 'defense'] as const
export type Audience = (typeof AUDIENCES)[number]

export const MATERIAL_AUDIENCES = [...AUDIENCES, 'instructor'] as const
export type MaterialAudience = (typeof MATERIAL_AUDIENCES)[number]

/** Whether a file's transcription for the AI witnesses is running, done, failed, or not needed. */
export type TextStatus = 'pending' | 'ready' | 'failed' | 'none'

/** The audiences someone on `side` can see; with no side yet, only shared items. */
export const visibleTo = (side: Side | null): Audience[] => (side ? ['all', side] : ['all'])

// Shapes sent to the client; match `CaseMaterial`, `Witness`, and `CaseTask` in src/courses/types.ts.
export interface CaseMaterial {
  id: string
  audience: MaterialAudience
  filename: string
  description: string
  contentType: string
  sizeBytes: number
  uploadedAt: Date
  textStatus: TextStatus
  textError: string | null
  /** The file every team starts from; always shared with everyone. */
  initial: boolean
}

export interface Witness {
  id: string
  name: string
  role: string
  description: string
  audience: Audience
  /** The side the witness testifies for; set (with a deposition) to make it an AI witness. */
  alignedSide: Side | null
  personaNotes: string
  /** The case file holding the witness's deposition: their own sworn account. */
  depositionMaterialId: string | null
  /** Other case files the witness has seen. */
  knownMaterialIds: string[]
  /** The witness's lawyer, who may object when the other side is asking. */
  defendingCounsel: string
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
  size_bytes AS "sizeBytes", uploaded_at AS "uploadedAt", text_status AS "textStatus", text_error AS "textError",
  initial`

/** The initial file first, then in upload order. */
export async function listMaterials(caseId: string, audiences: readonly MaterialAudience[] = MATERIAL_AUDIENCES) {
  const { rows } = await pool.query<CaseMaterial>(
    `SELECT ${MATERIAL_COLUMNS} FROM case_materials
     WHERE case_id = $1 AND audience = ANY($2)
     ORDER BY initial DESC, uploaded_at, filename`,
    [caseId, audiences],
  )
  return rows
}

/** Records a file already in storage under `storageKey`; `id` is chosen by the caller (it's in the key). */
export async function createMaterial(input: {
  id: string
  caseId: string
  audience: MaterialAudience
  filename: string
  description: string
  contentType: string
  sizeBytes: number
  storageKey: string
  uploadedBy: string
}) {
  const { rows } = await pool.query<CaseMaterial>(
    `INSERT INTO case_materials
       (id, case_id, audience, filename, description, content_type, size_bytes, storage_key, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${MATERIAL_COLUMNS}`,
    [
      input.id,
      input.caseId,
      input.audience,
      input.filename,
      input.description,
      input.contentType,
      input.sizeBytes,
      input.storageKey,
      input.uploadedBy,
    ],
  )
  return rows[0]
}

/** The initial file is always shared with everyone, so it can't be narrowed. */
export class InitialMaterialAudienceError extends Error {}

/** Returns null if there was no such material. */
export async function updateMaterial(
  caseId: string,
  id: string,
  fields: { audience: MaterialAudience; description: string },
) {
  const { rows } = await pool.query<CaseMaterial>(
    `UPDATE case_materials SET audience = $3, description = $4
     WHERE case_id = $1 AND id = $2 AND (NOT initial OR $3 = 'all')
     RETURNING ${MATERIAL_COLUMNS}`,
    [caseId, id, fields.audience, fields.description],
  )
  if (rows[0]) return rows[0]
  const { rowCount } = await pool.query('SELECT 1 FROM case_materials WHERE case_id = $1 AND id = $2', [caseId, id])
  if (rowCount) throw new InitialMaterialAudienceError()
  return null
}

/**
 * Makes `id` the case's initial file (shared with everyone from then on), in
 * place of any other; null clears it. Returns false if there was no such
 * material, or 'deposition' if it's a witness's deposition, which students
 * must never see.
 */
export async function setInitialMaterial(caseId: string, id: string | null): Promise<boolean | 'deposition'> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('UPDATE case_materials SET initial = false WHERE case_id = $1 AND initial', [caseId])
    if (id) {
      const { rows } = await client.query<{ deposition: boolean }>(
        `UPDATE case_materials m SET initial = true, audience = 'all' WHERE m.case_id = $1 AND m.id = $2
         RETURNING EXISTS (SELECT 1 FROM case_witnesses w WHERE w.deposition_material_id = m.id) AS deposition`,
        [caseId, id],
      )
      if (rows.length === 0 || rows[0].deposition) {
        await client.query('ROLLBACK')
        return rows.length === 0 ? false : 'deposition'
      }
    }
    await client.query('COMMIT')
    return true
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/** Returns false if there was no such material, else its storage key (null for an old in-database file). */
export async function deleteMaterial(caseId: string, id: string) {
  const { rows } = await pool.query<{ storageKey: string | null }>(
    'DELETE FROM case_materials WHERE case_id = $1 AND id = $2 RETURNING storage_key AS "storageKey"',
    [caseId, id],
  )
  return rows.length === 0 ? false : rows[0].storageKey
}

/**
 * The storage keys of every file in a case, or in all of a course's cases, so
 * they can be removed from storage when the case or course is deleted.
 */
export async function listStorageKeys(scope: { caseId: string } | { courseId: string }) {
  const { rows } = await pool.query<{ key: string }>(
    'caseId' in scope
      ? 'SELECT storage_key AS key FROM case_materials WHERE case_id = $1 AND storage_key IS NOT NULL'
      : `SELECT m.storage_key AS key FROM case_materials m JOIN cases c ON c.id = m.case_id
         WHERE c.course_id = $1 AND m.storage_key IS NOT NULL`,
    ['caseId' in scope ? scope.caseId : scope.courseId],
  )
  return rows.map((r) => r.key)
}

/**
 * Where a file is stored (or, for a file uploaded before object storage, its
 * contents); null unless the material exists and is visible to `audiences`.
 */
export async function findMaterialFile(
  caseId: string,
  id: string,
  audiences: readonly MaterialAudience[] = MATERIAL_AUDIENCES,
) {
  const { rows } = await pool.query<{
    filename: string
    contentType: string
    storageKey: string | null
    data: Buffer | null
  }>(
    `SELECT filename, content_type AS "contentType", storage_key AS "storageKey",
            CASE WHEN storage_key IS NULL THEN data END AS data
     FROM case_materials
     WHERE case_id = $1 AND id = $2 AND audience = ANY($3)`,
    [caseId, id, audiences],
  )
  return rows[0] ?? null
}

/**
 * Deletes files from storage after their rows are gone. A failure is logged
 * rather than undoing the delete; the files are unreachable either way.
 */
export async function removeStoredFiles(keys: string[]) {
  if (keys.length === 0) return
  try {
    await storage.delete(keys)
  } catch (err) {
    console.error(`Could not delete ${keys.length} stored file(s):`, err)
  }
}

/** A file's transcription for the AI witnesses (instructors can review it). */
export async function getMaterialText(caseId: string, id: string) {
  const { rows } = await pool.query<{ filename: string; textStatus: TextStatus; text: string | null }>(
    `SELECT filename, text_status AS "textStatus", text_content AS text
     FROM case_materials WHERE case_id = $1 AND id = $2`,
    [caseId, id],
  )
  return rows[0] ?? null
}

export async function setMaterialText(
  id: string,
  result: { status: TextStatus; text?: string | null; error?: string | null },
) {
  await pool.query('UPDATE case_materials SET text_status = $2, text_content = $3, text_error = $4 WHERE id = $1', [
    id,
    result.status,
    result.text ?? null,
    result.error ?? null,
  ])
}

export interface MaterialText {
  id: string
  audience: MaterialAudience
  filename: string
  description: string
  textStatus: TextStatus
  text: string | null
  initial: boolean
}

/** Every file in a case with its transcription, for building an AI witness's prompt. */
export async function listMaterialTexts(caseId: string) {
  const { rows } = await pool.query<MaterialText>(
    `SELECT id, audience, filename, description, text_status AS "textStatus", text_content AS text, initial
     FROM case_materials WHERE case_id = $1 ORDER BY uploaded_at, filename`,
    [caseId],
  )
  return rows
}

// Witnesses

const WITNESS_COLUMNS = `id, name, role, description, audience, aligned_side AS "alignedSide",
  persona_notes AS "personaNotes", deposition_material_id AS "depositionMaterialId",
  known_material_ids AS "knownMaterialIds", defending_counsel AS "defendingCounsel"`

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

const witnessValues = (f: WitnessFields) => [
  f.name,
  f.role,
  f.description,
  f.audience,
  f.alignedSide,
  f.personaNotes,
  f.depositionMaterialId,
  f.knownMaterialIds,
  f.defendingCounsel,
]

export async function createWitness(caseId: string, fields: WitnessFields) {
  const { rows } = await pool.query<Witness>(
    `INSERT INTO case_witnesses (case_id, name, role, description, audience, aligned_side, persona_notes,
       deposition_material_id, known_material_ids, defending_counsel)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING ${WITNESS_COLUMNS}`,
    [caseId, ...witnessValues(fields)],
  )
  return rows[0]
}

export async function updateWitness(caseId: string, id: string, fields: WitnessFields) {
  const { rows } = await pool.query<Witness>(
    `UPDATE case_witnesses SET name = $3, role = $4, description = $5, audience = $6, aligned_side = $7,
       persona_notes = $8, deposition_material_id = $9, known_material_ids = $10, defending_counsel = $11
     WHERE case_id = $1 AND id = $2
     RETURNING ${WITNESS_COLUMNS}`,
    [caseId, id, ...witnessValues(fields)],
  )
  return rows[0] ?? null
}

export async function findWitness(caseId: string, id: string) {
  const { rows } = await pool.query<Witness>(
    `SELECT ${WITNESS_COLUMNS} FROM case_witnesses WHERE case_id = $1 AND id = $2`,
    [caseId, id],
  )
  return rows[0] ?? null
}

/** Which of `ids` are files in this case (to check a witness's deposition and known files). */
export async function existingMaterialIds(caseId: string, ids: string[]) {
  if (ids.length === 0) return new Set<string>()
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM case_materials WHERE case_id = $1 AND id = ANY($2::uuid[])',
    [caseId, ids],
  )
  return new Set(rows.map((r) => r.id))
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

// Note and AI witness settings

export async function setInstructorNote(caseId: string, note: string) {
  await pool.query('UPDATE cases SET instructor_note = $2, updated_at = now() WHERE id = $1', [caseId, note])
}

/** "Today" inside the case (null: the real date) and the issues no witness may settle. */
export async function setWitnessSettings(caseId: string, settings: { inWorldDate: string | null; disputedIssues: string }) {
  await pool.query('UPDATE cases SET in_world_date = $2, disputed_issues = $3, updated_at = now() WHERE id = $1', [
    caseId,
    settings.inWorldDate,
    settings.disputedIssues,
  ])
}
