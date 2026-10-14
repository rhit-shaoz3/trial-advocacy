import express, { Router, type Request, type Response } from 'express'
import { extname } from 'node:path'
import { requireUser } from '../auth/requireUser.ts'
import { findCourseForMember } from '../courses/courses.ts'
import {
  CONTENT_TYPES,
  MAX_FACT_PATTERN_BYTES,
  readFilename,
} from '../courses/factPatternRoutes.ts'
import { withTransaction } from '../db/transaction.ts'
import { HttpError } from '../httpError.ts'
import { isUuid, readString } from '../validation.ts'
import { loadCaseForInstructor, loadCaseForMember } from './access.ts'
import {
  addDocument,
  canStudentSeeDocument,
  CHARACTER_ROLES,
  createCase,
  createCharacter,
  deleteCharacter,
  deleteDocument,
  DOC_SIDES,
  findDocument,
  findDocumentFile,
  getInstructorCase,
  getStudentCase,
  listCourseCases,
  saveMatchups,
  saveTeams,
  setCharacterKnows,
  setDocumentSide,
  setPublished,
  SIDES,
  updateCharacter,
  type CharacterInput,
  type CharacterRole,
  type DocSide,
  type MatchupInput,
  type Section,
  type Side,
  type TeamInput,
} from './cases.ts'

const MAX_NAME_LENGTH = 100

function readName(body: unknown, key: string, label: string) {
  const value = readString(body, key).trim()
  if (!value) throw new HttpError(400, `${label} is required.`)
  if (value.length > MAX_NAME_LENGTH) {
    throw new HttpError(400, `${label} must be ${MAX_NAME_LENGTH} characters or fewer.`)
  }
  return value
}

function readDocSide(value: unknown) {
  const side = (typeof value === 'string' && value) || 'both'
  if (!DOC_SIDES.includes(side as DocSide)) {
    throw new HttpError(400, 'Side must be plaintiff, defendant or both.')
  }
  return side as DocSide
}

function readList(body: unknown, key: string) {
  const value = (body as Record<string, unknown> | undefined)?.[key]
  if (!Array.isArray(value)) throw new HttpError(400, `${key} must be a list.`)
  return value as unknown[]
}

function readTeams(body: unknown): TeamInput[] {
  return readList(body, 'teams').map((raw) => {
    const id = readString(raw, 'id')
    const side = readString(raw, 'side') as Side
    const studentIds = (raw as Record<string, unknown> | null)?.studentIds
    if (!SIDES.includes(side)) throw new HttpError(400, 'Each team must be plaintiff or defendant.')
    if (!Array.isArray(studentIds) || !studentIds.every(isUuid)) {
      throw new HttpError(400, 'studentIds must be a list of student ids.')
    }
    if (id && !isUuid(id)) throw new HttpError(400, 'One of these teams no longer exists.')
    return { ...(id && { id }), name: readString(raw, 'name').trim(), side, studentIds }
  })
}

function readMatchups(body: unknown): MatchupInput[] {
  return readList(body, 'matchups').map((raw) => {
    const plaintiffTeamId = readString(raw, 'plaintiffTeamId')
    const defendantTeamId = readString(raw, 'defendantTeamId')
    if (!isUuid(plaintiffTeamId) || !isUuid(defendantTeamId)) {
      throw new HttpError(400, 'Each matchup needs one plaintiff team and one defendant team.')
    }
    return { plaintiffTeamId, defendantTeamId }
  })
}

function readCharacter(body: unknown): CharacterInput {
  const role = readString(body, 'role') as CharacterRole
  if (!CHARACTER_ROLES.includes(role)) {
    throw new HttpError(400, 'Role must be witness or investigator.')
  }
  return {
    name: readName(body, 'name', 'Name'),
    title: readName(body, 'title', 'Title'),
    role,
    side: readDocSide(readString(body, 'side')),
  }
}

async function sendInstructorCase(req: Request, res: Response) {
  res.json({ case: await getInstructorCase(await loadCaseForInstructor(req)) })
}

/**
 * Mounted at /api/courses/:courseId/cases: the course's case list (for its
 * instructor and students) and creating a case.
 */
export const courseCasesRouter = Router({ mergeParams: true })

courseCasesRouter.get('/', async (req, res) => {
  const { courseId } = req.params as { courseId: string }
  const course = isUuid(courseId) ? await findCourseForMember(courseId, req.user!.id) : null
  if (!course) throw new HttpError(404, 'Course not found.')
  res.json({ cases: await listCourseCases(courseId, req.user!.role !== 'instructor') })
})

courseCasesRouter.post('/', async (req, res) => {
  const user = req.user!
  if (user.role !== 'instructor') throw new HttpError(403, 'Only instructors can do that.')
  const { courseId } = req.params as { courseId: string }
  const course = isUuid(courseId) ? await findCourseForMember(courseId, user.id) : null
  if (!course) throw new HttpError(404, 'Course not found.')
  const name = readName(req.body, 'name', 'Case name')
  res.status(201).json({ case: await createCase({ name, courseId, createdBy: user.id }) })
})

