import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import { extname } from 'node:path'
import { requireUser } from '../auth/requireUser.ts'
import { isInstructorOf } from '../classes/classes.ts'
import { withTransaction } from '../db/transaction.ts'
import { deleteFile, getFile } from '../files/fileStore.ts'
import { HttpError } from '../httpError.ts'
import { isUuid, readString } from '../validation.ts'
import { loadCaseForInstructor, loadCaseForStudent } from './access.ts'
import {
  addDocuments,
  canStudentSeeDocument,
  CHARACTER_ROLES,
  createCase,
  createCharacter,
  deleteCharacter,
  deleteDocument,
  DOC_SIDES,
  findDocument,
  getInstructorCase,
  getStudentCase,
  listInstructorCases,
  listStudentCases,
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
export const MAX_FILE_MB = 20
const MAX_FILES = 20
export const ALLOWED_EXTENSIONS = [
  '.pdf', '.doc', '.docx', '.txt', '.rtf', '.png', '.jpg', '.jpeg', '.xlsx', '.csv',
]

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: MAX_FILES },
  defParamCharset: 'utf8', // keep non-English file names intact
  fileFilter(_req, file, accept) {
    if (ALLOWED_EXTENSIONS.includes(extname(file.originalname).toLowerCase())) {
      accept(null, true)
    } else {
      accept(
        new HttpError(400, `${file.originalname} isn't a supported file type. Use ${ALLOWED_EXTENSIONS.join(', ')}.`),
      )
    }
  },
})

function readName(body: unknown, key: string, label: string) {
  const value = readString(body, key).trim()
  if (!value) throw new HttpError(400, `${label} is required.`)
  if (value.length > MAX_NAME_LENGTH) {
    throw new HttpError(400, `${label} must be ${MAX_NAME_LENGTH} characters or fewer.`)
  }
  return value
}

