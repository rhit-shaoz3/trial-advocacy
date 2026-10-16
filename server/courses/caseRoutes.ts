import { Router, type RequestHandler } from 'express'
import { HttpError } from '../httpError.ts'
import { isUuid, readString } from '../validation.ts'
import {
  CASE_STATUSES,
  createCase,
  deleteCase,
  findCase,
  listCases,
  updateCase,
  type CaseFields,
  type CaseStatus,
  type CourseCase,
  type ImportantFacts,
} from './cases.ts'
import { listStorageKeys, removeStoredFiles, setInstructorNote, setWitnessSettings } from './caseContent.ts'
import { materialsRouter, tasksRouter, witnessesRouter } from './caseContentRoutes.ts'
import { matchupsRouter } from './matchupRoutes.ts'
import { teamsRouter } from './teamRoutes.ts'
import { getPreviewWorkspace, launchChecks } from './workspace.ts'

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
 * Reads `importantFacts: { plaintiff: string[], defense: string[] }`. Facts are
 * trimmed and blank ones dropped; each side needs at least one.
 */
function readImportantFacts(body: unknown): ImportantFacts {
  const value = (body as Record<string, unknown> | undefined)?.importantFacts as Record<string, unknown> | undefined
  const readSide = (side: keyof ImportantFacts, label: string) => {
    const list = value?.[side]
    if (list !== undefined && (!Array.isArray(list) || list.some((f) => typeof f !== 'string'))) {
      throw new HttpError(400, `List the ${label}'s important facts as text.`)
    }
    const facts = ((list ?? []) as string[]).map((f) => f.trim()).filter(Boolean)
    if (facts.length === 0) throw new HttpError(400, `List at least one important fact for the ${label}.`)
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
 */
function readCaseFields(body: unknown, defaultStatus?: CaseStatus): CaseFields {
  const title = readString(body, 'title').trim()
  const summary = readString(body, 'summary').trim()
  const status = readString(body, 'status') || defaultStatus

  if (!title) throw new HttpError(400, 'Case title is required.')
  if (title.length > MAX_TITLE_LENGTH) {
    throw new HttpError(400, `Case title must be at most ${MAX_TITLE_LENGTH} characters.`)
  }
  if (summary.length > MAX_SUMMARY_LENGTH) {
    throw new HttpError(400, `Summary must be at most ${MAX_SUMMARY_LENGTH} characters.`)
  }
  if (!CASE_STATUSES.includes(status as CaseStatus)) throw new HttpError(400, 'Choose a valid status.')

  return { title, summary, status: status as CaseStatus, importantFacts: readImportantFacts(body) }
}

/** Mounted under /api/courses/:courseId/cases, after the course is loaded. */
export const casesRouter = Router()

casesRouter.get('/', async (req, res) => {
  res.json({ cases: await listCases(req.course!.id) })
})

casesRouter.post('/', async (req, res) => {
  res.status(201).json({ case: await createCase(req.course!.id, readCaseFields(req.body, 'draft')) })
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
    importantFacts: current.importantFacts,
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
