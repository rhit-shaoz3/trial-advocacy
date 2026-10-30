import { Router, type Request, type RequestHandler } from 'express'
import { requireUser } from '../auth/requireUser.ts'
import { HttpError } from '../httpError.ts'
import { isUuid, readString } from '../validation.ts'
import {
  createCourse,
  deleteCourse,
  enroll,
  findCourseByEntryCode,
  findCourseForMember,
  findTaughtCourse,
  listCoursesForUser,
  listTaughtCourses,
  updateCourse,
  type CourseFields,
  type TaughtCourse,
} from './courses.ts'
import { asExhibits, askQuestion, endInterview, getInterview, restartInterview, type InterviewContext } from '../witness/interviews.ts'
import {
  findTeamInterviewReview,
  findTeamWorld,
  markedTranscript,
  markReviewsSeen,
  newestUnseenResult,
  openReviewCount,
  teamReviewResults,
  unseenReviewCount,
} from '../reviews/reviews.ts'
import { calendarRouter } from '../calendar/calendarRoutes.ts'
import { reviewsRouter } from '../reviews/reviewRoutes.ts'
import { findMaterialFile, findMaterialText, findWitness, listStorageKeys, removeStoredFiles, setTaskDone } from './caseContent.ts'
import { sendMaterialFile, sendMaterialText } from './caseContentRoutes.ts'
import { acceptSharedCase, declineSharedCase, listSharedCases } from './caseCopy.ts'
import { findCase } from './cases.ts'
import { casesRouter } from './caseRoutes.ts'
import { rosterRouter } from './rosterRoutes.ts'
import { instructorHome } from './instructorHome.ts'
import { homeCasesForInstructor, listMyCases, studentHome } from './myCases.ts'
import { findStudentTeamId, getStudentWorkspace, studentViewer } from './workspace.ts'
import { sendInvestigation, teamInvestigations, type InvestigationContext } from '../investigator/requests.ts'
import { myExchangeRouter } from '../exchange/exchangeRoutes.ts'
import { subpoenasRouter } from '../exchange/subpoenaRoutes.ts'
import { openSubpoenaCount } from '../exchange/subpoenas.ts'
import { markFlagsSeen, openFlagCount, raiseFlag, teamFlags } from '../reviews/flags.ts'

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

/** Cases other instructors shared with this one, waiting to be accepted or declined. */
coursesRouter.get('/shared-cases', async (req, res) => {
  assertInstructor(req)
  res.json({ shares: await listSharedCases(req.user!.id) })
})

/** Copies a shared case into one of the instructor's classes: `{ courseId }`. */
coursesRouter.post('/shared-cases/:shareId/accept', async (req, res) => {
  assertInstructor(req)
  const shareId = String(req.params.shareId)
  const courseId = readString(req.body, 'courseId')
  if (!isUuid(shareId)) throw new HttpError(404, 'That shared case is no longer waiting for you.')
  if (!isUuid(courseId)) throw new HttpError(400, 'Choose a class for the case.')
  res.status(201).json({ case: await acceptSharedCase(shareId, req.user!.id, courseId), courseId })
})

