import { Router } from 'express'
import { requireUser } from '../auth/requireUser.ts'
import { HttpError } from '../httpError.ts'
import { enroll, findCourseByEntryCode, listCoursesForUser } from './courses.ts'

export const coursesRouter = Router()

coursesRouter.use(requireUser)

coursesRouter.get('/', async (req, res) => {
  res.json({ courses: await listCoursesForUser(req.user!.id) })
})

coursesRouter.post('/join', async (req, res) => {
  if (req.user!.role !== 'student') {
    throw new HttpError(403, 'Only students can join a course with an entry code.')
  }
  const raw = (req.body as Record<string, unknown> | undefined)?.entryCode
  const entryCode = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
  if (!entryCode) throw new HttpError(400, 'Enter an entry code.')

  const course = await findCourseByEntryCode(entryCode)
  if (!course) throw new HttpError(404, 'No course matches that entry code.')
  if (!(await enroll(req.user!.id, course.id))) {
    throw new HttpError(409, 'You are already enrolled in that course.')
  }
  res.status(201).json({ course })
})
