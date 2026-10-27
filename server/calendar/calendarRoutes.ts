import { Router, type Request } from 'express'
import { HttpError } from '../httpError.ts'
import { isUuid, readString } from '../validation.ts'
import { calendarViewer, createEvent, deleteEvent, listCalendar, updateEvent, type EventInput } from './calendar.ts'

const MAX_TITLE_LENGTH = 200
const MAX_NOTES_LENGTH = 2000

/** Mounted under /api/courses/:courseId/calendar, for the course's instructor and students. */
export const calendarRouter = Router({ mergeParams: true })

const viewerFor = (req: Request) => {
  const { courseId } = req.params as { courseId: string }
  if (!isUuid(courseId)) throw new HttpError(404, 'Course not found.')
  return calendarViewer(courseId, req.user!.id)
}

/** Validates an event's title, notes, and day (YYYY-MM-DD). */
function readEventFields(body: unknown) {
  const title = readString(body, 'title').trim()
  const notes = readString(body, 'notes').trim()
  const date = readString(body, 'date').trim()
  if (!title) throw new HttpError(400, 'Give the event a title.')
  if (title.length > MAX_TITLE_LENGTH) throw new HttpError(400, `The title must be at most ${MAX_TITLE_LENGTH} characters.`)
  if (notes.length > MAX_NOTES_LENGTH) throw new HttpError(400, `The notes must be at most ${MAX_NOTES_LENGTH} characters.`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new HttpError(400, 'Choose a date.')
  return { title, notes, date }
}

calendarRouter.get('/', async (req, res) => {
  res.json({ items: await listCalendar(await viewerFor(req)) })
})

/** `{ kind: 'case' | 'personal' | 'team', title, notes, date, caseId }`. */
calendarRouter.post('/events', async (req, res) => {
  const viewer = await viewerFor(req)
  const kind = readString(req.body, 'kind')
  if (kind !== 'case' && kind !== 'personal' && kind !== 'team') throw new HttpError(400, 'Choose what kind of event this is.')
  const caseId = readString(req.body, 'caseId') || null
  if (caseId && !isUuid(caseId)) throw new HttpError(400, 'Choose a case in this course.')
  const input: EventInput = { kind, caseId, ...readEventFields(req.body) }
  await createEvent(viewer, input)
  res.status(201).json({ items: await listCalendar(viewer) })
})

calendarRouter.put('/events/:eventId', async (req, res) => {
  const viewer = await viewerFor(req)
  if (!isUuid(req.params.eventId)) throw new HttpError(404, 'Event not found.')
  await updateEvent(viewer, req.params.eventId, readEventFields(req.body))
  res.json({ items: await listCalendar(viewer) })
})

calendarRouter.delete('/events/:eventId', async (req, res) => {
  const viewer = await viewerFor(req)
  if (!isUuid(req.params.eventId)) throw new HttpError(404, 'Event not found.')
  await deleteEvent(viewer, req.params.eventId)
  res.json({ items: await listCalendar(viewer) })
})
