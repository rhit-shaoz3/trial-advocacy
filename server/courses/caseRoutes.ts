import { Router, type RequestHandler } from 'express'
import { HttpError } from '../httpError.ts'
import { isUuid, readString } from '../validation.ts'
import {
  CASE_PHASES,
  CASE_STATUSES,
  casePhases,
  DEFAULT_INVESTIGATOR_NAME,
  completeSetup,
  createCase,
  deleteCase,
  findCase,
  listCases,
  reachSetupStep,
  REVIEW_MODES,
  setCasePhase,
  setInvestigator,
  setReviewMode,
  SETUP_STEPS,
  updateCase,
  type CaseFields,
  type CasePhase,
  type CaseStatus,
  type CourseCase,
  type ImportantFacts,
  type ReviewMode,
  type SetupStep,
} from './cases.ts'
import { listStorageKeys, removeStoredFiles, setInstructorNote, setWitnessSettings } from './caseContent.ts'
import { materialsRouter, tasksRouter, witnessesRouter } from './caseContentRoutes.ts'
import { matchupsRouter } from './matchupRoutes.ts'
import { teamsRouter } from './teamRoutes.ts'
import { getPreviewWorkspace, launchChecks } from './workspace.ts'
import { applyDisclosures, requestsOpen } from '../exchange/exchange.ts'
import { depositionOverview, investigatorOverview } from './phaseOverview.ts'
import { finishWitnessSuggestions, witnessSuggestions } from '../witness/suggestions.ts'
import { exchangeRouter } from '../exchange/exchangeRoutes.ts'
import { duplicateCase, shareCase } from './caseCopy.ts'
import { caseFacts } from '../reviews/caseFacts.ts'

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by `loadCase` on /api/courses/:courseId/cases/:caseId/* routes. */
    courseCase?: CourseCase
  }
}

const MAX_TITLE_LENGTH = 120
const MAX_SUMMARY_LENGTH = 2000
const MAX_NOTE_LENGTH = 2000
const MAX_FACTS_PER_SIDE = 20
const MAX_FACT_LENGTH = 500

/**
 * Reads `importantFacts: { plaintiff: string[], defense: string[] }`, or
 * undefined if it's left out. Facts are trimmed and blank ones dropped. A side
 * may have none for now (the guided setup lets the instructor skip them), but
 * launching needs at least one each.
 */
function readImportantFacts(body: unknown): ImportantFacts | undefined {
  const value = (body as Record<string, unknown> | undefined)?.importantFacts as Record<string, unknown> | undefined
  if (value === undefined) return undefined
  const readSide = (side: keyof ImportantFacts, label: string) => {
    const list = value?.[side]
    if (list !== undefined && (!Array.isArray(list) || list.some((f) => typeof f !== 'string'))) {
      throw new HttpError(400, `List the ${label}'s important facts as text.`)
    }
    const facts = ((list ?? []) as string[]).map((f) => f.trim()).filter(Boolean)
    if (facts.length > MAX_FACTS_PER_SIDE) {
      throw new HttpError(400, `List at most ${MAX_FACTS_PER_SIDE} important facts for the ${label}.`)
    }
    if (facts.some((f) => f.length > MAX_FACT_LENGTH)) {
      throw new HttpError(400, `Each important fact must be at most ${MAX_FACT_LENGTH} characters.`)
    }
    return facts
  }
  return { plaintiff: readSide('plaintiff', 'plaintiff'), defense: readSide('defense', 'defense') }
}

/**
 * Validates the body of a create or edit request. Edits must send the status,
 * so a client that leaves it out can't quietly turn an active case back into a draft.
 * A new case needs its description; older cases may still be saved without one.
 */