function readDocSide(body: unknown) {
  const side = readString(body, 'side') || 'both'
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
    if (!Array.isArray(studentIds) || !studentIds.every((s) => typeof s === 'string' && isUuid(s))) {
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

async function sendInstructorCase(req: Request, res: Response) {
  const { case: c } = await loadCaseForInstructor(req)
  res.json({ case: await getInstructorCase(c) })
}

export const casesRouter = Router()

casesRouter.get('/', async (req, res) => {
  const user = await requireUser(req)
  const cases =
    user.role === 'instructor'
      ? await listInstructorCases(user.id)
      : await listStudentCases(user.id)
  res.json({ cases })
})

casesRouter.post('/', async (req, res) => {
  const instructor = await requireUser(req, 'instructor')
  const name = readName(req.body, 'name', 'Case name')
  const classId = readString(req.body, 'classId')
  if (!isUuid(classId) || !(await isInstructorOf(classId, instructor.id))) {
    throw new HttpError(400, 'Choose one of your classes.')
  }
  res.status(201).json({ case: await createCase({ name, classId, createdBy: instructor.id }) })
})

casesRouter.get('/:caseId', async (req, res) => {
  const user = await requireUser(req)
  if (user.role === 'instructor') return sendInstructorCase(req, res)
  const { case: c } = await loadCaseForStudent(req)
  res.json({ case: await getStudentCase(c, user.id) })
})

casesRouter.patch('/:caseId/publish', async (req, res) => {
  const { case: c } = await loadCaseForInstructor(req)
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

casesRouter.post(
  '/:caseId/documents',
  async (req, _res, next) => {
    await loadCaseForInstructor(req) // check before accepting any upload
    next()
  },
  upload.array('files', MAX_FILES),
  async (req, res) => {
    const { case: c } = await loadCaseForInstructor(req)
    const files = (req.files as Express.Multer.File[] | undefined) ?? []
    if (files.length === 0) throw new HttpError(400, 'Choose at least one file to upload.')
    const side = readDocSide(req.body)
    const documents = await withTransaction((client) =>
      addDocuments(
        client,
        c.id,
        files.map((f) => ({ filename: f.originalname, contentType: f.mimetype, content: f.buffer })),
        side,
      ),
    )
    res.status(201).json({ documents })
  },
)

casesRouter.patch('/:caseId/documents/:documentId', async (req, res) => {
  const { case: c } = await loadCaseForInstructor(req)
  const doc = isUuid(req.params.documentId)
    ? await setDocumentSide(c.id, req.params.documentId, readDocSide(req.body))
    : null
  if (!doc) throw new HttpError(404, 'Document not found.')
  res.json({ document: doc })
})

casesRouter.delete('/:caseId/documents/:documentId', async (req, res) => {
  const { case: c } = await loadCaseForInstructor(req)
  const deleted = await withTransaction(async (client) => {
    const key = await deleteDocument(client, c.id, req.params.documentId)
    if (key) await deleteFile(client, key)
    return key !== null
  })
  if (!deleted) throw new HttpError(404, 'Document not found.')
  res.status(204).end()
})

casesRouter.get('/:caseId/documents/:documentId/file', async (req, res) => {
  const user = await requireUser(req)
  const { case: c } =
    user.role === 'instructor' ? await loadCaseForInstructor(req) : await loadCaseForStudent(req)
  const doc = await findDocument(c.id, req.params.documentId)
  const allowed = doc && (user.role === 'instructor' || (await canStudentSeeDocument(c, user.id, doc)))
  const content = allowed ? await getFile(doc.storage_key) : null
  if (!doc || !content) throw new HttpError(404, 'Document not found.')

  // Sets Content-Type from the (allow-listed) extension and forces a download,
  // so an uploaded file can never run as a page on our site.
  res.attachment(doc.filename)
  res.set('X-Content-Type-Options', 'nosniff')
  res.send(content)
})

// ---- Characters ----

function readCharacter(body: unknown): CharacterInput {
  const role = readString(body, 'role') as CharacterRole
  if (!CHARACTER_ROLES.includes(role)) {
    throw new HttpError(400, 'Role must be witness or investigator.')
  }
  return {
    name: readName(body, 'name', 'Name'),
    title: readName(body, 'title', 'Title'),
    role,
    side: readDocSide(body),
  }
}

casesRouter.post('/:caseId/characters', async (req, res) => {
  const { case: c } = await loadCaseForInstructor(req)
  res.status(201).json({ character: await createCharacter(c.id, readCharacter(req.body)) })
})

casesRouter.patch('/:caseId/characters/:characterId', async (req, res) => {
  const { case: c } = await loadCaseForInstructor(req)
  const character = await updateCharacter(c.id, req.params.characterId, readCharacter(req.body))
  if (!character) throw new HttpError(404, 'Character not found.')
  res.json({ character })
})

casesRouter.delete('/:caseId/characters/:characterId', async (req, res) => {
  const { case: c } = await loadCaseForInstructor(req)
  if (!(await deleteCharacter(c.id, req.params.characterId))) {
    throw new HttpError(404, 'Character not found.')
  }
  res.status(204).end()
})

for (const [method, knows] of [['put', true], ['delete', false]] as const) {
  casesRouter[method]('/:caseId/characters/:characterId/documents/:documentId', async (req, res) => {
    const { case: c } = await loadCaseForInstructor(req)
    const { characterId, documentId } = req.params
    if (!(await setCharacterKnows(c.id, characterId, documentId, knows))) {
      throw new HttpError(404, 'Character or document not found.')
    }
    res.status(204).end()
  })
}

// ---- Teams and matchups ----

casesRouter.put('/:caseId/teams', async (req, res) => {
  const { case: c } = await loadCaseForInstructor(req)
  const teams = readTeams(req.body)
  await withTransaction((client) => saveTeams(client, c, teams))
  await sendInstructorCase(req, res)
})

casesRouter.put('/:caseId/matchups', async (req, res) => {
  const { case: c } = await loadCaseForInstructor(req)
  const matchups = readMatchups(req.body)
  await withTransaction((client) => saveMatchups(client, c.id, matchups))
  await sendInstructorCase(req, res)
})
