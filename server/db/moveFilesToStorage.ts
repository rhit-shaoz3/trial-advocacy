import { storage } from '../storage/storage.ts'
import { pool } from './pool.ts'

/**
 * Moves case files that were stored in Postgres (before object storage) into
 * storage, one at a time, and clears them from the database. Safe to re-run:
 * files already moved are skipped. Run with `npm run storage:migrate`.
 */
try {
  const { rows } = await pool.query<{ id: string; caseId: string; contentType: string }>(
    `SELECT id, case_id AS "caseId", content_type AS "contentType"
     FROM case_materials WHERE storage_key IS NULL AND data IS NOT NULL`,
  )
  for (const row of rows) {
    const { rows: file } = await pool.query<{ data: Buffer }>('SELECT data FROM case_materials WHERE id = $1', [row.id])
    const key = `cases/${row.caseId}/${row.id}`
    await storage.put(key, file[0].data, row.contentType)
    await pool.query('UPDATE case_materials SET storage_key = $2, data = NULL WHERE id = $1', [row.id, key])
  }
  console.log(rows.length === 0 ? 'No files left to move.' : `Moved ${rows.length} file(s) into storage.`)
} finally {
  await pool.end()
}