function readCaseFields(body: unknown, defaultStatus?: CaseStatus, creating = false): CaseFields {
  const title = readString(body, 'title').trim()
  const summary = readString(body, 'summary').trim()
  const status = readString(body, 'status') || defaultStatus

  if (!title) throw new HttpError(400, 'Case title is required.')
  if (title.length > MAX_TITLE_LENGTH) {
    throw new HttpError(400, `Case title must be at most ${MAX_TITLE_LENGTH} characters.`)
  }
  if (creating && !summary) throw new HttpError(400, 'Add a short description of the case.')
  if (summary.length > MAX_SUMMARY_LENGTH) {
    throw new HttpError(400, `Summary must be at most ${MAX_SUMMARY_LENGTH} characters.`)
  }
  if (!CASE_STATUSES.includes(status as CaseStatus)) throw new HttpError(400, 'Choose a valid status.')

  return { title, summary, status: status as CaseStatus, importantFacts: readImportantFacts(body), parties: readParties(body) }
}

const MAX_PARTY_LENGTH = 200

/** `{ plaintiffName, defendantName }`, or undefined to leave them as they are (or name them from the title). */
function readParties(body: unknown) {
  const fields = body as Record<string, unknown> | undefined
  if (fields?.plaintiffName === undefined && fields?.defendantName === undefined) return undefined
  const plaintiff = readString(body, 'plaintiffName').trim()
  const defendant = readString(body, 'defendantName').trim()
  if (!plaintiff) throw new HttpError(400, 'Name the plaintiff.')
  if (!defendant) throw new HttpError(400, 'Name the defendant.')
  if (plaintiff.length > MAX_PARTY_LENGTH || defendant.length > MAX_PARTY_LENGTH) {
    throw new HttpError(400, `Party names must be at most ${MAX_PARTY_LENGTH} characters.`)
  }
  return { plaintiff, defendant }
}

/** Mounted under /api/courses/:courseId/cases, after the course is loaded. */
export const casesRouter = Router()

casesRouter.get('/', async (req, res) => {
  res.json({ cases: await listCases(req.course!.id) })
})

casesRouter.post('/', async (req, res) => {
  res.status(201).json({ case: await createCase(req.course!.id, readCaseFields(req.body, 'draft', true)) })
})

casesRouter.get('/:caseId', async (req, res) => {
  const { caseId } = req.params
  const found = isUuid(caseId) ? await findCase(req.course!.id, caseId) : null
  if (!found) throw new HttpError(404, 'Case not found.')
  res.json({ case: found })
})

casesRouter.patch('/:caseId', async (req, res) => {
  const { caseId } = req.params
  const fields = readCaseFields(req.body)
  // A launched case's AI witnesses keep to its important facts, so neither side can lose them all.
  const facts = fields.importantFacts
  if (facts && fields.status !== 'draft') {
    if (facts.plaintiff.length === 0) throw new HttpError(400, 'List at least one important fact for the plaintiff.')
    if (facts.defense.length === 0) throw new HttpError(400, 'List at least one important fact for the defense.')
  }
  const updated = isUuid(caseId) ? await updateCase(req.course!.id, caseId, fields) : null
  if (!updated) throw new HttpError(404, 'Case not found.')
  res.json({ case: updated })
})

/** Also deletes the case's teams, worlds, and everything in its case file, including the stored files. */
casesRouter.delete('/:caseId', async (req, res) => {
  const { caseId } = req.params
  const files = isUuid(caseId) ? await listStorageKeys({ caseId }) : []
  if (!isUuid(caseId) || !(await deleteCase(req.course!.id, caseId))) {
    throw new HttpError(404, 'Case not found.')
  }
  await removeStoredFiles(files)
  res.status(204).end()
})

/** 404s unless the case belongs to the (already loaded) course. */
const loadCase: RequestHandler = async (req, _res, next) => {
  const { caseId } = req.params
  const found = isUuid(caseId) ? await findCase(req.course!.id, caseId) : null
  if (!found) throw new HttpError(404, 'Case not found.')
  req.courseCase = found
  next()
}

const caseRouter = Router({ mergeParams: true })
caseRouter.use(loadCase)
caseRouter.use('/teams', teamsRouter)
caseRouter.use('/matchups', matchupsRouter)
caseRouter.use('/materials', materialsRouter)
caseRouter.use('/witnesses', witnessesRouter)
caseRouter.use('/tasks', tasksRouter)
caseRouter.use('/exchange', exchangeRouter)

/** The witnesses the AI suggests from the initial file, offered once while setting up the case. */
caseRouter.get('/witness-suggestions', async (req, res) => {
  res.json(await witnessSuggestions(req.courseCase!.id))
})

