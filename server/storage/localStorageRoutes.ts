import express, { Router } from 'express'
import { HttpError } from '../httpError.ts'
import { MAX_UPLOAD_BYTES } from './shared.ts'
import { localStore } from './storage.ts'

/**
 * Plays S3's part for signed URLs when files are kept in a local folder
 * (development and tests). Mounted at /api/storage/local only then; the signed
 * query is the only credential, as with S3, so no login is needed.
 */
export const localStorageRouter = Router()

localStorageRouter.put('/', express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }), async (req, res) => {
  const params = localStore!.verify(req.query)
  if (!params || params.op !== 'put') throw new HttpError(403, 'This upload link is invalid or has expired.')
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
  // S3 checks the signed type and length too.
  if (req.get('Content-Type') !== params.type || body.length !== Number(params.size)) {
    throw new HttpError(403, 'The file does not match the upload link.')
  }
  await localStore!.write(params.key, body)
  res.status(200).end()
})

localStorageRouter.get('/', async (req, res) => {
  const params = localStore!.verify(req.query)
  if (!params || params.op !== 'get') throw new HttpError(403, 'This download link is invalid or has expired.')
  let data: Buffer
  try {
    data = await localStore!.read(params.key)
  } catch {
    throw new HttpError(404, 'File not found.')
  }
  res.set({
    'Content-Type': params.type,
    'Content-Disposition': params.disposition,
    'X-Content-Type-Options': 'nosniff',
  })
  res.send(data)
})
