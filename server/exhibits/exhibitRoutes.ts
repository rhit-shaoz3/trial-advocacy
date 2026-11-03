import { Router, type Request } from 'express'
import { HttpError } from '../httpError.ts'
import { isUuid } from '../validation.ts'
import { teamMatchupId, findStudentTeamId, getStudentWorkspace } from '../courses/workspace.ts'
import {
  exhibitOverview,
  getStudentExhibits,
  listCaseExhibits,
  listExhibitReviews,
  markExhibitsSeen,
  ruleOnAdmission,
  ruleOnAuthenticity,
  saveList,
  submitList,
  teamMove,
  type ExhibitTeam,
} from './exhibits.ts'
import { findExhibitSource, markable, sendExhibitFile, sendExhibitText, startRedactedUpload, textParts } from './exhibitFiles.ts'

/**
 * The student's side of its case world, once the case is in the final steps
 * phase with the exhibit list on. Null when there's nothing for them (not
 * that phase, the list is off, or their team isn't matched). Changes need an
 * active case.
 */
async function studentTeam(req: Request, changing: boolean): Promise<ExhibitTeam | null> {
  const { courseId, caseId } = req.params as Record<string, string>
  const workspace = isUuid(courseId) && isUuid(caseId) ? await getStudentWorkspace(courseId, caseId, req.user!.id) : null
  if (!workspace) throw new HttpError(404, 'Case not found.')
  const teamId = await findStudentTeamId(caseId, req.user!.id)
  const matchupId = teamId ? await teamMatchupId(teamId) : null
  const open = workspace.case.phase === 'final_steps' && workspace.exhibitListEnabled
  if (!open || !teamId || !matchupId || !workspace.side) {
    if (changing) throw new HttpError(409, 'The joint exhibit list opens in the final steps phase.')
    return null
  }
  if (changing && workspace.case.status !== 'active') throw new HttpError(409, 'This case is closed.')
  return { caseId, matchupId, teamId, side: workspace.side, userId: req.user!.id }
}

/** Mounted under /api/courses/:courseId/my-cases/:caseId/exhibits, for students. */
export const myExhibitsRouter = Router({ mergeParams: true })

/** `{ exhibits }`: the team's list, the other side's, and the world's exhibits; null when there's nothing yet. */
myExhibitsRouter.get('/', async (req, res) => {
  const team = await studentTeam(req, false)
  res.json({ exhibits: team ? await getStudentExhibits(team) : null })
})

/** Saves the team's draft: `{ items: [{ kind, id, parts }] }`. */
myExhibitsRouter.put('/list', async (req, res) => {
  const team = (await studentTeam(req, true))!
  await saveList(team, req.body)
  res.json({ exhibits: await getStudentExhibits(team) })
})

/** Submits the team's list (`{ items }`), for good. */
myExhibitsRouter.post('/list/submit', async (req, res) => {
  const team = (await studentTeam(req, true))!
  await submitList(team, req.body)
  res.json({ exhibits: await getStudentExhibits(team) })
})

for (const step of ['authenticity', 'admission', 'response'] as const) {
  /** The team's move on one exhibit; see `teamMove`. */
  myExhibitsRouter.post(`/:exhibitId/${step}`, async (req, res) => {
    const team = (await studentTeam(req, true))!
    await teamMove(team, req.params.exhibitId as string, step, req.body)
    res.json({ exhibits: await getStudentExhibits(team) })
  })
}

/** One exhibit's file, for either side of the world: its listed pages, or the redacted version once admitted with one. */
myExhibitsRouter.get('/:exhibitId/file', async (req, res) => {
  const team = await studentTeam(req, false)
  if (!team || !isUuid(req.params.exhibitId)) throw new HttpError(404, 'Exhibit not found.')
  await sendExhibitFile(res, await findExhibitSource(req.params.exhibitId as string, team), req.query.view === '1')
})

/** One exhibit's text version (a Word file's), for the viewer. */
myExhibitsRouter.get('/:exhibitId/text', async (req, res) => {
  const team = await studentTeam(req, false)
  if (!team || !isUuid(req.params.exhibitId)) throw new HttpError(404, 'Exhibit not found.')
  await sendExhibitText(res, await findExhibitSource(req.params.exhibitId as string, team))
})