/** The instructor added some suggested witnesses, or skipped them: they're not offered again. */
caseRouter.post('/witness-suggestions/done', async (req, res) => {
  await finishWitnessSuggestions(req.courseCase!.id)
  res.json({ status: 'done' })
})

/** How teams have used the background investigator, for the case dashboard. */
caseRouter.get('/investigator/overview', async (req, res) => {
  res.json({ overview: await investigatorOverview(req.courseCase!.id) })
})

/** How teams are deposing the other side's witnesses, for the case dashboard. */
caseRouter.get('/depositions/overview', async (req, res) => {
  res.json({ overview: await depositionOverview(req.courseCase!.id) })
})

caseRouter.put('/note', async (req, res) => {
  const note = readString(req.body, 'note').trim()
  if (note.length > MAX_NOTE_LENGTH) {
    throw new HttpError(400, `The note must be at most ${MAX_NOTE_LENGTH} characters.`)
  }
  await setInstructorNote(req.courseCase!.id, note)
  res.json({ case: await findCase(req.course!.id, req.courseCase!.id) })
})

/**
 * Settings shared by the case's AI witnesses: `{ inWorldDate: 'YYYY-MM-DD' | null,
 * disputedIssues }`, the date "today" in the case and the issues they must leave open.
 */
caseRouter.put('/witness-settings', async (req, res) => {
  const date = readString(req.body, 'inWorldDate').trim()
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)))) {
    throw new HttpError(400, 'Enter a valid date.')
  }
  const disputedIssues = readString(req.body, 'disputedIssues').trim()
  if (disputedIssues.length > MAX_NOTE_LENGTH) {
    throw new HttpError(400, `The disputed issues must be at most ${MAX_NOTE_LENGTH} characters.`)
  }
  await setWitnessSettings(req.courseCase!.id, { inWorldDate: date || null, disputedIssues })
  res.json({ case: await findCase(req.course!.id, req.courseCase!.id) })
})

/**
 * The case's background investigator: `{ enabled, name, instructions }`.
 * Without him the case has no investigate phase, so he can't be turned off
 * while the case is in it.
 */
caseRouter.put('/investigator', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  if (typeof body.enabled !== 'boolean') throw new HttpError(400, 'Say whether the case has a background investigator.')
  const name = readString(req.body, 'name').trim() || DEFAULT_INVESTIGATOR_NAME
  if (name.length > MAX_TITLE_LENGTH) throw new HttpError(400, `The name must be at most ${MAX_TITLE_LENGTH} characters.`)
  const instructions = readString(req.body, 'instructions').trim()
  if (instructions.length > MAX_NOTE_LENGTH) {
    throw new HttpError(400, `The instructions must be at most ${MAX_NOTE_LENGTH} characters.`)
  }
  if (!body.enabled && req.courseCase!.phase === 'investigate') {
    throw new HttpError(409, 'Move the case out of the investigate phase before turning off the investigator.')
  }
  res.json({ case: await setInvestigator(req.course!.id, req.courseCase!.id, { enabled: body.enabled, name, instructions }) })
})

/** `{ reviewMode }`: all (the instructor reviews everything) or lite (only what students flag). */
caseRouter.put('/review-mode', async (req, res) => {
  const mode = readString(req.body, 'reviewMode')
  if (!REVIEW_MODES.includes(mode as ReviewMode)) throw new HttpError(400, 'Choose how to review this case.')
  res.json({ case: await setReviewMode(req.course!.id, req.courseCase!.id, mode as ReviewMode) })
})

/** The case's running list of new facts: what's settled for all worlds and each one. */
caseRouter.get('/facts', async (req, res) => {
  res.json({ facts: await caseFacts(req.courseCase!) })
})

/**
 * Moves every world in the case to `{ phase }`: introduction, information
 * exchange (once it's set up), investigate (with an investigator), or
 * deposition. Leaving the introduction phase shares the instructor's initial
 * disclosures with both sides; going back to it takes them back.
 */
/**
 * Copies the case into a class the instructor teaches (this one or another):
 * `{ courseId, includeTasks, title }`. The copy is a draft whose setup is its
 * teams and worlds.
 */
