import { Router } from 'express'
import { HttpError } from '../httpError.ts'
import { EMAIL_PATTERN } from '../validation.ts'
import { addToRoster, listRoster, removeFromRoster } from './roster.ts'

const MAX_EMAILS_PER_REQUEST = 500

const SKIP_REASONS = {
  invalid: 'Not a valid email address.',
  'already-enrolled': 'Already on the roster.',
  instructor: 'Belongs to an instructor account.',
}

/** Mounted under /api/courses/:courseId/roster, after the course is loaded. */
export const rosterRouter = Router()

rosterRouter.get('/', async (req, res) => {
  res.json({ roster: await listRoster(req.course!.id) })
})

/** Body: `{ emails: string[] }`. Adds what it can and reports what it skipped. */
rosterRouter.post('/', async (req, res) => {
  const raw = (req.body as Record<string, unknown> | undefined)?.emails
  const emails = [
    ...new Set(
      (Array.isArray(raw) ? raw : [])
        .filter((e): e is string => typeof e === 'string')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  ]
  if (emails.length === 0) throw new HttpError(400, 'Enter at least one email address.')
  if (emails.length > MAX_EMAILS_PER_REQUEST) {
    throw new HttpError(400, `Add at most ${MAX_EMAILS_PER_REQUEST} students at a time.`)
  }

  const added: string[] = []
  const skipped: { email: string; reason: string }[] = []
  for (const email of emails) {
    const result = EMAIL_PATTERN.test(email) ? await addToRoster(req.course!.id, email) : 'invalid'
    if (result === 'added') added.push(email)
    else skipped.push({ email, reason: SKIP_REASONS[result] })
  }

  res.json({ added, skipped, roster: await listRoster(req.course!.id) })
})

rosterRouter.delete('/:email', async (req, res) => {
  const email = req.params.email.trim().toLowerCase()
  if (!(await removeFromRoster(req.course!.id, email))) {
    throw new HttpError(404, 'That student is not on the roster.')
  }
  res.status(204).end()
})
