import { randomUUID } from 'node:crypto'
import { pool } from '../db/pool.ts'
import type { Db } from '../db/transaction.ts'

// Files live in Postgres for now (free, and Heroku's disk is wiped on restart).
// Everything else refers to a file only by its key, so moving to S3 later means
// rewriting just these three functions.

/** Saves the bytes and returns the key to fetch them with later. */
export async function putFile(db: Db, content: Buffer) {
  const key = randomUUID()
  await db.query('INSERT INTO stored_files (key, content) VALUES ($1, $2)', [key, content])
  return key
}

export async function getFile(key: string) {
  const { rows } = await pool.query<{ content: Buffer }>(
    'SELECT content FROM stored_files WHERE key = $1',
    [key],
  )
  return rows[0]?.content ?? null
}

export async function deleteFile(db: Db, key: string) {
  await db.query('DELETE FROM stored_files WHERE key = $1', [key])
}