coursesRouter.post('/shared-cases/:shareId/decline', async (req, res) => {
  assertInstructor(req)
  const shareId = String(req.params.shareId)
  if (!isUuid(shareId)) throw new HttpError(404, 'That shared case is no longer waiting for you.')
  await declineSharedCase(shareId, req.user!.id)
  res.status(204).end()
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

/** 404s unless the case is launched in a course the user belongs to. */
async function loadStudentWorkspace(courseId: string, caseId: string, userId: string) {
  const workspace =
    isUuid(courseId) && isUuid(caseId) ? await getStudentWorkspace(courseId, caseId, userId) : null
  if (!workspace) throw new HttpError(404, 'Case not found.')
  return workspace
}

/**
 * Everything a member's course home page shows. Students get the launched
 * cases they're on a team in; the instructor (the only instructor who can be
 * a member) gets every launched case, plus `instructor`: their own dashboard
 * (course health, every case's readiness, what's waiting on them, deadlines
 * with team completion, recent activity). Students' deadlines and task counts
 * come from their team's open and completed tasks.
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
          // Subpoenas waiting for an answer are on the Review page too.
          reviewCount:
            (await openReviewCount(course.id)) + (await openSubpoenaCount(course.id)) + (await openFlagCount(course.id)),
          instructor: await instructorHome(course.id),
        }
      : {
          ...(await studentHome(course.id, req.user!.id)),
          newReviewResults: await unseenReviewCount(course.id, req.user!.id),
          newResultsAt: await newestUnseenResult(course.id, req.user!.id),
        }),
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

/** Downloads a case file, if the student can see it (their side's, or shared with their team or world). */
coursesRouter.get('/:courseId/my-cases/:caseId/materials/:materialId/file', async (req, res) => {
  const { courseId, caseId, materialId } = req.params
  const workspace = await loadStudentWorkspace(courseId, caseId, req.user!.id)
  if (!isUuid(materialId)) throw new HttpError(404, 'File not found.')
  const viewer = await studentViewer(caseId, req.user!.id, workspace.side)
  await sendMaterialFile(res, await findMaterialFile(caseId, materialId, viewer), req.query.view === '1')
})

/** A case file's text version, for the viewer, if the student can see the file. */
coursesRouter.get('/:courseId/my-cases/:caseId/materials/:materialId/text', async (req, res) => {
  const { courseId, caseId, materialId } = req.params
  const workspace = await loadStudentWorkspace(courseId, caseId, req.user!.id)
  if (!isUuid(materialId)) throw new HttpError(404, 'File not found.')
  const viewer = await studentViewer(caseId, req.user!.id, workspace.side)
  await sendMaterialText(res, await findMaterialText(caseId, materialId, viewer))
})

/** Marks one of the case's tasks done (or not) for the student's whole team. */
coursesRouter.put('/:courseId/my-cases/:caseId/tasks/:taskId', async (req, res) => {
  const { courseId, caseId, taskId } = req.params
  const workspace = await loadStudentWorkspace(courseId, caseId, req.user!.id)
  const done = (req.body as Record<string, unknown> | undefined)?.done
  if (typeof done !== 'boolean') throw new HttpError(400, 'Say whether the task is done.')
  const task = workspace.tasks.find((t) => t.id === taskId)
  if (!task) throw new HttpError(404, 'Task not found.')
  if (task.auto) throw new HttpError(409, 'This task completes on its own when your team does it.')
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
  const seen = isUuid(witnessId) ? workspace.witnesses.find((w) => w.id === witnessId) : undefined
  if (!seen) throw new HttpError(404, 'Witness not found.')
  // The other side's disclosed witnesses show by name, but only deposition opens them.
  if (seen.disclosed) throw new HttpError(409, "You can depose the other side's witnesses in the deposition phase.")
  const teamId = await findStudentTeamId(caseId, req.user!.id)
  if (!teamId || !workspace.side) throw new HttpError(409, 'Your team needs a case world before it can interview witnesses.')
  const [courseCase, witness, world] = await Promise.all([
    findCase(courseId, caseId),
    findWitness(caseId, witnessId),
    findTeamWorld(teamId),
  ])
  if (!courseCase || !witness) throw new HttpError(404, 'Witness not found.')
  return {
    courseCase,
    witness,
    owner: { teamId, side: workspace.side },
    matchupId: world?.matchupId ?? null,
    userId: req.user!.id,
    closed: workspace.case.status !== 'active',
    // The files the team has, to show the witness.
    exhibits: asExhibits(workspace.materials),
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

/** Ends the interview and sends it to the instructor for review: `{ interview, sentForReview }`. */
coursesRouter.post('/:courseId/my-cases/:caseId/witnesses/:witnessId/interview/end', async (req, res) => {
  const ctx = await teamInterview(req)
  if (ctx.closed) throw new HttpError(409, 'This case is closed, so the interview can no longer change.')
  res.json(await endInterview(ctx))
})

/** The team's completed reviews: which facts the instructor accepted and which denied. */
coursesRouter.get('/:courseId/my-cases/:caseId/reviews', async (req, res) => {
  const { courseId, caseId } = req.params
  await loadStudentWorkspace(courseId, caseId, req.user!.id)
  const teamId = await findStudentTeamId(caseId, req.user!.id)
  res.json({ reviews: teamId ? await teamReviewResults(caseId, teamId, req.user!.id) : [] })
})

/** The conversation behind one of the team's completed reviews, with what rests on denied facts struck out. */
coursesRouter.get('/:courseId/my-cases/:caseId/reviews/:reviewId/transcript', async (req, res) => {
  const { courseId, caseId, reviewId } = req.params
  await loadStudentWorkspace(courseId, caseId, req.user!.id)
  const teamId = await findStudentTeamId(caseId, req.user!.id)
  const id = teamId && isUuid(reviewId) ? await findTeamInterviewReview(caseId, teamId, reviewId) : null
  if (!id) throw new HttpError(404, 'Review not found.')
  res.json(await markedTranscript(id))
})

/** Marks the team's review results as read by this student. */
coursesRouter.post('/:courseId/my-cases/:caseId/reviews/seen', async (req, res) => {
  const { courseId, caseId } = req.params
  await loadStudentWorkspace(courseId, caseId, req.user!.id)
  const teamId = await findStudentTeamId(caseId, req.user!.id)
  if (teamId) await markReviewsSeen(caseId, teamId, req.user!.id)
  res.status(204).end()
})

/**
 * Who's asking the background investigator: the student's team, in its case
 * world (the side comes from the world, never the request). 409 unless the
 * case has an investigator, he's open in this phase, and the team is matched.
 */
async function teamInvestigation(req: Request, sending: boolean): Promise<InvestigationContext | null> {
  const { courseId, caseId } = req.params as Record<string, string>
  const workspace = await loadStudentWorkspace(courseId, caseId, req.user!.id)
  const teamId = await findStudentTeamId(caseId, req.user!.id)
  const world = teamId ? await findTeamWorld(teamId) : null
  if (!sending) return teamId && world ? { caseId, teamId, ...world, userId: req.user!.id } : null
  if (!workspace.investigator) throw new HttpError(409, 'This case has no background investigator.')
  if (!workspace.investigatorAvailable) {
    throw new HttpError(409, 'The background investigator becomes available in the investigate phase.')
  }
  if (workspace.case.status !== 'active') throw new HttpError(409, 'This case is closed, so the investigator has finished.')
  if (!teamId || !world) throw new HttpError(409, 'Your team needs a case world before it can hire the investigator.')
  return { caseId, teamId, ...world, userId: req.user!.id }
}

/** The team's requests to the background investigator, newest first, with the reports that are back. */
coursesRouter.get('/:courseId/my-cases/:caseId/investigator', async (req, res) => {
  const ctx = await teamInvestigation(req, false)
  res.json({ investigations: ctx ? await teamInvestigations(ctx.caseId, ctx.teamId, ctx.userId) : [] })
})

/** Emails the investigator an assignment `{ assignment }`; his report reaches the team after the instructor's review. */
coursesRouter.post('/:courseId/my-cases/:caseId/investigator/requests', async (req, res) => {
  const ctx = (await teamInvestigation(req, true))!
  res.status(201).json({ investigations: await sendInvestigation(ctx, req.body) })
})

/** Marks the team's investigator reports as read by this student. */
coursesRouter.post('/:courseId/my-cases/:caseId/investigator/seen', async (req, res) => {
  const ctx = await teamInvestigation(req, false)
  if (ctx) await markReviewsSeen(ctx.caseId, ctx.teamId, ctx.userId, 'investigation')
  res.status(204).end()
})

/** The team's flags on things decided automatically (review lite), with the instructor's answers. */
coursesRouter.get('/:courseId/my-cases/:caseId/flags', async (req, res) => {
  const { courseId, caseId } = req.params
  await loadStudentWorkspace(courseId, caseId, req.user!.id)
  const teamId = await findStudentTeamId(caseId, req.user!.id)
  res.json({ flags: teamId ? await teamFlags(caseId, teamId, req.user!.id) : [] })
})

/** Flags something decided automatically for the instructor: `{ kind, targetId, reviewId, reason }`. */
coursesRouter.post('/:courseId/my-cases/:caseId/flags', async (req, res) => {
  const { courseId, caseId } = req.params
  const workspace = await loadStudentWorkspace(courseId, caseId, req.user!.id)
  if (workspace.case.status !== 'active') throw new HttpError(409, 'This case is closed.')
  const teamId = await findStudentTeamId(caseId, req.user!.id)
  if (!teamId) throw new HttpError(409, 'You need a team first.')
  res.status(201).json({ flags: await raiseFlag({ caseId, teamId, userId: req.user!.id }, req.body) })
})

/** Marks the instructor's answers to the team's flags as read by this student. */
coursesRouter.post('/:courseId/my-cases/:caseId/flags/seen', async (req, res) => {
  const { courseId, caseId } = req.params
  await loadStudentWorkspace(courseId, caseId, req.user!.id)
  const teamId = await findStudentTeamId(caseId, req.user!.id)
  if (teamId) await markFlagsSeen(caseId, teamId, req.user!.id)
  res.status(204).end()
})

coursesRouter.use('/:courseId/my-cases/:caseId/exchange', myExchangeRouter)
coursesRouter.use('/:courseId/calendar', calendarRouter)

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
courseRouter.use('/reviews', reviewsRouter)
courseRouter.use('/subpoenas', subpoenasRouter)

coursesRouter.use('/:courseId', courseRouter)
