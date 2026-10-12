import type { Request } from 'express'
import { HttpError } from '../httpError.ts'
import { findUserById, type Role } from './users.ts'

/** Loads the logged-in user, or rejects with 401 (not logged in) or 403 (wrong role). */
export async function requireUser(req: Request, role?: Role) {
  const user = req.session.userId ? await findUserById(req.session.userId) : null
  if (!user) throw new HttpError(401, 'Please log in.')
  if (role && user.role !== role) throw new HttpError(403, `Only ${role}s can do that.`)
  return user
}
