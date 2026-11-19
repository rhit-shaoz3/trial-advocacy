import { Router, type Request } from 'express'
import { HttpError } from '../httpError.ts'
import { isUuid } from '../validation.ts'
import { findStudentTeamId, getStudentWorkspace, teamMatchupId } from '../courses/workspace.ts'
import {
  addEvidence,
  createCard,
  createGap,
  deleteCard,
  deleteEvidence,
  deleteGap,
  loadChart,
  plannerOverview,
  plannerSources,
  setCardWitnesses,
  setFinalized,
  setGapTools,
  updateCard,
  updateEvidence,
  updateGap,
  type PlannerTeam,
} from './planner.ts'
import { requestReview, retryReview, saveReply, teamFeedback } from './review.ts'
import type { InteractionLimit } from '../courses/cases.ts'

/**
 * The student's team in its case world, with the planner on. Null when
 * there's nothing for them (the planner is off, or their team isn't
 * matched). Changes need an active case.
 */
async function plannerTeam(req: Request, changing: boolean): Promise<(PlannerTeam & { reviewLimit: InteractionLimit }) | null> {
  const { courseId, caseId } = req.params as Record<string, string>
  const workspace = isUuid(courseId) && isUuid(caseId) ? await getStudentWorkspace(courseId, caseId, req.user!.id) : null
  if (!workspace) throw new HttpError(404, 'Case not found.')
  const teamId = await findStudentTeamId(caseId, req.user!.id)
  const matchupId = teamId ? await teamMatchupId(teamId) : null
  if (!workspace.planner.enabled || !teamId || !matchupId || !workspace.side) {
    if (changing) throw new HttpError(409, 'Your team gets its planner once it is in a case world.')
    return null
  }
  if (changing && workspace.case.status !== 'active') throw new HttpError(409, 'This case is closed, so the planner is read-only.')
  return { caseId, teamId, matchupId, side: workspace.side, userId: req.user!.id, reviewLimit: workspace.planner.reviewLimit }
}

/** Mounted under /api/courses/:courseId/my-cases/:caseId/planner, for students. */
export const myPlannerRouter = Router({ mergeParams: true })

/** `{ planner, feedback }`: the team's chart and its rounds of feedback, or nulls when there's no planner for it. */
myPlannerRouter.get('/', async (req, res) => {
  const team = await plannerTeam(req, false)
  res.json(team ? { planner: await loadChart(team), feedback: await teamFeedback(team, team.reviewLimit) } : { planner: null, feedback: null })
})

/** `{ feedback }`: the team's rounds of feedback, to check on one that's on its way. */
myPlannerRouter.get('/reviews', async (req, res) => {
  const team = await plannerTeam(req, false)
  res.json({ feedback: team ? await teamFeedback(team, team.reviewLimit) : null })
})

/** Asks for the next round of feedback on the chart as it is now. Answers with `{ feedback }`. */
myPlannerRouter.post('/reviews', async (req, res) => {
  const team = (await plannerTeam(req, true))!
  await requestReview(team, team.reviewLimit)
  res.status(201).json({ feedback: await teamFeedback(team, team.reviewLimit) })
})

/** Tries a round that failed again. */
myPlannerRouter.post('/reviews/:reviewId/retry', async (req, res) => {
  const team = (await plannerTeam(req, true))!
  await retryReview(team, req.params.reviewId as string)
  res.json({ feedback: await teamFeedback(team, team.reviewLimit) })
})

/** The team's reply `{ text }` to a round's question on a card or gap, for the next round to read. */
myPlannerRouter.put('/reviews/:reviewId/replies/:targetKind/:targetId', async (req, res) => {
  const team = (await plannerTeam(req, true))!
  const { reviewId, targetKind, targetId } = req.params as Record<string, string>
  await saveReply(team, reviewId, targetKind, targetId, req.body)
  res.json({ feedback: await teamFeedback(team, team.reviewLimit) })
})

/** `{ sources }`: the files, interviews and reports the team can cite as evidence. */
myPlannerRouter.get('/sources', async (req, res) => {
  const team = await plannerTeam(req, false)
  res.json({ sources: team ? await plannerSources(team) : [] })
})