/** Mounted at /api/cases: everything about one case. */
export const casesRouter = Router()

casesRouter.use(requireUser)

casesRouter.get('/:caseId', async (req, res) => {
  if (req.user!.role === 'instructor') return sendInstructorCase(req, res)
  const c = await loadCaseForMember(req)
  res.json({ case: await getStudentCase(c, req.user!.id) })
})

casesRouter.patch('/:caseId/publish', async (req, res) => {
  const c = await loadCaseForInstructor(req)
  const changes: Partial<Record<Section, boolean>> = {}
  for (const section of ['documents', 'characters', 'teams'] as const) {
    const value = (req.body as Record<string, unknown> | undefined)?.[section]
    if (value === undefined) continue
    if (typeof value !== 'boolean') throw new HttpError(400, `${section} must be true or false.`)
    changes[section] = value
  }
  await setPublished(c.id, changes)
  await sendInstructorCase(req, res)
})

// ---- Documents ----

/**
 * Like fact patterns: the request body is the raw file, its name goes in the
 * X-Filename header, and `?side=` says who can see it.
 */
casesRouter.post(
  '/:caseId/documents',
  express.raw({ type: () => true, limit: MAX_FACT_PATTERN_BYTES }),
  async (req, res) => {
    const c = await loadCaseForInstructor(req)
    const filename = readFilename(req.get('X-Filename'))
    if (!filename) throw new HttpError(400, 'The file needs a name.')
    const contentType = CONTENT_TYPES[extname(filename).toLowerCase()]
    if (!contentType) throw new HttpError(415, 'Upload a PDF, Word document, or text file.')
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new HttpError(400, 'The file is empty.')
    }
    const document = await addDocument({
      caseId: c.id,
      filename,
      contentType,
      data: req.body,
      side: readDocSide(req.query.side),
      uploadedBy: req.user!.id,
    })
    res.status(201).json({ document })
  },
)

casesRouter.patch('/:caseId/documents/:documentId', async (req, res) => {
  const c = await loadCaseForInstructor(req)
  const doc = isUuid(req.params.documentId)
    ? await setDocumentSide(c.id, req.params.documentId, readDocSide(readString(req.body, 'side')))
    : null
  if (!doc) throw new HttpError(404, 'Document not found.')
  res.json({ document: doc })
})

casesRouter.delete('/:caseId/documents/:documentId', async (req, res) => {
  const c = await loadCaseForInstructor(req)
  if (!(await deleteDocument(c.id, req.params.documentId))) {
    throw new HttpError(404, 'Document not found.')
  }
  res.status(204).end()
})

casesRouter.get('/:caseId/documents/:documentId/file', async (req, res) => {
  const user = req.user!
  const c = await loadCaseForMember(req)
  const doc = await findDocument(c.id, req.params.documentId)
  const allowed = doc && (user.role === 'instructor' || (await canStudentSeeDocument(c, user.id, doc)))
  const file = allowed ? await findDocumentFile(c.id, doc.id) : null
  if (!file) throw new HttpError(404, 'Document not found.')

  // Always a download, never rendered in the page, so an uploaded file can't run script here.
  res.attachment(file.filename)
  res.set({ 'Content-Type': file.contentType, 'X-Content-Type-Options': 'nosniff' })
  res.send(file.data)
})

// ---- Characters ----

casesRouter.post('/:caseId/characters', async (req, res) => {
  const c = await loadCaseForInstructor(req)
  res.status(201).json({ character: await createCharacter(c.id, readCharacter(req.body)) })
})

casesRouter.patch('/:caseId/characters/:characterId', async (req, res) => {
  const c = await loadCaseForInstructor(req)
  const character = await updateCharacter(c.id, req.params.characterId, readCharacter(req.body))
  if (!character) throw new HttpError(404, 'Character not found.')
  res.json({ character })
})

casesRouter.delete('/:caseId/characters/:characterId', async (req, res) => {
  const c = await loadCaseForInstructor(req)
  if (!(await deleteCharacter(c.id, req.params.characterId))) {
    throw new HttpError(404, 'Character not found.')
  }
  res.status(204).end()
})

for (const [method, knows] of [['put', true], ['delete', false]] as const) {
  casesRouter[method]('/:caseId/characters/:characterId/documents/:documentId', async (req, res) => {
    const c = await loadCaseForInstructor(req)
    const { characterId, documentId } = req.params
    if (!(await setCharacterKnows(c.id, characterId, documentId, knows))) {
      throw new HttpError(404, 'Character or document not found.')
    }
    res.status(204).end()
  })
}

// ---- Teams and matchups ----

casesRouter.put('/:caseId/teams', async (req, res) => {
  const c = await loadCaseForInstructor(req)
  const teams = readTeams(req.body)
  await withTransaction((client) => saveTeams(client, c, teams))
  await sendInstructorCase(req, res)
})

casesRouter.put('/:caseId/matchups', async (req, res) => {
  const c = await loadCaseForInstructor(req)
  const matchups = readMatchups(req.body)
  await withTransaction((client) => saveMatchups(client, c.id, matchups))
  await sendInstructorCase(req, res)
})
