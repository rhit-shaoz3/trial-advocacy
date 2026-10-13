import { pool } from '../db/pool.ts'

// Shape sent to the client; matches `FactPattern` in src/courses/types.ts.
export interface FactPatternInfo {
  id: string
  filename: string
  sizeBytes: number
  uploadedAt: Date
}

const INFO_COLUMNS = `id, filename, size_bytes AS "sizeBytes", uploaded_at AS "uploadedAt"`

export async function listFactPatterns(courseId: string) {
  const { rows } = await pool.query<FactPatternInfo>(
    `SELECT ${INFO_COLUMNS} FROM fact_patterns WHERE course_id = $1 ORDER BY uploaded_at, filename`,
    [courseId],
  )
  return rows
}

export async function createFactPattern(input: {
  courseId: string
  filename: string
  contentType: string
  data: Buffer
  uploadedBy: string
}) {
  const { rows } = await pool.query<FactPatternInfo>(
    `INSERT INTO fact_patterns (course_id, filename, content_type, size_bytes, data, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${INFO_COLUMNS}`,
    [input.courseId, input.filename, input.contentType, input.data.length, input.data, input.uploadedBy],
  )
  return rows[0]
}

/** Includes the file contents. */
export async function findFactPatternFile(courseId: string, id: string) {
  const { rows } = await pool.query<{ filename: string; contentType: string; data: Buffer }>(
    `SELECT filename, content_type AS "contentType", data
     FROM fact_patterns WHERE course_id = $1 AND id = $2`,
    [courseId, id],
  )
  return rows[0] ?? null
}

/** Returns false if there was no such file. */
export async function deleteFactPattern(courseId: string, id: string) {
  const { rowCount } = await pool.query(
    'DELETE FROM fact_patterns WHERE course_id = $1 AND id = $2',
    [courseId, id],
  )
  return rowCount === 1
}
