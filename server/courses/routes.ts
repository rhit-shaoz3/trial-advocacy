import { Router, type Request, type RequestHandler } from 'express'
import { requireUser } from '../auth/requireUser.ts'
import { HttpError } from '../httpError.ts'
import { isUuid, readString } from '../validation.ts'
import { answerInvitation, dismissDenial, getInbox } from './roster.ts'
import {
  createCourse,
  deleteCourse,
  findCourseByEntryCode,
  findCourseForMember,
  findTaughtCourse,
  listCoursesForUser,
  listTaughtCourses,
  NO_COURSE_FOR_CODE,
  requestToJoin,
  updateCourse,
  type CourseFields,
  type TaughtCourse,
} from './courses.ts'
import { askQuestion, getInterview, restartInterview, type InterviewContext } from '../witness/interviews.ts'
import { findMaterialFile, findWitness, listStorageKeys, removeStoredFiles, setTaskDone, visibleTo } from './caseContent.ts'
import { sendMaterialFile } from './caseContentRoutes.ts'
import { findCase } from './cases.ts'
import { casesRouter } from './caseRoutes.ts'
import { rosterRouter } from './rosterRoutes.ts'
import { homeCasesForInstructor, listMyCases, studentHome } from './myCases.ts'
import { findStudentTeamId, getStudentWorkspace } from './workspace.ts'

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
  if (!course) throw new HttpError(404, NO_COURSE_FOR_CODE)
  const result = await requestToJoin(req.user!, course.id)
  if (result === 'already-joined') throw new HttpError(409, 'You are already enrolled in that course.')
  if (result === 'already-requested') {
    throw new HttpError(409, 'You already asked to join that course. Your instructor will decide soon.')
  }
  // 'joined' if the instructor had already invited them, otherwise 'requested'.
  res.status(201).json({ course, status: result })
})

/** A student's invitations, waiting requests, and denied requests. */
coursesRouter.get('/inbox', async (req, res) => {
  res.json(await getInbox(req.user!.id))
})

for (const [action, accept] of [['accept', true], ['reject', false]] as const) {
  coursesRouter.post(`/:courseId/invitation/${action}`, async (req, res) => {
    const { courseId } = req.params
    if (!isUuid(courseId) || !(await answerInvitation(courseId, req.user!.id, accept))) {
      throw new HttpError(404, 'Invitation not found.')
    }
    res.status(204).end()
  })
}

coursesRouter.post('/:courseId/denial/dismiss', async (req, res) => {
  const { courseId } = req.params
  if (isUuid(courseId)) await dismissDenial(courseId, req.user!.id)
  res.status(204).end()
})

/** 404s unless the case is launched in a course the user belongs to. */
async function loadStudentWorkspace(courseId: string, caseId: string, userId: string) {
  // Only students who have joined the course (not invited, requested, or denied) get in.
  const member = isUuid(courseId) && isUuid(caseId) && (await findCourseForMember(courseId, userId))
  const workspace = member ? await getStudentWorkspace(courseId, caseId, userId) : null
  if (!workspace) throw new HttpError(404, 'Case not found.')
  return workspace
}

/**
 * Everything a member's course home page shows. Students get the launched
 * cases they're on a team in; the instructor (the only instructor who can be
 * a member) gets every launched case. Students' deadlines and task counts come
 * from their team's open and completed tasks. Activity isn't stored yet.
 */
coursesRouter.get('/:courseId/home', async (req, res) => {
  const { courseId } = req.params
  const course = isUuid(courseId) ? await findCourseForMember(courseId, req.user!.id) : null
  if (!course) throw new HttpError(404, 'Course not found.')
  res.json({
    course,
    activity: [],
    ...(req.user!.role === 'instructor'
      ? {
          cases: await homeCasesForInstructor(course.id),
          upcoming: [],
          stats: { tasksCompleted: 0, tasksCompletedThisWeek: 0 },
        }
      : await studentHome(course.id, req.user!.id)),
  })
})

/** A member's cases (drafts are hidden) with their team and case world in each, or null before pairing. */
coursesRouter.get('/:courseId/my-cases', async (req, res) => {
  const { courseId } = req.params
  const course = isUuid(courseId) ? await findCourseForMember(courseId, req.user!.id) : null
  if (!course) throw new HttpError(404, 'Course not found.')
  res.json({ cases: await listMyCases(course.id, req.user!.id) })
})

