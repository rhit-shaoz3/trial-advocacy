import { findWitness } from '../courses/caseContent.ts'
import { findCase } from '../courses/cases.ts'
import { pool } from '../db/pool.ts'
import { isAiWitness, loadProfile } from './profile.ts'

// For the command-line tools (chat, eval): loads an AI witness exactly as the
// app set it up, by name, from the database in DATABASE_URL.

/** Where a witness's eval cases and saved runs live: git-ignored, since they quote the case. */
export const witnessFolder = (name: string) =>
  new URL(`../../.material/witnesses/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}/`, import.meta.url)

export async function loadAppWitness(name: string | undefined) {
  if (!name) throw new Error('Name the witness: --witness "Full Name"')
  const { rows } = await pool.query<{ id: string; caseId: string; courseId: string; title: string }>(
    `SELECT w.id, w.case_id AS "caseId", c.course_id AS "courseId", c.title
     FROM case_witnesses w JOIN cases c ON c.id = w.case_id
     WHERE lower(w.name) = lower($1)
     ORDER BY w.created_at DESC`,
    [name.trim()],
  )
  if (rows.length === 0) throw new Error(`No witness named "${name}" in the app. Create it in the case's Witnesses tab.`)
  if (rows.length > 1) console.warn(`${rows.length} witnesses are named "${name}"; using the newest (in ${rows[0].title}).`)
  const [courseCase, witness] = await Promise.all([findCase(rows[0].courseId, rows[0].caseId), findWitness(rows[0].caseId, rows[0].id)])
  if (!courseCase || !witness) throw new Error(`Could not load "${name}".`)
  if (!isAiWitness(witness)) throw new Error(`${witness.name} is not an AI witness yet: choose a side and a deposition file.`)
  const profile = await loadProfile(courseCase, witness)
  return { courseCase, witness, profile }
}
