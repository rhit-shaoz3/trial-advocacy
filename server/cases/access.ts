import type { Request } from 'express'
import { pool } from '../db/pool.ts'
import { HttpError } from '../httpError.ts'
import { findCase } from './cases.ts'

const NOT_FOUND = 'Case not found.'

/** The case, if the logged-in instructor teaches its course. 404 otherwise, so other cases stay hidden. */
export async function loadCaseForInstructor(req: Request) {
  const user = req.user!
  if (user.role !== 'instructor') throw new HttpError(403, 'Only instructors can do that.')
  const c = await findCase(String(req.params.caseId))
  if (!c || c.instructor_id !== user.id) throw new HttpError(404, NOT_FOUND)
  return c
}

/** The case, if the logged-in student has joined its course and something has been published. */
export async function loadCaseForStudent(req: Request) {
  const user = req.user!
  const c = await findCase(String(req.params.caseId))
  const anythingPublished =
    c && (c.documents_published_at || c.characters_published_at || c.teams_published_at)
  if (!c || !anythingPublished) throw new HttpError(404, NOT_FOUND)
  const { rowCount } = await pool.query(
    'SELECT 1 FROM enrollments WHERE course_id = $1 AND user_id = $2',
    [c.course_id, user.id],
  )
  if (!rowCount) throw new HttpError(404, NOT_FOUND)
  return c
}

/** Either of the above, depending on who is asking. */
export function loadCaseForMember(req: Request) {
  return req.user!.role === 'instructor' ? loadCaseForInstructor(req) : loadCaseForStudent(req)
}
