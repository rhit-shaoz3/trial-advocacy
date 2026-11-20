import { Router, type Request } from 'express'
import {
  endPractice,
  getPracticeSession,
  practiceContext,
  practiceOverview,
  startPractice,
  takePracticeTurn,
} from './practice.ts'

/** Mounted under /api/courses/:courseId/my-cases/:caseId/practice, for students; each sees only their own sessions. */
export const myPracticeRouter = Router({ mergeParams: true })

const context = (req: Request) => {
  const { courseId, caseId } = req.params as Record<string, string>
  return practiceContext(courseId, caseId, req.user!.id)
}

/** `{ limit, sessions }`: the student's sessions in the case, newest first, against the instructor's cap. */
myPracticeRouter.get('/', async (req, res) => {
  res.json(await practiceOverview(await context(req)))
})

/** Starts a session; answers with `{ session }`. */
myPracticeRouter.post('/', async (req, res) => {
  res.status(201).json({ session: await startPractice(await context(req), req.body) })
})

myPracticeRouter.get('/:sessionId', async (req, res) => {
  res.json({ session: await getPracticeSession(await context(req), req.params.sessionId as string) })
})

/** The student's next turn, `{ kind, text, exhibitIds? }`; answers with the session and its reply. */
myPracticeRouter.post('/:sessionId/turns', async (req, res) => {
  res.json({ session: await takePracticeTurn(await context(req), req.params.sessionId as string, req.body) })
})

myPracticeRouter.post('/:sessionId/end', async (req, res) => {
  res.json({ session: await endPractice(await context(req), req.params.sessionId as string) })
})