caseRouter.post('/duplicate', async (req, res) => {
  const body = req.body as Record<string, unknown> | undefined
  const courseId = readString(body, 'courseId') || req.course!.id
  if (!isUuid(courseId)) throw new HttpError(404, 'Class not found.')
  const title = readString(body, 'title').trim()
  if (title.length > MAX_TITLE_LENGTH) throw new HttpError(400, `Keep the title to ${MAX_TITLE_LENGTH} characters.`)
  const copy = await duplicateCase(req.courseCase!.id, req.user!.id, courseId, { includeTasks: body?.includeTasks !== false, title })
  res.status(201).json({ case: copy, courseId })
})

/** Shares the case with another instructor, by email: `{ email, includeTasks }`. They accept or decline it. */
caseRouter.post('/share', async (req, res) => {
  const body = req.body as Record<string, unknown> | undefined
  const share = await shareCase(req.courseCase!.id, req.user!.id, readString(body, 'email'), body?.includeTasks !== false)
  res.status(201).json({ share })
})

caseRouter.put('/phase', async (req, res) => {
  const phase = readString(req.body, 'phase') as CasePhase
  const current = req.courseCase!
  if (!CASE_PHASES.includes(phase)) throw new HttpError(400, 'Choose a valid phase.')
  if (!casePhases(current.investigator.enabled, current.exchangeReady).includes(phase)) {
    throw new HttpError(
      409,
      phase === 'investigate'
        ? 'This case has no background investigator, so it has no investigate phase.'
        : 'Set up information exchange before moving the case to that phase.',
    )
  }
  if (current.status === 'closed') {
    throw new HttpError(409, 'This case is closed, so its phase can no longer change.')
  }
  const updated = await setCasePhase(req.course!.id, current.id, phase)
  await applyDisclosures(current.id, requestsOpen(phase))
  res.json({ case: updated })
})

/** The guided setup reached `{ step }` (the furthest step is kept). */
caseRouter.put('/setup', async (req, res) => {
  const step = readString(req.body, 'step')
  if (!SETUP_STEPS.includes(step as SetupStep)) throw new HttpError(400, 'Choose a valid setup step.')
  res.json({ case: await reachSetupStep(req.course!.id, req.courseCase!.id, step as SetupStep) })
})

/** The instructor finished the guided setup; the case page shows its tabs from now on. */
caseRouter.post('/setup/complete', async (req, res) => {
  res.json({ case: await completeSetup(req.course!.id, req.courseCase!.id) })
})

/** What still has to happen before the case worlds can launch. */
caseRouter.get('/launch', async (req, res) => {
  res.json({ checks: await launchChecks(req.course!.id, req.courseCase!.id) })
})

/** Launches every case world at once: makes a ready draft case active. */
caseRouter.post('/launch', async (req, res) => {
  const current = req.courseCase!
  if (current.status !== 'draft') throw new HttpError(409, 'This case has already been launched.')
  const unmet = (await launchChecks(req.course!.id, current.id)).filter((c) => !c.ok)
  if (unmet.length > 0) {
    throw new HttpError(409, `Not ready to launch: ${unmet.map((c) => c.message).join(' ')}`)
  }
  const launched = await updateCase(req.course!.id, current.id, {
    title: current.title,
    summary: current.summary,
    status: 'active',
  })
  res.json({ case: launched })
})

/**
 * The case dashboard as a student would see it: `?side=plaintiff|defense`,
 * and optionally `&matchup=<id>` to see one case world's team on that side.
 */
caseRouter.get('/preview', async (req, res) => {
  const side = req.query.side
  if (side !== 'plaintiff' && side !== 'defense') throw new HttpError(400, 'Choose a side to preview.')
  const matchup = typeof req.query.matchup === 'string' && req.query.matchup ? req.query.matchup : null
  if (matchup !== null && !isUuid(matchup)) throw new HttpError(404, 'Case world not found.')
  const workspace = await getPreviewWorkspace(req.course!.id, req.courseCase!.id, side, matchup)
  if (!workspace) throw new HttpError(404, 'Case world not found.')
  res.json({ workspace })
})
casesRouter.use('/:caseId', caseRouter)
