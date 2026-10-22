import { Router, type RequestHandler } from 'express'
import { HttpError } from '../httpError.ts'
import { isUuid, readString } from '../validation.ts'
import {
  addMember,
  autoPair,
  clearTeams,
  createTeam,
  deleteTeam,
  listTeams,
  MAX_AUTO_TEAM_SIZE,
  MAX_TEAM_SIZE,
  MIN_AUTO_TEAM_SIZE,
  removeMember,
} from './teams.ts'

/** Roster emails are stored lowercase. */
const normalize = (email: string) => email.trim().toLowerCase()

function readEmails(body: unknown) {
  const value = (body as Record<string, unknown> | undefined)?.emails
  if (!Array.isArray(value) || !value.every((e) => typeof e === 'string')) {
    throw new HttpError(400, 'Send the students as a list of emails.')
  }
  const emails = [...new Set(value.map(normalize))].filter(Boolean)
  if (emails.length === 0) throw new HttpError(400, 'Choose at least one student.')
  if (emails.length > MAX_TEAM_SIZE) {
    throw new HttpError(400, `A team can have at most ${MAX_TEAM_SIZE} students.`)
  }
  return emails
}

function readTeamId(teamId: string) {
  if (!isUuid(teamId)) throw new HttpError(404, 'Team not found.')
  return teamId
}

/** A closed case keeps its teams and worlds as pairing history, so they can't change. */
export const assertOpen: RequestHandler = (req, _res, next) => {
  if (req.courseCase!.status === 'closed') {
    throw new HttpError(409, 'This case is closed, so its teams and case worlds can no longer change.')
  }
  next()
}

/**
 * Mounted under /api/courses/:courseId/cases/:caseId/teams, after the course
 * and case are loaded. Every change responds with the case's teams and the
 * students still unpaired, like GET.
 */
export const teamsRouter = Router()

teamsRouter.get('/', async (req, res) => {
  res.json(await listTeams(req.course!.id, req.courseCase!.id))
})

teamsRouter.use(assertOpen)

teamsRouter.post('/', async (req, res) => {
  res.status(201).json(await createTeam(req.course!.id, req.courseCase!.id, readEmails(req.body)))
})

/** `{ teamSize }` (default 2): how many students per team. Students left over stay off a team. */
teamsRouter.post('/auto', async (req, res) => {
  const value = (req.body as Record<string, unknown> | undefined)?.teamSize ?? MIN_AUTO_TEAM_SIZE
  const teamSize = Number(value)
  if (!Number.isInteger(teamSize) || teamSize < MIN_AUTO_TEAM_SIZE || teamSize > MAX_AUTO_TEAM_SIZE) {
    throw new HttpError(400, `Choose ${MIN_AUTO_TEAM_SIZE} to ${MAX_AUTO_TEAM_SIZE} students per team.`)
  }
  res.json(await autoPair(req.course!.id, req.courseCase!.id, teamSize))
})

teamsRouter.delete('/', async (req, res) => {
  res.json(await clearTeams(req.course!.id, req.courseCase!.id))
})

teamsRouter.delete('/:teamId', async (req, res) => {
  res.json(await deleteTeam(req.course!.id, req.courseCase!.id, readTeamId(req.params.teamId)))
})

teamsRouter.post('/:teamId/members', async (req, res) => {
  const email = normalize(readString(req.body, 'email'))
  if (!email) throw new HttpError(400, 'Choose a student.')
  res.json(await addMember(req.course!.id, req.courseCase!.id, readTeamId(req.params.teamId), email))
})

teamsRouter.delete('/:teamId/members/:email', async (req, res) => {
  const { teamId, email } = req.params
  res.json(await removeMember(req.course!.id, req.courseCase!.id, readTeamId(teamId), normalize(email)))
})
