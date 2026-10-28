import { Router, type Request } from 'express'
import { HttpError } from '../httpError.ts'
import { isUuid, readString } from '../validation.ts'
import { approveSubpoena, denySubpoena, listCourseSubpoenas, redraftSubpoena } from './subpoenas.ts'

/** Mounted under /api/courses/:courseId/subpoenas, for the instructor who teaches the course. */
export const subpoenasRouter = Router({ mergeParams: true })

const subpoenaId = (req: Request) => {
  const id = String(req.params.subpoenaId)
  if (!isUuid(id)) throw new HttpError(404, 'Subpoena not found.')
  return id
}

/** `?status=open` (the default: still to answer) or `?status=completed`. */
subpoenasRouter.get('/', async (req, res) => {
  const which = req.query.status === 'completed' ? 'completed' : 'open'
  res.json({ subpoenas: await listCourseSubpoenas(req.course!.id, which) })
})

/** Sends the team the response: `{ response }`, the draft as drafted or edited. */
subpoenasRouter.post('/:subpoenaId/approve', async (req, res) => {
  const subpoena = await approveSubpoena(req.course!.id, subpoenaId(req), req.user!.id, readString(req.body, 'response'))
  res.json({ subpoena })
})

/** Denies the subpoena: `{ note }`, optional, for the team. */
subpoenasRouter.post('/:subpoenaId/deny', async (req, res) => {
  const subpoena = await denySubpoena(req.course!.id, subpoenaId(req), req.user!.id, readString(req.body, 'note'))
  res.json({ subpoena })
})

/** Drafts the response again: `{ instructions, createNew }`; also retries a failed draft. */
subpoenasRouter.post('/:subpoenaId/redraft', async (req, res) => {
  const subpoena = await redraftSubpoena(req.course!.id, subpoenaId(req), {
    instructions: readString(req.body, 'instructions'),
    createNew: (req.body as Record<string, unknown> | undefined)?.createNew === true,
  })
  res.json({ subpoena })
})
