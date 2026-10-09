import express, { Router } from 'express'
import { extname } from 'node:path'
import { HttpError } from '../httpError.ts'
import { isUuid } from '../validation.ts'
import {
  createFactPattern,
  deleteFactPattern,
  findFactPatternFile,
  listFactPatterns,
} from './factPatterns.ts'

export const MAX_FACT_PATTERN_BYTES = 10 * 1024 * 1024 // 10 MB
const MAX_FILENAME_LENGTH = 200

// Decided by file extension, not the browser-supplied type, and stored with
// the file so downloads are served with a known-safe type.
const CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain; charset=utf-8',
}

/** The client sends the name URI-encoded in a header, since headers are ASCII-only. */
function readFilename(header: string | undefined) {
  let name: string
  try {
    name = decodeURIComponent(header ?? '')
  } catch {
    return ''
  }
  // Keep just the base name, without any folder the browser included.
  return name.split(/[\\/]/).pop()!.trim().slice(-MAX_FILENAME_LENGTH)
}

/** Mounted under /api/courses/:courseId/fact-patterns, after the course is loaded. */
export const factPatternsRouter = Router()

factPatternsRouter.get('/', async (req, res) => {
  res.json({ factPatterns: await listFactPatterns(req.course!.id) })
})

/** The request body is the raw file; its name goes in the X-Filename header. */
factPatternsRouter.post(
  '/',
  express.raw({ type: () => true, limit: MAX_FACT_PATTERN_BYTES }),
  async (req, res) => {
    const filename = readFilename(req.get('X-Filename'))
    if (!filename) throw new HttpError(400, 'The file needs a name.')
    const contentType = CONTENT_TYPES[extname(filename).toLowerCase()]
    if (!contentType) throw new HttpError(415, 'Upload a PDF, Word document, or text file.')
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new HttpError(400, 'The file is empty.')
    }

    const factPattern = await createFactPattern({
      courseId: req.course!.id,
      filename,
      contentType,
      data: req.body,
      uploadedBy: req.user!.id,
    })
    res.status(201).json({ factPattern })
  },
)

factPatternsRouter.get('/:factPatternId/file', async (req, res) => {
  const { factPatternId } = req.params
  const file = isUuid(factPatternId) ? await findFactPatternFile(req.course!.id, factPatternId) : null
  if (!file) throw new HttpError(404, 'File not found.')

  // Always a download, never rendered in the page, so an uploaded file can't run script here.
  res.attachment(file.filename)
  res.set({ 'Content-Type': file.contentType, 'X-Content-Type-Options': 'nosniff' })
  res.send(file.data)
})

factPatternsRouter.delete('/:factPatternId', async (req, res) => {
  const { factPatternId } = req.params
  if (!isUuid(factPatternId) || !(await deleteFactPattern(req.course!.id, factPatternId))) {
    throw new HttpError(404, 'File not found.')
  }
  res.status(204).end()
})
