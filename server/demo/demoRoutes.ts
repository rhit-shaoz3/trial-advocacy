import { Router } from 'express'
import { presentUser } from '../auth/present.ts'
import { requireUser } from '../auth/requireUser.ts'
import { findUserById } from '../auth/users.ts'
import { HttpError } from '../httpError.ts'
import { demoAccount, resetDemo, type DemoRole } from './demo.ts'
import { DEMO_SUBPOENA, DEPOSITION, LIVE_QUESTIONS } from './script.ts'

/** Mounted under /api/demo; only for a demo session (see demo.ts). */
export const demoRouter = Router()

demoRouter.use(requireUser, (req, _res, next) => {
  if (!req.session.demo) throw new HttpError(404, 'Not found.')
  next()
})

/** `{ as: instructor | student }`: switches the session to that account; responds with the user, like /auth/me. */
demoRouter.post('/switch', async (req, res) => {
  const as = (req.body as Record<string, unknown> | undefined)?.as
  if (as !== 'instructor' && as !== 'student') throw new HttpError(400, 'Choose instructor or student.')
  const id = await demoAccount(as as DemoRole)
  req.session.userId = id
  await new Promise<void>((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())))
  res.json({ user: await presentUser(req, (await findUserById(id))!) })
})

/** What the demo fills in: the subpoena, and the deposition questions asked live. */
demoRouter.get('/script', (_req, res) => {
  res.json({ script: { subpoena: DEMO_SUBPOENA, questions: DEPOSITION.slice(0, LIVE_QUESTIONS).map((t) => t.question) } })
})

/** Rebuilds the demo case world; responds with the user, whose demo details name the new case. */
demoRouter.post('/reset', async (req, res) => {
  await resetDemo()
  res.json({ user: await presentUser(req, req.user!) })
})
