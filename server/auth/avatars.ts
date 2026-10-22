import { randomUUID } from 'node:crypto'
import express, { Router, type Request, type RequestHandler, type Response } from 'express'
import { HttpError } from '../httpError.ts'
import { storage } from '../storage/storage.ts'
import { isUuid } from '../validation.ts'
import { requireUser } from './requireUser.ts'
import { findUserById, setAvatarKey, toPublicUser } from './users.ts'

// Profile pictures (and, with the same helpers, witnesses' pictures). The
// browser crops the picture to a square and uploads the image itself (not a
// signed URL, since it's small), and it's loaded through the API so it can be
// cached by its versioned URL.

export const MAX_AVATAR_BYTES = 1024 * 1024 // 1 MB

/** The picture's type from its first bytes, since the Content-Type header could say anything. */
export function imageType(data: Buffer): 'image/png' | 'image/jpeg' | null {
  if (data.length > 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png'
  }
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  return null
}

/** Reads the raw picture, with a too-large message that names this limit rather than the case-file one. */
export const readPicture: RequestHandler = (req, res, next) =>
  express.raw({ type: () => true, limit: MAX_AVATAR_BYTES })(req, res, (err?: { type?: string }) => {
    if (err?.type === 'entity.too.large') return next(new HttpError(413, 'That picture is too large. The limit is 1 MB.'))
    next(err)
  })

/** The uploaded picture and its type, or a 400 if it isn't a PNG or JPEG. */
export function pictureFrom(req: Request) {
  const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
  const type = imageType(data)
  if (!type) throw new HttpError(400, 'Choose a PNG or JPEG picture.')
  return { data, type }
}

/**
 * Sends a stored picture. The URL names the picture's version (`?v=`), so the
 * current one never changes and is cached for good; an old version's URL gets
 * the new picture, but mustn't keep it.
 */
export async function sendPicture(req: Request, res: Response, key: string) {
  const data = await storage.read(key)
  const current = req.query.v === key.split('/')[2]
  res.set('Cache-Control', current ? 'private, max-age=31536000, immutable' : 'private, no-cache')
  res.set('X-Content-Type-Options', 'nosniff')
  res.type(imageType(data) ?? 'application/octet-stream').send(data)
}

/** `PUT` / `DELETE /api/auth/me/avatar`: the signed-in user's own picture. */
export const myAvatarRouter = Router()
myAvatarRouter.use(requireUser)

myAvatarRouter.put('/', readPicture, async (req, res) => {
  const { data, type } = pictureFrom(req)
  const key = `avatars/${req.user!.id}/${randomUUID()}`
  await storage.put(key, data, type)
  const result = await setAvatarKey(req.user!.id, key)
  if (!result) {
    await storage.delete([key])
    throw new HttpError(401, 'Please log in.')
  }
  if (result.oldKey) await storage.delete([result.oldKey])
  res.json({ user: toPublicUser(result.user) })
})

myAvatarRouter.delete('/', async (req, res) => {
  const result = await setAvatarKey(req.user!.id, null)
  if (!result) throw new HttpError(401, 'Please log in.')
  if (result.oldKey) await storage.delete([result.oldKey])
  res.json({ user: toPublicUser(result.user) })
})

/** `GET /api/users/:id/avatar`: anyone's picture, for anyone signed in. */
export const usersRouter = Router()

usersRouter.get('/:id/avatar', requireUser, async (req, res) => {
  const user = isUuid(req.params.id) ? await findUserById(req.params.id) : null
  if (!user?.avatar_key) throw new HttpError(404, 'No profile picture.')
  await sendPicture(req, res, user.avatar_key)
})
