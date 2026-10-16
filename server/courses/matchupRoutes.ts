import { Router } from 'express'
import { HttpError } from '../httpError.ts'
import { isUuid, readString } from '../validation.ts'
import { autoMatch, clearMatchups, createMatchup, deleteMatchup, swapSides } from './matchups.ts'
import { assertOpen } from './teamRoutes.ts'

function readMatchupId(matchupId: string) {
  if (!isUuid(matchupId)) throw new HttpError(404, 'Case world not found.')
  return matchupId
}

/**
 * Mounted under /api/courses/:courseId/cases/:caseId/matchups, after the
 * course and case are loaded. Matchups are listed with the teams (GET
 * .../teams); every change here responds with that same shape.
 */
export const matchupsRouter = Router()

matchupsRouter.use(assertOpen)

matchupsRouter.post('/', async (req, res) => {
  const plaintiffTeamId = readString(req.body, 'plaintiffTeamId')
  const defenseTeamId = readString(req.body, 'defenseTeamId')
  if (!isUuid(plaintiffTeamId) || !isUuid(defenseTeamId)) {
    throw new HttpError(400, 'Choose a plaintiff team and a defense team.')
  }
  res
    .status(201)
    .json(await createMatchup(req.course!.id, req.courseCase!.id, plaintiffTeamId, defenseTeamId))
})

matchupsRouter.post('/auto', async (req, res) => {
  res.json(await autoMatch(req.course!.id, req.courseCase!.id))
})

matchupsRouter.delete('/', async (req, res) => {
  res.json(await clearMatchups(req.course!.id, req.courseCase!.id))
})

matchupsRouter.post('/:matchupId/swap', async (req, res) => {
  res.json(await swapSides(req.course!.id, req.courseCase!.id, readMatchupId(req.params.matchupId)))
})

matchupsRouter.delete('/:matchupId', async (req, res) => {
  res.json(await deleteMatchup(req.course!.id, req.courseCase!.id, readMatchupId(req.params.matchupId)))
})
