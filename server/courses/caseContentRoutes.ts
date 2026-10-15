import { Router, type Response } from 'express'
import { randomUUID } from 'node:crypto'
import { extname } from 'node:path'
import { HttpError } from '../httpError.ts'
import { KEY_PATTERN, MAX_UPLOAD_BYTES } from '../storage/shared.ts'
import { storage } from '../storage/storage.ts'
import { isUuid, readString } from '../validation.ts'
import {
  AUDIENCES,
  createMaterial,
  createTask,
  createWitness,
  deleteMaterial,
  deleteTask,
  deleteWitness,
  findMaterialFile,
  listMaterials,
  listTasks,
  listWitnesses,
  removeStoredFiles,
  updateMaterial,
  updateTask,
  updateWitness,
  type Audience,
  type TaskFields,
  type WitnessFields,
} from './caseContent.ts'

const MAX_FILENAME_LENGTH = 200
const MAX_NAME_LENGTH = 120
const MAX_TEXT_LENGTH = 4000

// Decided by file extension, not the browser-supplied type, and stored with
// the file so downloads are served with a known-safe type.
const CONTENT_TYPES: Record<string, string> = {
  // Documents
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain; charset=utf-8',
  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  // Audio
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  // Video
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
}

function readChoice<T extends string>(value: unknown, choices: readonly T[], fallback: T | undefined, error: string): T {
  const text = typeof value === 'string' && value ? value : fallback
  if (!text || !choices.includes(text as T)) throw new HttpError(400, error)
  return text as T
}

const readAudience = (value: unknown, fallback?: Audience) =>
  readChoice(value, AUDIENCES, fallback, 'Choose who can see it: everyone, plaintiff, or defense.')

function readText(body: unknown, key: string, label: string, max = MAX_TEXT_LENGTH) {
  const text = readString(body, key).trim()
  if (text.length > max) throw new HttpError(400, `${label} must be at most ${max} characters.`)
  return text
}

function readId(id: string, notFound: string) {
  if (!isUuid(id)) throw new HttpError(404, notFound)
  return id
}

/**
 * Redirects to a short-lived download link from storage. Files are always
 * served as attachments, never rendered in the page, so an upload can't run
 * script here. Files from before object storage are sent from the database.
 */
export async function sendMaterialFile(res: Response, file: Awaited<ReturnType<typeof findMaterialFile>>) {
  if (!file) throw new HttpError(404, 'File not found.')
  if (file.storageKey) {
    res.redirect(302, await storage.downloadUrl(file.storageKey, file.filename, file.contentType))
    return
  }
  res.attachment(file.filename)
  res.set({ 'Content-Type': file.contentType, 'X-Content-Type-Options': 'nosniff' })
  res.send(file.data)
}

/** Mounted under /api/courses/:courseId/cases/:caseId/materials, after the course and case are loaded. */
export const materialsRouter = Router()

materialsRouter.get('/', async (req, res) => {
  res.json({ materials: await listMaterials(req.courseCase!.id) })
})

/** Validates a file name from the client: its base name, and a type we accept. */
function readFilename(body: unknown) {
  // Keep just the base name, without any folder the browser included.
  const filename = readString(body, 'filename').split(/[\\/]/).pop()!.trim().slice(-MAX_FILENAME_LENGTH)
  if (!filename) throw new HttpError(400, 'The file needs a name.')
  const contentType = CONTENT_TYPES[extname(filename).toLowerCase()]
  if (!contentType) {
    throw new HttpError(415, 'Upload a document (PDF, Word, text), image, audio, or video file.')
  }
  return { filename, contentType }
}

const tooLarge = () => new HttpError(413, `That file is too large. The limit is ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`)

/**
 * Step 1 of an upload, `{ filename, size }`: returns a signed URL the browser
 * PUTs the file to (straight to S3 in production), valid for 15 minutes.
 */
materialsRouter.post('/uploads', async (req, res) => {
  const { contentType } = readFilename(req.body)
  const size = (req.body as Record<string, unknown> | undefined)?.size
  if (!Number.isInteger(size) || (size as number) <= 0) throw new HttpError(400, 'The file is empty.')
  if ((size as number) > MAX_UPLOAD_BYTES) throw tooLarge()

  const key = `uploads/${req.courseCase!.id}/${randomUUID()}`
  const { url, headers } = await storage.uploadTarget(key, contentType, size as number)
  res.status(201).json({ upload: { key, url, headers } })
})

/**
 * Step 2, after the browser's PUT succeeds: `{ uploadKey, filename,
 * audience?, description? }` adds the uploaded file to the case file.
 */
