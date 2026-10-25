import { Router } from 'express'
import { HttpError } from '../httpError.ts'
import { isUuid, readString } from '../validation.ts'
import { queueInvestigation } from '../investigator/requests.ts'
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
} from './reviews.ts'

/** Mounted under /api/courses/:courseId/reviews, for the instructor who teaches the course. */
export const reviewsRouter = Router({ mergeParams: true })

function readId(id: string | undefined, notFound: string) {
  if (!isUuid(id)) throw new HttpError(404, notFound)
  return id
}

/** `?status=open` (the default: still to do) or `?status=completed`. */
reviewsRouter.get('/', async (req, res) => {
  const which = req.query.status === 'completed' ? 'completed' : 'open'
  res.json({ reviews: await listReviews(req.course!.id, which) })
})

/** `{ decision }`: accept_world, deny_world, accept_case, or deny_case. */
reviewsRouter.put('/:reviewId/facts/:factId', async (req, res) => {
  const reviewId = readId(req.params.reviewId, 'Review not found.')
  const factId = readId(req.params.factId, 'Fact not found.')
  const decision = readString(req.body, 'decision')
  if (!FACT_DECISIONS.includes(decision as FactDecision)) throw new HttpError(400, 'Choose a ruling for this fact.')
  res.json({ review: await decideFact(req.course!.id, reviewId, factId, decision as FactDecision) })
})

/** An investigation's case file: `{ decision }`, allow (share it with the team) or deny. */
reviewsRouter.put('/:reviewId/documents/:materialId', async (req, res) => {
  const reviewId = readId(req.params.reviewId, 'Review not found.')
  const materialId = readId(req.params.materialId, 'File not found.')
  const decision = readString(req.body, 'decision')
  if (!DOCUMENT_DECISIONS.includes(decision as DocumentDecision)) throw new HttpError(400, 'Choose allow or deny for this file.')
  res.json({ review: await decideDocument(req.course!.id, reviewId, materialId, decision as DocumentDecision) })
})

/** Finishes the review; for an investigation, the team's report is then written in the background. */
reviewsRouter.post('/:reviewId/complete', async (req, res) => {
  const reviewId = readId(req.params.reviewId, 'Review not found.')
  const review = await completeReview(req.course!.id, reviewId, req.user!.id)
  if (review.kind === 'investigation') queueInvestigation(review.id)
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
  res.json({ turns: await reviewTranscript(req.course!.id, reviewId) })
})
