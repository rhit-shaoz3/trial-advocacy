import { Router, type Request } from 'express'
import { findCase, phaseAtLeast } from '../courses/cases.ts'
import { studentTeam } from '../exhibits/exhibitRoutes.ts'
import { HttpError } from '../httpError.ts'
import { isUuid } from '../validation.ts'
import { listCourtBinders, packetContents, packetOpen, packetOverview, sendCourtBinder, readFolders, savePacketFolders, sendPacketPdf, sendPackets } from './packets.ts'

/** The case, once it's reached the final steps phase. */
function finishedCase(req: Request) {
  const courseCase = req.courseCase!
  if (!phaseAtLeast(courseCase.phase, 'final_steps')) throw new HttpError(409, 'Trial packets open in the final steps phase.')
  return courseCase
}

function teamIdOf(req: Request) {
  const teamId = req.params.teamId as string
  if (!isUuid(teamId)) throw new HttpError(404, 'Team not found.')
  return teamId
}

/** Mounted under /api/courses/:courseId/cases/:caseId/packets, for the instructor (after `loadCase`). */
export const packetsRouter = Router({ mergeParams: true })

/** `{ packets }`: what each team's packet holds so far. */
packetsRouter.get('/', async (req, res) => {
  res.json({ packets: await packetOverview(req.course!.id, finishedCase(req), req.user!.id) })
})

/** `{ binders }`: each case world's court binder, and whether it's ready (its joint exhibit list is final). */
packetsRouter.get('/binders', async (req, res) => {
  res.json({ binders: await listCourtBinders(finishedCase(req).id) })
})

/** A case world's court binder, as one PDF. */
packetsRouter.get('/binders/:matchupId', async (req, res) => {
  const courseCase = finishedCase(req)
  const matchupId = req.params.matchupId as string
  if (!isUuid(matchupId)) throw new HttpError(404, 'Case world not found.')
  await sendCourtBinder(res, courseCase, matchupId)
})

/** Every team's packet in one zip, a folder for each. */
packetsRouter.get('/download', async (req, res) => {
  await sendPackets(res, req.course!.id, finishedCase(req), req.user!.id)
})

/** One team's packet, as a zip to hand to the team. */
packetsRouter.get('/:teamId/download', async (req, res) => {
  const courseCase = finishedCase(req)
  await sendPackets(res, req.course!.id, courseCase, req.user!.id, teamIdOf(req))
})

/** `{ contents }`: what can go in a team's PDF, and how the team filed it. */
packetsRouter.get('/:teamId/contents', async (req, res) => {
  const courseCase = finishedCase(req)
  res.json({ contents: await packetContents(req.course!.id, courseCase, req.user!.id, teamIdOf(req)) })
})

/** One team's packet as a single PDF, in the team's folders. */
packetsRouter.get('/:teamId/pdf', async (req, res) => {
  const courseCase = finishedCase(req)
  await sendPacketPdf(res, req.course!.id, courseCase, req.user!.id, teamIdOf(req))
})

/** The student's team and case, once the team has submitted its exhibit list; null before that. */
async function studentPacket(req: Request, changing = false) {
  const team = await studentTeam(req, changing)
  if (!team || !(await packetOpen(team.matchupId, team.side))) return null
  const courseCase = await findCase(req.params.courseId as string, team.caseId)
  return courseCase && { courseId: req.params.courseId as string, courseCase, team }
}

async function openPacket(req: Request, changing = false) {
  const packet = await studentPacket(req, changing)
  if (!packet) throw new HttpError(409, 'Your trial packet opens once your team submits its exhibit list.')
  return packet
}

/** Mounted under /api/courses/:courseId/my-cases/:caseId/packet, for students. */
export const myPacketRouter = Router({ mergeParams: true })

/** `{ contents }`: what can go in the team's PDF; null until the team submits its list. */
myPacketRouter.get('/', async (req, res) => {
  const packet = await studentPacket(req)
  res.json({ contents: packet && (await packetContents(packet.courseId, packet.courseCase, req.user!.id, packet.team.teamId)) })
})

/** Keeps how the team filed its PDF: `{ folders: [{ name, items: [id] }] }`. */
myPacketRouter.put('/folders', async (req, res) => {
  const { team } = await openPacket(req, true)
  await savePacketFolders(team.teamId, readFolders(req.body))
  res.status(204).end()
})

/** The team's whole packet as a zip. */
myPacketRouter.get('/download', async (req, res) => {
  const { courseId, courseCase, team } = await openPacket(req)
  await sendPackets(res, courseId, courseCase, req.user!.id, team.teamId)
})

/** The team's packet as a single PDF, in its folders. */
myPacketRouter.get('/pdf', async (req, res) => {
  const { courseId, courseCase, team } = await openPacket(req)
  await sendPacketPdf(res, courseId, courseCase, req.user!.id, team.teamId)
})
