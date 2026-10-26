import { Router } from 'express'
import { requireUser } from '../auth/requireUser.ts'
import { instructorOverview, studentOverview } from './home.ts'

/** Mounted at /api/home: the main dashboard, across every course. */
export const homeRouter = Router()

homeRouter.use(requireUser)

homeRouter.get('/', async (req, res) => {
  const user = req.user!
  res.json(user.role === 'student' ? await studentOverview(user.id) : await instructorOverview(user.id))
})