/** A student's dashboard for one launched case: their team, world, and what they can see. */
coursesRouter.get('/:courseId/my-cases/:caseId', async (req, res) => {
  res.json({ workspace: await loadStudentWorkspace(req.params.courseId, req.params.caseId, req.user!.id) })
})

/** Downloads a case file, if it's published and the student's side can see it. */
coursesRouter.get('/:courseId/my-cases/:caseId/materials/:materialId/file', async (req, res) => {
  const { courseId, caseId, materialId } = req.params
  const workspace = await loadStudentWorkspace(courseId, caseId, req.user!.id)
  if (!isUuid(materialId)) throw new HttpError(404, 'File not found.')
  await sendMaterialFile(res, await findMaterialFile(caseId, materialId, visibleTo(workspace.side), true))
})

/** Marks one of the case's tasks done (or not) for the student's whole team. */
coursesRouter.put('/:courseId/my-cases/:caseId/tasks/:taskId', async (req, res) => {
  const { courseId, caseId, taskId } = req.params
  const workspace = await loadStudentWorkspace(courseId, caseId, req.user!.id)
  const done = (req.body as Record<string, unknown> | undefined)?.done
  if (typeof done !== 'boolean') throw new HttpError(400, 'Say whether the task is done.')
  if (!workspace.tasks.some((t) => t.id === taskId)) throw new HttpError(404, 'Task not found.')
  if (workspace.case.status !== 'active') {
    throw new HttpError(409, 'This case is closed, so its tasks can no longer change.')
  }
  const teamId = await findStudentTeamId(caseId, req.user!.id)
  if (!teamId) throw new HttpError(409, 'You need to be on a team to complete tasks.')
  await setTaskDone(taskId, teamId, req.user!.id, done)
  res.json({ workspace: await loadStudentWorkspace(courseId, caseId, req.user!.id) })
})

/**
 * A team's interview of an AI witness their side can see. Both partners
 * share it. The side always comes from the team's case world, never from the
 * request, so the witness treats them as their own side's lawyers. It can be
 * read but not continued once the case is closed.
 */
async function teamInterview(req: Request): Promise<InterviewContext> {
  const { courseId, caseId, witnessId } = req.params as Record<string, string>
  const workspace = await loadStudentWorkspace(courseId, caseId, req.user!.id)
  if (!isUuid(witnessId) || !workspace.witnesses.some((w) => w.id === witnessId)) {
    throw new HttpError(404, 'Witness not found.')
  }
  const teamId = await findStudentTeamId(caseId, req.user!.id)
  if (!teamId || !workspace.side) throw new HttpError(409, 'Your team needs a case world before it can interview witnesses.')
  const [courseCase, witness] = await Promise.all([findCase(courseId, caseId), findWitness(caseId, witnessId)])
  if (!courseCase || !witness) throw new HttpError(404, 'Witness not found.')
  return {
    courseCase,
    witness,
    owner: { teamId, side: workspace.side },
    userId: req.user!.id,
    closed: workspace.case.status !== 'active',
  }
}

coursesRouter.get('/:courseId/my-cases/:caseId/witnesses/:witnessId/interview', async (req, res) => {
  res.json({ interview: await getInterview(await teamInterview(req)) })
})

coursesRouter.post('/:courseId/my-cases/:caseId/witnesses/:witnessId/interview/questions', async (req, res) => {
  res.json({ interview: await askQuestion(await teamInterview(req), req.body) })
})

coursesRouter.post('/:courseId/my-cases/:caseId/witnesses/:witnessId/interview/restart', async (req, res) => {
  const ctx = await teamInterview(req)
  if (ctx.closed) throw new HttpError(409, 'This case is closed, so the interview can no longer change.')
  res.json({ interview: await restartInterview(ctx) })
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
/** Also deletes the roster and the cases with everything in them. The entry code stops working. */
courseRouter.delete('/', async (req, res) => {
  const files = await listStorageKeys({ courseId: req.course!.id })
  await deleteCourse(req.course!.id)
  await removeStoredFiles(files)
  res.status(204).end()
})
courseRouter.use('/roster', rosterRouter)
courseRouter.use('/cases', casesRouter)

coursesRouter.use('/:courseId', courseRouter)
