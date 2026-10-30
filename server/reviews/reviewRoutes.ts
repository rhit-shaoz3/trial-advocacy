import { Router } from 'express'
import { HttpError } from '../httpError.ts'
import { isUuid, readString } from '../validation.ts'
import { queueInvestigation } from '../investigator/requests.ts'
import { decideGroup, listFactGroups, ungroup } from './grouping.ts'
import { listOpenFlags, resolveFlag } from './flags.ts'
import {
  completeReview,
  decideDocument,
  decideFact,
  DOCUMENT_DECISIONS,
  FACT_DECISIONS,
  listReviews,
  retryReview,
  reviewTranscript,
  type DocumentDecision,
  type FactDecision,
  type InterviewReview,
} from './reviews.ts'

/** Mounted under /api/courses/:courseId/reviews, for the instructor who teaches the course. */
export const reviewsRouter = Router({ mergeParams: true })

function readId(id: string | undefined, notFound: string) {
  if (!isUuid(id)) throw new HttpError(404, notFound)
  return id
}

/** A ruling that finished an investigation's review, or changed a finished one, starts the team's report. */
const startReport = (review: InterviewReview | null) => {
  if (review?.kind === 'investigation' && review.status === 'finalizing') queueInvestigation(review.id)
}

/**
 * `?status=open` (the default: still to do) or `?status=completed`. With the
 * open ones come the groups of similar facts to rule on together and the
 * students' flags.
 */
reviewsRouter.get('/', async (req, res) => {
  const which = req.query.status === 'completed' ? 'completed' : 'open'
  const reviews = await listReviews(req.course!.id, which)
  if (which === 'completed') return void res.json({ reviews, groups: [], flags: [] })
  const [groups, flags] = await Promise.all([listFactGroups(req.course!.id), listOpenFlags(req.course!.id)])
  res.json({ reviews, groups, flags })
})

/** Rules on every fact in a group: `{ decision }`, each fact for its own world (_world) or for every world (_case). */
reviewsRouter.put('/fact-groups/:groupId', async (req, res) => {
  const groupId = readId(req.params.groupId, 'Group not found.')
  const decision = readString(req.body, 'decision')
  if (!FACT_DECISIONS.includes(decision as FactDecision)) throw new HttpError(400, 'Choose a ruling for these facts.')
  const reviewIds = await decideGroup(req.course!.id, groupId, decision as FactDecision, req.user!.id)
  // An investigation that finished starts its report (this does nothing for the others).
  for (const id of reviewIds) queueInvestigation(id)
  res.json({ reviewIds })
})

/** Sends a group's facts back to their reviews, to rule on one by one. */
reviewsRouter.post('/fact-groups/:groupId/ungroup', async (req, res) => {
  await ungroup(req.course!.id, readId(req.params.groupId, 'Group not found.'))
  res.status(204).end()
})

/** Answers a student's flag; see resolveFlag for the body. */
reviewsRouter.post('/flags/:flagId/resolve', async (req, res) => {
  const flagId = readId(req.params.flagId, 'Flag not found.')
  const { review, subpoena } = await resolveFlag(req.course!.id, flagId, req.user!.id, req.body)
  startReport(review)
  res.json({ review, subpoena })
})

/** `{ decision }`: accept_world, deny_world, accept_case, or deny_case. */
reviewsRouter.put('/:reviewId/facts/:factId', async (req, res) => {
  const reviewId = readId(req.params.reviewId, 'Review not found.')
  const factId = readId(req.params.factId, 'Fact not found.')
  const decision = readString(req.body, 'decision')
  if (!FACT_DECISIONS.includes(decision as FactDecision)) throw new HttpError(400, 'Choose a ruling for this fact.')
  const review = await decideFact(req.course!.id, reviewId, factId, decision as FactDecision, req.user!.id)
  startReport(review)
  res.json({ review })
})

/** An investigation's case file: `{ decision }`, allow (share it with the team) or deny. */
reviewsRouter.put('/:reviewId/documents/:materialId', async (req, res) => {
  const reviewId = readId(req.params.reviewId, 'Review not found.')
  const materialId = readId(req.params.materialId, 'File not found.')
  const decision = readString(req.body, 'decision')
  if (!DOCUMENT_DECISIONS.includes(decision as DocumentDecision)) throw new HttpError(400, 'Choose allow or deny for this file.')
  const review = await decideDocument(req.course!.id, reviewId, materialId, decision as DocumentDecision, req.user!.id)
  startReport(review)
  res.json({ review })
})

/** Sends on a report with nothing to rule on (everything else finishes once ruled); the team's report is then written. */
reviewsRouter.post('/:reviewId/complete', async (req, res) => {
  const review = await completeReview(req.course!.id, readId(req.params.reviewId, 'Review not found.'), req.user!.id)
  startReport(review)
  res.json({ review })
})

reviewsRouter.post('/:reviewId/retry', async (req, res) => {
  const reviewId = readId(req.params.reviewId, 'Review not found.')
  const review = await retryReview(req.course!.id, reviewId)
  if (review.kind === 'investigation') queueInvestigation(review.id)
  res.json({ review })
})

reviewsRouter.get('/:reviewId/transcript', async (req, res) => {
  const reviewId = readId(req.params.reviewId, 'Review not found.')
  res.json(await reviewTranscript(req.course!.id, reviewId))
})