/** Every change answers with the whole chart, so the page sees teammates' changes too. */
const changed = async (team: PlannerTeam, extra: Record<string, unknown> = {}) => ({ planner: await loadChart(team), ...extra })

myPlannerRouter.post('/cards', async (req, res) => {
  const team = (await plannerTeam(req, true))!
  const id = await createCard(team, req.body)
  res.status(201).json(await changed(team, { id }))
})

myPlannerRouter.patch('/cards/:cardId', async (req, res) => {
  const team = (await plannerTeam(req, true))!
  await updateCard(team, req.params.cardId as string, req.body)
  res.json(await changed(team))
})

myPlannerRouter.delete('/cards/:cardId', async (req, res) => {
  const team = (await plannerTeam(req, true))!
  await deleteCard(team, req.params.cardId as string)
  res.json(await changed(team))
})

myPlannerRouter.put('/cards/:cardId/witnesses', async (req, res) => {
  const team = (await plannerTeam(req, true))!
  await setCardWitnesses(team, req.params.cardId as string, req.body)
  res.json(await changed(team))
})

myPlannerRouter.post('/cards/:cardId/evidence', async (req, res) => {
  const team = (await plannerTeam(req, true))!
  await addEvidence(team, req.params.cardId as string, req.body)
  res.status(201).json(await changed(team))
})

myPlannerRouter.patch('/cards/:cardId/evidence/:evidenceId', async (req, res) => {
  const team = (await plannerTeam(req, true))!
  await updateEvidence(team, req.params.cardId as string, req.params.evidenceId as string, req.body)
  res.json(await changed(team))
})

myPlannerRouter.delete('/cards/:cardId/evidence/:evidenceId', async (req, res) => {
  const team = (await plannerTeam(req, true))!
  await deleteEvidence(team, req.params.cardId as string, req.params.evidenceId as string)
  res.json(await changed(team))
})

myPlannerRouter.post('/gaps', async (req, res) => {
  const team = (await plannerTeam(req, true))!
  const id = await createGap(team, req.body)
  res.status(201).json(await changed(team, { id }))
})

myPlannerRouter.patch('/gaps/:gapId', async (req, res) => {
  const team = (await plannerTeam(req, true))!
  await updateGap(team, req.params.gapId as string, req.body)
  res.json(await changed(team))
})

myPlannerRouter.delete('/gaps/:gapId', async (req, res) => {
  const team = (await plannerTeam(req, true))!
  await deleteGap(team, req.params.gapId as string)
  res.json(await changed(team))
})

myPlannerRouter.put('/gaps/:gapId/tools', async (req, res) => {
  const team = (await plannerTeam(req, true))!
  await setGapTools(team, req.params.gapId as string, req.body)
  res.json(await changed(team))
})

/** Finalizes the plan, or takes that back: `{ finalized }`. */
myPlannerRouter.put('/finalized', async (req, res) => {
  const team = (await plannerTeam(req, true))!
  await setFinalized(team, req.body)
  res.json(await changed(team))
})

/** Mounted under /api/courses/:courseId/cases/:caseId/planners, for the instructor: read-only. */
export const casePlannersRouter = Router({ mergeParams: true })

/** `{ teams }`: how far each matched team has got. */
casePlannersRouter.get('/', async (req, res) => {
  res.json({ teams: await plannerOverview(req.courseCase!.id) })
})

/** `{ planner, feedback }`: one team's chart and its rounds of feedback. */
casePlannersRouter.get('/:teamId', async (req, res) => {
  const caseId = req.courseCase!.id
  const teamId = req.params.teamId as string
  if (!isUuid(teamId) || !(await plannerOverview(caseId)).some((t) => t.teamId === teamId)) {
    throw new HttpError(404, 'That team isn’t in a case world in this case.')
  }
  res.json({
    planner: await loadChart({ caseId, teamId }),
    feedback: await teamFeedback({ caseId, teamId, userId: null }, req.courseCase!.planner.reviewLimit),
  })
})
