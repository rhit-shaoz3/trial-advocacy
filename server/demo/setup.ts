import { isProduction } from '../config.ts'
import { pool } from '../db/pool.ts'
import { DEMO_EMAIL, setupDemo } from './demo.ts'

/**
 * Sets up the demo (see demo.ts) from this database's Thrillville case: the
 * case titled "Thrillville", or DEMO_SOURCE_CASE_ID. Safe to re-run; it
 * replaces the demo's template and resets the demo case world.
 */
if (isProduction) throw new Error('Refusing to set up the demo in production.')

try {
  const { rows } = await pool.query<{ id: string; title: string }>(
    process.env.DEMO_SOURCE_CASE_ID
      ? 'SELECT id, title FROM cases WHERE id = $1'
      : `SELECT c.id, c.title FROM cases c
         WHERE c.title ILIKE 'Thrillville' AND NOT c.is_demo
           AND c.course_id NOT IN (SELECT id FROM courses WHERE entry_code IN ('DEMO01', 'DEMOTP'))
         ORDER BY c.updated_at DESC LIMIT 1`,
    process.env.DEMO_SOURCE_CASE_ID ? [process.env.DEMO_SOURCE_CASE_ID] : [],
  )
  if (!rows[0]) {
    throw new Error('No Thrillville case found to build the demo from. Set DEMO_SOURCE_CASE_ID to the case to use.')
  }
  const password = await setupDemo(rows[0].id)
  console.log(`Demo set up from "${rows[0].title}". Log in as ${DEMO_EMAIL} / ${password}.`)
} finally {
  await pool.end()
}
