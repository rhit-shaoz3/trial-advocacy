import bcrypt from 'bcryptjs'
import { Router, type Request } from 'express'
import { HttpError } from '../httpError.ts'
import { createUser, findUserByEmail, findUserById, toPublicUser, type Role } from './users.ts'

const BCRYPT_ROUNDS = 11
const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_BYTES = 72 // bcrypt ignores anything past 72 bytes
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ROLES: Role[] = ['student', 'instructor']

// Compared against when the email doesn't exist, so a failed login takes the
// same time either way and doesn't reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS)

function readString(body: unknown, key: string) {
  const value = (body as Record<string, unknown> | undefined)?.[key]
  return typeof value === 'string' ? value : ''
}

/** Issues a fresh session ID on login to prevent session fixation. */
function startSession(req: Request, userId: string) {
  return new Promise<void>((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err)
      req.session.userId = userId
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()))
    })
  })
}

export const authRouter = Router()

authRouter.get('/me', async (req, res) => {
  const user = req.session.userId ? await findUserById(req.session.userId) : null
  res.json({ user: user ? toPublicUser(user) : null })
})

authRouter.post('/signup', async (req, res) => {
  const name = readString(req.body, 'name').trim()
  const email = readString(req.body, 'email').trim().toLowerCase()
  const password = readString(req.body, 'password')
  const role = readString(req.body, 'role') as Role

  if (!name) throw new HttpError(400, 'Name is required.')
  if (!EMAIL_PATTERN.test(email)) throw new HttpError(400, 'Enter a valid email address.')
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  }
  if (Buffer.byteLength(password) > MAX_PASSWORD_BYTES) {
    throw new HttpError(400, 'Password is too long.')
  }
  if (!ROLES.includes(role)) throw new HttpError(400, 'Choose student or instructor.')

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
  const user = await createUser({ name, email, role, passwordHash })
  if (!user) throw new HttpError(409, 'An account with that email already exists.')

  await startSession(req, user.id)
  res.status(201).json({ user: toPublicUser(user) })
})

authRouter.post('/login', async (req, res) => {
  const email = readString(req.body, 'email').trim()
  const password = readString(req.body, 'password')

  const user = email ? await findUserByEmail(email) : null
  const valid = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH)
  if (!user || !valid) throw new HttpError(401, 'Incorrect email or password.')

  await startSession(req, user.id)
  res.json({ user: toPublicUser(user) })
})

authRouter.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err)
    res.clearCookie('ta.sid')
    res.status(204).end()
  })
})
