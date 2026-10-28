import { Router } from 'express'
import { HttpError } from '../httpError.ts'
import { isUuid, readString } from '../validation.ts'
import { answerSubpoena, listCourseSubpoenas, SUBPOENA_OUTCOMES, type SubpoenaOutcome } from './subpoenas.ts'

/** Mounted under /api/courses/:courseId/subpoenas, for the instructor who teaches the course. */
export const subpoenasRouter = Router({ mergeParams: true })

/** `?status=open` (the default: still to answer) or `?status=completed`. */
subpoenasRouter.get('/', async (req, res) => {
  const which = req.query.status === 'completed' ? 'completed' : 'open'
  res.json({ subpoenas: await listCourseSubpoenas(req.course!.id, which) })
})

/** The answer, once: `{ outcome: 'complied' | 'quashed', response, materialIds }`. */
subpoenasRouter.post('/:subpoenaId/answer', async (req, res) => {
  if (!isUuid(req.params.subpoenaId)) throw new HttpError(404, 'Subpoena not found.')
  const outcome = readString(req.body, 'outcome') as SubpoenaOutcome
  if (!SUBPOENA_OUTCOMES.includes(outcome)) throw new HttpError(400, 'Choose complied or quashed.')
  const materialIds = (req.body as Record<string, unknown> | undefined)?.materialIds ?? []
  if (!Array.isArray(materialIds) || !materialIds.every(isUuid)) throw new HttpError(400, 'Produce files from this case.')
  const subpoena = await answerSubpoena(req.course!.id, req.params.subpoenaId, req.user!.id, {
    outcome,
    response: readString(req.body, 'response'),
    materialIds: materialIds as string[],
  })
  res.json({ subpoena })
})