/** Marks the world's exhibits as read by this student. */
myExhibitsRouter.post('/seen', async (req, res) => {
  const team = await studentTeam(req, false)
  if (team) await markExhibitsSeen(team)
  res.status(204).end()
})

/** Mounted under /api/courses/:courseId/cases/:caseId/exhibits, for the instructor (after `loadCase`). */
export const caseExhibitsRouter = Router({ mergeParams: true })

/** `{ worlds }`: every world's lists and exhibits, read-only. */
caseExhibitsRouter.get('/', async (req, res) => {
  res.json({ worlds: await listCaseExhibits(req.courseCase!.id) })
})

/** For the case dashboard. */
caseExhibitsRouter.get('/overview', async (req, res) => {
  res.json({ overview: await exhibitOverview(req.courseCase!.id) })
})

/** An exhibit in this course, for the instructor. */
const courseExhibit = (req: Request) => {
  const id = req.params.exhibitId as string
  if (!isUuid(id)) throw new HttpError(404, 'Exhibit not found.')
  return findExhibitSource(id, { courseId: req.course!.id })
}

/** One exhibit's file, as the sides see it. */
caseExhibitsRouter.get('/:exhibitId/file', async (req, res) => {
  const x = await courseExhibit(req)
  if (x.caseId !== req.courseCase!.id) throw new HttpError(404, 'Exhibit not found.')
  await sendExhibitFile(res, x, req.query.view === '1')
})

caseExhibitsRouter.get('/:exhibitId/text', async (req, res) => {
  const x = await courseExhibit(req)
  if (x.caseId !== req.courseCase!.id) throw new HttpError(404, 'Exhibit not found.')
  await sendExhibitText(res, x)
})

/** Mounted under /api/courses/:courseId/exhibit-reviews, for the instructor who teaches the course. */
export const exhibitReviewsRouter = Router({ mergeParams: true })

/** `?status=open` (the default) or `?status=completed`. */
exhibitReviewsRouter.get('/', async (req, res) => {
  const which = req.query.status === 'completed' ? 'completed' : 'open'
  res.json({ reviews: await listExhibitReviews(req.course!.id, which) })
})

/** `{ decision: authenticate | reject, note }`. */
exhibitReviewsRouter.post('/:exhibitId/authenticity', async (req, res) => {
  await ruleOnAuthenticity(req.course!.id, req.params.exhibitId as string, req.user!.id, req.body)
  res.json({ reviews: await listExhibitReviews(req.course!.id, 'open') })
})

/** The exhibit's file as offered (its listed pages), for marking a redaction. */
exhibitReviewsRouter.get('/:exhibitId/file', async (req, res) => {
  await sendExhibitFile(res, await courseExhibit(req), req.query.view === '1')
})

exhibitReviewsRouter.get('/:exhibitId/text', async (req, res) => {
  await sendExhibitText(res, await courseExhibit(req))
})

/** `{ markable, parts }`: how the exhibit can be marked, and its turns or paragraphs when it's text. */
exhibitReviewsRouter.get('/:exhibitId/marking', async (req, res) => {
  const x = await courseExhibit(req)
  const kind = markable(x)
  res.json({ markable: kind, parts: kind === 'text' ? textParts(x) : null })
})

/** `{ size }`: where to upload the redacted copy of a PDF or picture. */
exhibitReviewsRouter.post('/:exhibitId/uploads', async (req, res) => {
  res.status(201).json({ upload: await startRedactedUpload(await courseExhibit(req), req.body) })
})

/** `{ decision: overrule | sustain | partial, redaction, note, marks, uploadKey }`. */
exhibitReviewsRouter.post('/:exhibitId/admission', async (req, res) => {
  await ruleOnAdmission(req.course!.id, req.params.exhibitId as string, req.user!.id, req.body)
  res.json({ reviews: await listExhibitReviews(req.course!.id, 'open') })
})