materialsRouter.post('/', async (req, res) => {
  const caseId = req.courseCase!.id
  const { filename, contentType } = readFilename(req.body)
  const uploadKey = readString(req.body, 'uploadKey')
  // Only uploads started for this case can be added to it.
  if (!uploadKey.startsWith(`uploads/${caseId}/`) || !KEY_PATTERN.test(uploadKey)) {
    throw new HttpError(400, 'That upload is not for this case.')
  }
  const size = await storage.size(uploadKey)
  if (size === null) throw new HttpError(400, 'The upload did not finish. Try again.')
  if (size > MAX_UPLOAD_BYTES) {
    await storage.delete([uploadKey])
    throw tooLarge()
  }

  const id = randomUUID()
  const storageKey = `cases/${caseId}/${id}`
  await storage.move(uploadKey, storageKey)
  const material = await createMaterial({
    id,
    caseId,
    audience: readAudience((req.body as Record<string, unknown>).audience, 'all'),
    filename,
    description: readText(req.body, 'description', 'Description'),
    contentType,
    sizeBytes: size,
    storageKey,
    uploadedBy: req.user!.id,
  })
  res.status(201).json({ material })
})

materialsRouter.patch('/:materialId', async (req, res) => {
  const id = readId(req.params.materialId, 'File not found.')
  const material = await updateMaterial(req.courseCase!.id, id, {
    audience: readAudience(req.body?.audience),
    description: readText(req.body, 'description', 'Description'),
  })
  if (!material) throw new HttpError(404, 'File not found.')
  res.json({ material })
})

materialsRouter.get('/:materialId/file', async (req, res) => {
  const id = readId(req.params.materialId, 'File not found.')
  await sendMaterialFile(res, await findMaterialFile(req.courseCase!.id, id))
})

materialsRouter.delete('/:materialId', async (req, res) => {
  const id = readId(req.params.materialId, 'File not found.')
  const deleted = await deleteMaterial(req.courseCase!.id, id)
  if (deleted === false) throw new HttpError(404, 'File not found.')
  if (deleted) await removeStoredFiles([deleted])
  res.status(204).end()
})

function readWitness(body: unknown): WitnessFields {
  const name = readText(body, 'name', 'Name', MAX_NAME_LENGTH)
  if (!name) throw new HttpError(400, 'Witness name is required.')
  return {
    name,
    role: readText(body, 'role', 'Role', MAX_NAME_LENGTH),
    description: readText(body, 'description', 'Description'),
    audience: readAudience((body as Record<string, unknown> | undefined)?.audience, 'all'),
  }
}

/** Mounted under /api/courses/:courseId/cases/:caseId/witnesses. */
export const witnessesRouter = Router()

witnessesRouter.get('/', async (req, res) => {
  res.json({ witnesses: await listWitnesses(req.courseCase!.id) })
})

witnessesRouter.post('/', async (req, res) => {
  res.status(201).json({ witness: await createWitness(req.courseCase!.id, readWitness(req.body)) })
})

witnessesRouter.put('/:witnessId', async (req, res) => {
  const id = readId(req.params.witnessId, 'Witness not found.')
  const witness = await updateWitness(req.courseCase!.id, id, readWitness(req.body))
  if (!witness) throw new HttpError(404, 'Witness not found.')
  res.json({ witness })
})

witnessesRouter.delete('/:witnessId', async (req, res) => {
  const id = readId(req.params.witnessId, 'Witness not found.')
  if (!(await deleteWitness(req.courseCase!.id, id))) throw new HttpError(404, 'Witness not found.')
  res.status(204).end()
})

function readTask(body: unknown): TaskFields {
  const title = readText(body, 'title', 'Title', MAX_NAME_LENGTH)
  if (!title) throw new HttpError(400, 'Task title is required.')
  const due = (body as Record<string, unknown> | undefined)?.dueAt
  let dueAt: Date | null = null
  if (due !== undefined && due !== null && due !== '') {
    dueAt = typeof due === 'string' ? new Date(due) : new Date(NaN)
    if (Number.isNaN(dueAt.getTime())) throw new HttpError(400, 'Enter a valid due date.')
  }
  return {
    title,
    description: readText(body, 'description', 'Details'),
    dueAt,
    audience: readAudience((body as Record<string, unknown> | undefined)?.audience, 'all'),
  }
}

/** Mounted under /api/courses/:courseId/cases/:caseId/tasks. */
export const tasksRouter = Router()

tasksRouter.get('/', async (req, res) => {
  res.json({ tasks: await listTasks(req.courseCase!.id) })
})

tasksRouter.post('/', async (req, res) => {
  res.status(201).json({ task: await createTask(req.courseCase!.id, readTask(req.body)) })
})

tasksRouter.put('/:taskId', async (req, res) => {
  const id = readId(req.params.taskId, 'Task not found.')
  const task = await updateTask(req.courseCase!.id, id, readTask(req.body))
  if (!task) throw new HttpError(404, 'Task not found.')
  res.json({ task })
})

tasksRouter.delete('/:taskId', async (req, res) => {
  const id = readId(req.params.taskId, 'Task not found.')
  if (!(await deleteTask(req.courseCase!.id, id))) throw new HttpError(404, 'Task not found.')
  res.status(204).end()
})
