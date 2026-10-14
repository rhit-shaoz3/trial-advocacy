import { Router } from 'express'
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
} from './cases.ts'

const MAX_TITLE_LENGTH = 120
const MAX_SUMMARY_LENGTH = 2000

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

  return { title, summary, status: status as CaseStatus }
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

casesRouter.delete('/:caseId', async (req, res) => {
  const { caseId } = req.params
  if (!isUuid(caseId) || !(await deleteCase(req.course!.id, caseId))) {
    throw new HttpError(404, 'Case not found.')
  }
  res.status(204).end()
})
