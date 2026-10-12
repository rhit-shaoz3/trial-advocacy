import { Router } from 'express'
import { requireUser } from '../auth/requireUser.ts'
import { pool } from '../db/pool.ts'
import { withTransaction } from '../db/transaction.ts'
import { HttpError } from '../httpError.ts'
import { EMAIL_PATTERN, isUuid, readString, readStringArray } from '../validation.ts'
import {
  acceptInvitation,
  admitRequests,
  CLASS_NOT_FOUND,
  createClass,
  denyRequests,
  dismissDenial,
  findClassByCode,
  getStudentInbox,
  isInstructorOf,
  joinClass,
  listInstructorClasses,
  listStudentClasses,
  rejectInvitation,
} from './classes.ts'
import { normalizeJoinCode } from './joinCode.ts'

const MAX_NAME_LENGTH = 100
const MAX_INVITES = 1000

export const classesRouter = Router()

classesRouter.get('/', async (req, res) => {
  const user = await requireUser(req)
  const classes =
    user.role === 'instructor'
      ? await listInstructorClasses(user.id)
      : await listStudentClasses(user.id)
  res.json({ classes })
})

classesRouter.post('/', async (req, res) => {
  const instructor = await requireUser(req, 'instructor')
  const name = readString(req.body, 'name').trim()
  const rawEmails = readStringArray(req.body, 'studentEmails')

  if (!name) throw new HttpError(400, 'Class name is required.')
  if (name.length > MAX_NAME_LENGTH) {
    throw new HttpError(400, `Class name must be ${MAX_NAME_LENGTH} characters or fewer.`)
  }
  if (!rawEmails) throw new HttpError(400, 'studentEmails must be a list of email addresses.')

  const emails = [...new Set(rawEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))]
  const invalid = emails.filter((e) => !EMAIL_PATTERN.test(e))
  if (invalid.length) {
    throw new HttpError(400, `These aren't valid email addresses: ${invalid.join(', ')}`)
  }
  if (emails.length > MAX_INVITES) {
    throw new HttpError(400, `You can invite up to ${MAX_INVITES} students at once.`)
  }

  const result = await withTransaction((client) =>
    createClass(client, { name, instructorId: instructor.id, emails }),
  )
  res.status(201).json(result)
})

classesRouter.post('/join', async (req, res) => {
  const student = await requireUser(req, 'student')
  const code = normalizeJoinCode(readString(req.body, 'code'))

  const cls = code ? await findClassByCode(pool, code) : null
  if (!cls) throw new HttpError(404, CLASS_NOT_FOUND)

  const result = await withTransaction((client) => joinClass(client, cls, student))
  res.json(result)
})

classesRouter.post('/:id/requests', async (req, res) => {
  const instructor = await requireUser(req, 'instructor')
  const classId = req.params.id
  if (!isUuid(classId) || !(await isInstructorOf(classId, instructor.id))) {
    throw new HttpError(404, 'Class not found.')
  }

  const userIds = readStringArray(req.body, 'userIds')
  const decision = readString(req.body, 'decision')
  if (!userIds?.length || !userIds.every(isUuid)) {
    throw new HttpError(400, 'Choose at least one student.')
  }
  if (decision !== 'admit' && decision !== 'deny') {
    throw new HttpError(400, 'Decision must be admit or deny.')
  }

  const updated =
    decision === 'admit'
      ? await admitRequests(classId, userIds)
      : await denyRequests(classId, userIds)
  res.json({ updated })
})

classesRouter.get('/inbox', async (req, res) => {
  const student = await requireUser(req, 'student')
  res.json(await getStudentInbox(student))
})

classesRouter.post('/invitations/:id/accept', async (req, res) => {
  const student = await requireUser(req, 'student')
  const id = req.params.id
  const accepted =
    isUuid(id) && (await withTransaction((client) => acceptInvitation(client, id, student)))
  if (!accepted) throw new HttpError(404, 'Invitation not found.')
  res.status(204).end()
})

classesRouter.post('/invitations/:id/reject', async (req, res) => {
  const student = await requireUser(req, 'student')
  const id = req.params.id
  if (!isUuid(id) || !(await rejectInvitation(id, student.email))) {
    throw new HttpError(404, 'Invitation not found.')
  }
  res.status(204).end()
})

classesRouter.post('/denials/:classId/dismiss', async (req, res) => {
  const student = await requireUser(req, 'student')
  if (isUuid(req.params.classId)) await dismissDenial(req.params.classId, student.id)
  res.status(204).end()
})
