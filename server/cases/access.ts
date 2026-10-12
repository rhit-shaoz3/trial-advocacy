import type { Request } from 'express'
import { requireUser } from '../auth/requireUser.ts'
import { isInstructorOf } from '../classes/classes.ts'
import { pool } from '../db/pool.ts'
import { HttpError } from '../httpError.ts'
import { findCase } from './cases.ts'

const NOT_FOUND = 'Case not found.'

/** The case, if the logged-in user teaches its class. 404 otherwise, so other cases stay hidden. */
export async function loadCaseForInstructor(req: Request) {
  const user = await requireUser(req, 'instructor')
  const c = await findCase(String(req.params.caseId))
  if (!c || !(await isInstructorOf(c.class_id, user.id))) throw new HttpError(404, NOT_FOUND)
  return { user, case: c }
}

/** The case, if the logged-in student is in its class and something has been published. */
export async function loadCaseForStudent(req: Request) {
  const user = await requireUser(req, 'student')
  const c = await findCase(String(req.params.caseId))
  const anythingPublished =
    c && (c.documents_published_at || c.characters_published_at || c.teams_published_at)
  if (!c || !anythingPublished) throw new HttpError(404, NOT_FOUND)
  const { rowCount } = await pool.query(
    'SELECT 1 FROM class_students WHERE class_id = $1 AND user_id = $2',
    [c.class_id, user.id],
  )
  if (!rowCount) throw new HttpError(404, NOT_FOUND)
  return { user, case: c }
}
