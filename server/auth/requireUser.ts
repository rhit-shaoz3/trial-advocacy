import type { RequestHandler } from 'express'
import { HttpError } from '../httpError.ts'
import { findUserById, type UserRow } from './users.ts'

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by `requireUser`. */
    user?: UserRow
  }
}

/** Rejects the request with 401 unless someone is logged in; sets `req.user`. */
export const requireUser: RequestHandler = async (req, _res, next) => {
  const user = req.session.userId ? await findUserById(req.session.userId) : null
  if (!user) throw new HttpError(401, 'Please log in.')
  req.user = user
  next()
}
