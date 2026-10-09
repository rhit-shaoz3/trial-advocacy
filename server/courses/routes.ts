import { Router, type Request, type RequestHandler } from 'express'
import { requireUser } from '../auth/requireUser.ts'
import { HttpError } from '../httpError.ts'
import { isUuid, readString } from '../validation.ts'
import {
  createCourse,
  deleteCourse,
  enroll,
  findCourseByEntryCode,
  findTaughtCourse,
  listCoursesForUser,
  listTaughtCourses,
  updateCourse,
  type CourseFields,
  type TaughtCourse,
} from './courses.ts'
import { factPatternsRouter } from './factPatternRoutes.ts'
import { rosterRouter } from './rosterRoutes.ts'

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by `loadTaughtCourse` on /api/courses/:courseId routes. */
    course?: TaughtCourse
  }
}

const MAX_CODE_LENGTH = 20
const MAX_TITLE_LENGTH = 120

// Approximate start of each term, only used to sort terms chronologically.
const SEASON_START: Record<string, string> = {
  Winter: '01-01',
  Spring: '03-25',
  Summer: '06-15',
  Fall: '09-15',
}

function assertInstructor(req: Request) {
  if (req.user!.role !== 'instructor') throw new HttpError(403, 'Only instructors can do that.')
}

/** 404s unless the course exists and the current user teaches it. */
const loadTaughtCourse: RequestHandler = async (req, _res, next) => {
  const { courseId } = req.params
  const course = isUuid(courseId) ? await findTaughtCourse(courseId, req.user!.id) : null
  if (!course) throw new HttpError(404, 'Course not found.')
  req.course = course
  next()
}

export const coursesRouter = Router()

coursesRouter.use(requireUser)

coursesRouter.get('/', async (req, res) => {
  res.json({ courses: await listCoursesForUser(req.user!.id) })
})

coursesRouter.get('/teaching', async (req, res) => {
  assertInstructor(req)
  res.json({ courses: await listTaughtCourses(req.user!.id) })
})

/** Validates the body of a create or edit request. */
function readCourseFields(body: unknown): CourseFields {
  const code = readString(body, 'code').trim()
  const title = readString(body, 'title').trim()
  const season = readString(body, 'season')
  const year = (body as Record<string, unknown> | undefined)?.year

  if (!code) throw new HttpError(400, 'Course number is required.')
  if (code.length > MAX_CODE_LENGTH) {
    throw new HttpError(400, `Course number must be at most ${MAX_CODE_LENGTH} characters.`)
  }
  if (!title) throw new HttpError(400, 'Course title is required.')
  if (title.length > MAX_TITLE_LENGTH) {
    throw new HttpError(400, `Course title must be at most ${MAX_TITLE_LENGTH} characters.`)
  }
  if (!Object.hasOwn(SEASON_START, season)) throw new HttpError(400, 'Choose a term.')
  if (!Number.isInteger(year) || (year as number) < 2000 || (year as number) > 2100) {
    throw new HttpError(400, 'Enter a valid year.')
  }

  return { code, title, term: `${season} ${year}`, termStart: `${year}-${SEASON_START[season]}` }
}

coursesRouter.post('/', async (req, res) => {
  assertInstructor(req)
  const course = await createCourse({ ...readCourseFields(req.body), instructorId: req.user!.id })
  res.status(201).json({ course })
})

coursesRouter.post('/join', async (req, res) => {
  if (req.user!.role !== 'student') {
    throw new HttpError(403, 'Only students can join a course with an entry code.')
  }
  const entryCode = readString(req.body, 'entryCode').trim().toUpperCase()
  if (!entryCode) throw new HttpError(400, 'Enter an entry code.')

  const course = await findCourseByEntryCode(entryCode)
  if (!course) throw new HttpError(404, 'No course matches that entry code.')
  if (!(await enroll(req.user!, course.id))) {
    throw new HttpError(409, 'You are already enrolled in that course.')
  }
  res.status(201).json({ course })
})

// Everything below manages one course and is only for the instructor who teaches it.
const courseRouter = Router({ mergeParams: true })
courseRouter.use(loadTaughtCourse)
courseRouter.get('/', (req, res) => {
  res.json({ course: req.course })
})
courseRouter.patch('/', async (req, res) => {
  res.json({ course: await updateCourse(req.course!.id, readCourseFields(req.body)) })
})
/** Also deletes the roster and fact patterns. The entry code stops working. */
courseRouter.delete('/', async (req, res) => {
  await deleteCourse(req.course!.id)
  res.status(204).end()
})
courseRouter.use('/roster', rosterRouter)
courseRouter.use('/fact-patterns', factPatternsRouter)

coursesRouter.use('/:courseId', courseRouter)
