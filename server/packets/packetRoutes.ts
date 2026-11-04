import { Router, type Request } from 'express'
import { phaseAtLeast } from '../courses/cases.ts'
import { HttpError } from '../httpError.ts'
import { isUuid } from '../validation.ts'
import { packetOverview, sendPackets } from './packets.ts'

/** The case, once it's reached the final steps phase. */
function finishedCase(req: Request) {
  const courseCase = req.courseCase!
  if (!phaseAtLeast(courseCase.phase, 'final_steps')) throw new HttpError(409, 'Trial packets open in the final steps phase.')
  return courseCase
}

/** Mounted under /api/courses/:courseId/cases/:caseId/packets, for the instructor (after `loadCase`). */
export const packetsRouter = Router({ mergeParams: true })

/** `{ packets }`: what each team's packet holds so far. */
packetsRouter.get('/', async (req, res) => {
  res.json({ packets: await packetOverview(req.course!.id, finishedCase(req), req.user!.id) })
})

/** Every team's packet in one zip, a folder for each. */
packetsRouter.get('/download', async (req, res) => {
  await sendPackets(res, req.course!.id, finishedCase(req), req.user!.id)
})

/** One team's packet, as a zip to hand to the team. */
packetsRouter.get('/:teamId/download', async (req, res) => {
  const courseCase = finishedCase(req)
  const teamId = req.params.teamId as string
  if (!isUuid(teamId)) throw new HttpError(404, 'Team not found.')
  await sendPackets(res, req.course!.id, courseCase, req.user!.id, teamId)
})
