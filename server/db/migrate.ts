import { readFile } from 'node:fs/promises'
import { pool } from './pool.ts'

const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8')

try {
  await pool.query(sql)
  console.log('Database schema is up to date.')
} finally {
  await pool.end()
}
