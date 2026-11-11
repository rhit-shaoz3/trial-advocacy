import type { Request } from 'express'
import { demoSession } from '../demo/demo.ts'
import { toPublicUser, type UserRow } from './users.ts'

/** The user as the client gets them, with the demo bar's details in a demo session. */
export async function presentUser(req: Request, user: UserRow) {
  return { ...toPublicUser(user), demo: await demoSession(req.session, user.role) }
}
