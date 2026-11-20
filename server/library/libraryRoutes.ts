import { Router } from 'express'
import { attachmentHeader } from '../storage/shared.ts'
import { safeName } from '../packets/packets.ts'
import { libraryDetail, libraryEntries, libraryPdf } from './library.ts'

/** Mounted under /api/courses/:courseId/library: the signed-in student's own learning library. */
export const libraryRouter = Router({ mergeParams: true })

/** `{ entries }`: the student's practice, and their team's discovery checks and planner feedback, newest first. */
libraryRouter.get('/', async (req, res) => {
  res.json({ entries: await libraryEntries((req.params as Record<string, string>).courseId, req.user!.id) })
})

libraryRouter.get('/:kind/:id', async (req, res) => {
  const { courseId, kind, id } = req.params as Record<string, string>
  res.json({ detail: await libraryDetail(courseId, req.user!.id, kind, id) })
})

/** The entry as a PDF, to download. */
libraryRouter.get('/:kind/:id/pdf', async (req, res) => {
  const { courseId, kind, id } = req.params as Record<string, string>
  const detail = await libraryDetail(courseId, req.user!.id, kind, id)
  const pdf = await libraryPdf(detail)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', attachmentHeader(`${safeName(`${detail.entry.title} - ${detail.entry.caseTitle}`)}.pdf`))
  res.send(Buffer.from(pdf))
})
