import { Router, type Request } from 'express'
import { pool } from '../db/pool.ts'
import { HttpError } from '../httpError.ts'
import { isUuid, readString } from '../validation.ts'
import { findCase, type CasePhase } from '../courses/cases.ts'
import type { Side } from '../courses/matchups.ts'
import { findStudentTeamId, getStudentWorkspace } from '../courses/workspace.ts'
import {
  compareDisclosures,
  completeExchangeSetup,
  DAYS_RANGE,
  disclosureOptions,
  EXCHANGE_KINDS,
  exchangeOverview,
  findOpponent,
  findSubmission,
  getSettings,
  LIMIT_RANGE,
  listCaseRequests,
  listTeamRequests,
  markExchangeSeen,
  requestsOpen,
  respondToRequest,
  saveSettings,
  sendRequest,
  setDisclosures,
  SUBPOENA_TYPES,
  submitDisclosures,
  usedCount,
  type DisclosureOption,
  type DisclosureReview,
  type DisclosureSubmission,
  type ExchangeKind,
  type ExchangeRequest,
  type Firm,
  type ItemResponse,
  type PartSettings,
  type SettingsInput,
  type SubpoenaSettings,
  type SubpoenaType,
  type TeamContext,
} from './exchange.ts'
import { runCheck, submissionCheck, type CheckDraft } from './discoveryChecks.ts'
import {
  markSubpoenasSeen,
  serveSubpoena,
  subpoenaType,
  subpoenaNotices,
  teamSubpoenas,
  type SubpoenaNotice,
  type TeamSubpoena,
} from './subpoenas.ts'

const MAX_NAME_LENGTH = 120
const MAX_REASON_LENGTH = 1000

const field = (body: unknown, key: string) => (body as Record<string, unknown> | undefined)?.[key]

function readPart(body: unknown, key: string, label: string, withLimits: boolean): PartSettings {
  const part = field(body, key) as Record<string, unknown> | undefined
  if (typeof part?.enabled !== 'boolean') throw new HttpError(400, `Say whether the case includes ${label}.`)
  if (!withLimits) return { enabled: part.enabled, limit: 1, days: 1 }
  const whole = (value: unknown, { min, max }: { min: number; max: number }, what: string) => {
    if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
      throw new HttpError(400, `The ${what} for ${label} must be a whole number from ${min} to ${max}.`)
    }
    return value as number
  }
  return { enabled: part.enabled, limit: whole(part.limit, LIMIT_RANGE, 'limit'), days: whole(part.days, DAYS_RANGE, 'days to respond') }
}

/** The kinds of request a subpoena may make; all of them when not given. */
function readSubpoenaTypes(body: unknown): SubpoenaType[] {
  const types = (field(body, 'subpoenas') as Record<string, unknown> | undefined)?.types
  if (types === undefined) return [...SUBPOENA_TYPES]
  if (!Array.isArray(types) || !types.every((t) => (SUBPOENA_TYPES as readonly unknown[]).includes(t))) {
    throw new HttpError(400, 'Choose what subpoenas can ask for from the list.')
  }
  if (types.length === 0) throw new HttpError(400, 'Choose at least one thing subpoenas can ask for.')
  return SUBPOENA_TYPES.filter((t) => types.includes(t))
}

function readFirm(body: unknown, side: Side): Firm {
  const firm = (field(body, 'firms') as Record<string, unknown> | undefined)?.[side]
  const firmName = readString(firm, 'firm').trim()
  const partner = readString(firm, 'partner').trim()
  if (firmName.length > MAX_NAME_LENGTH || partner.length > MAX_NAME_LENGTH) {
    throw new HttpError(400, `Firm and partner names must be at most ${MAX_NAME_LENGTH} characters.`)
  }
  return { firm: firmName, partner }
}

/** Validates `{ disclosures: { enabled }, subpoenas, interrogatories, rfas: { enabled, limit, days }, firms }`. */
function readSettings(body: unknown): SettingsInput {
  return {
    disclosures: { enabled: readPart(body, 'disclosures', 'initial disclosures', false).enabled },
    subpoenas: { ...readPart(body, 'subpoenas', 'subpoenas', true), types: readSubpoenaTypes(body) },
    interrogatories: readPart(body, 'interrogatories', 'interrogatories', true),
    rfas: readPart(body, 'rfas', 'requests for admission', true),
    firms: { plaintiff: readFirm(body, 'plaintiff'), defense: readFirm(body, 'defense') },
  }
}

const readIds = (body: unknown, key: string) => {
  const value = field(body, key) ?? []
  if (!Array.isArray(value) || !value.every(isUuid)) throw new HttpError(400, 'Choose witnesses and case files from this case.')
  return value as string[]
}

/** Mounted under /api/courses/:courseId/cases/:caseId/exchange, after the case is loaded. Instructors only. */
export const exchangeRouter = Router({ mergeParams: true })

/** The settings, and what each side could disclose. */
exchangeRouter.get('/', async (req, res) => {
  const caseId = req.courseCase!.id
  res.json({ settings: await getSettings(caseId), options: await disclosureOptions(caseId) })
})

exchangeRouter.put('/', async (req, res) => {
  res.json({ settings: await saveSettings(req.courseCase!.id, readSettings(req.body)) })
})

/** The instructor's initial disclosures: `{ materialIds, witnessIds }`. */
exchangeRouter.put('/disclosures', async (req, res) => {
  const { id, phase } = req.courseCase!
  res.json({ settings: await setDisclosures(id, phase, readIds(req.body, 'materialIds'), readIds(req.body, 'witnessIds')) })
})

/** Finishes the setup: students see the exchange, and the case has its phase. */
exchangeRouter.post('/complete', async (req, res) => {
  const settings = await completeExchangeSetup(req.courseCase!.id)
  res.json({ settings, case: await findCase(req.course!.id, req.courseCase!.id) })
})

/** Initial disclosure submissions, request activity, and what the next phase shares. */
exchangeRouter.get('/overview', async (req, res) => {
  res.json({ overview: await exchangeOverview(req.courseCase!.id) })
})

/** Every set teams have sent each other, with the responses: the instructor's read-only view. */
exchangeRouter.get('/requests', async (req, res) => {
  res.json({ requests: await listCaseRequests(req.courseCase!.id) })
})

// Students -------------------------------------------------------------------

/** One part of the exchange as a team sees it: its limit, what it has left, and its sets. */
export interface StudentPart {
  limit: number
  days: number
  used: number
  remaining: number
  requests: (ExchangeRequest & { seen: boolean; direction: 'sent' | 'received' })[]
}

/** The team's subpoenas: its limit, what it has left, the ones it served, and notice of the other team's. */
export interface StudentSubpoenas {
  /** What the team may ask for. */
  types: SubpoenaType[]
  limit: number
  days: number
  used: number
  remaining: number
  served: TeamSubpoena[]
  notices: SubpoenaNotice[]
}

// Shape sent to the client; matches `StudentExchange` in src/courses/types.ts.
export interface StudentExchange {
  phase: CasePhase
  /** Whether teams can send and respond (after the introduction phase). */
  requestsOpen: boolean
  side: Side
  teamNumber: number
  opponentNumber: number
  /** The firm the team works for, and its senior partner. */
  firm: Firm
  disclosures: {
    /** Whether the student can still submit (the introduction phase). */
    open: boolean
    options: DisclosureOption[]
    submission: DisclosureSubmission | null
    /** How their picks compare with the instructor's, once the case has moved on. */
    review: DisclosureReview | null
  } | null
  subpoenas: StudentSubpoenas | null
  interrogatories: StudentPart | null
  rfas: StudentPart | null
}

interface StudentContext extends TeamContext {
  phase: CasePhase
  active: boolean
}

/**
 * The student's team in its case world, in a launched case whose information
 * exchange is set up. Null when there's nothing for them yet (not set up, or
 * their team isn't matched).
 */
async function studentContext(req: Request): Promise<StudentContext | null> {
  const { courseId, caseId } = req.params as Record<string, string>
  const workspace = isUuid(courseId) && isUuid(caseId) ? await getStudentWorkspace(courseId, caseId, req.user!.id) : null
  if (!workspace) throw new HttpError(404, 'Case not found.')
  const teamId = await findStudentTeamId(caseId, req.user!.id)
  const opponent = teamId ? await findOpponent(teamId) : null
  if (!workspace.exchangeReady || !teamId || !opponent || !workspace.side) return null
  return {
    caseId,
    teamId,
    opponentTeamId: opponent.teamId,
    side: workspace.side,
    userId: req.user!.id,
    phase: workspace.case.phase,
    active: workspace.case.status === 'active',
  }
}

async function requireStudentContext(req: Request) {
  const ctx = await studentContext(req)
  if (!ctx) throw new HttpError(409, 'Your team needs a case world, and the information exchange needs to be set up.')
  if (!ctx.active) throw new HttpError(409, 'This case is closed, so the information exchange has finished.')
  return ctx
}

async function studentExchange(ctx: StudentContext): Promise<StudentExchange> {
  const [settings, options, submission, requests] = await Promise.all([
    getSettings(ctx.caseId),
    disclosureOptions(ctx.caseId),
    findSubmission(ctx.caseId, ctx.userId),
    listTeamRequests(ctx.caseId, ctx.teamId, ctx.userId),
  ])
  const sideOptions = options.filter((o) => o.side === ctx.side)
  const keyIds = new Set(sideOptions.map((o) => o.id))
  const key = {
    materialIds: settings.disclosures.materialIds.filter((id) => keyIds.has(id)),
    witnessIds: settings.disclosures.witnessIds.filter((id) => keyIds.has(id)),
  }
  const open = requestsOpen(ctx.phase)
  const part = async (kind: ExchangeKind, p: PartSettings): Promise<StudentPart | null> => {
    if (!p.enabled) return null
    const used = await usedCount(ctx.caseId, ctx.teamId, kind)
    return {
      limit: p.limit,
      days: p.days,
      used,
      remaining: Math.max(0, p.limit - used),
      requests: requests
        .filter((r) => r.kind === kind)
        .map((r) => ({ ...r, direction: r.fromTeam.id === ctx.teamId ? 'sent' : 'received' })),
    }
  }
  const subpoenas = async (p: SubpoenaSettings): Promise<StudentSubpoenas | null> => {
    if (!p.enabled) return null
    const [served, notices] = await Promise.all([teamSubpoenas(ctx.caseId, ctx.teamId, ctx.userId), subpoenaNotices(ctx.caseId, ctx.teamId, ctx.userId)])
    return { types: p.types, limit: p.limit, days: p.days, used: served.length, remaining: Math.max(0, p.limit - served.length), served, notices }
  }
  const numbers = await teamNumbers(ctx)
  return {
    phase: ctx.phase,
    requestsOpen: open,
    side: ctx.side,
    teamNumber: numbers.team,
    opponentNumber: numbers.opponent,
    firm: settings.firms[ctx.side],
    disclosures: settings.disclosures.enabled
      ? {
          open: ctx.phase === 'introduction',
          options: sideOptions,
          submission,
          review: open ? compareDisclosures(submission, sideOptions, key) : null,
        }
      : null,
    subpoenas: await subpoenas(settings.subpoenas),
    interrogatories: await part('interrogatories', settings.interrogatories),
    rfas: await part('rfas', settings.rfas),
  }
}

async function teamNumbers(ctx: TeamContext) {
  const { rows } = await pool.query<{ team: number; opponent: number }>(
    `SELECT (SELECT number FROM teams WHERE id = $1) AS team, (SELECT number FROM teams WHERE id = $2) AS opponent`,
    [ctx.teamId, ctx.opponentTeamId],
  )
  return rows[0]
}

/** Mounted under /api/courses/:courseId/my-cases/:caseId/exchange. */
export const myExchangeRouter = Router({ mergeParams: true })

/** The team's information exchange, or `{ exchange: null }` when there's nothing for them yet. */
myExchangeRouter.get('/', async (req, res) => {
  const ctx = await studentContext(req)
  res.json({ exchange: ctx ? await studentExchange(ctx) : null })
})

/**
 * The student's initial disclosures, once: `{ picks: [{ kind, id, reason }], heldBackReason }`.
 * Every pick needs a reason, and so does holding anything back.
 */
myExchangeRouter.post('/disclosures', async (req, res) => {
  const ctx = await requireStudentContext(req)
  const settings = await getSettings(ctx.caseId)
  if (!settings.disclosures.enabled) throw new HttpError(409, "This case doesn't include initial disclosures.")
  if (ctx.phase !== 'introduction') throw new HttpError(409, 'Initial disclosures closed when the case moved on.')
  const raw = field(req.body, 'picks')
  if (!Array.isArray(raw)) throw new HttpError(400, 'Send your picks as a list.')
  const picks = raw.map((p) => {
    const kind = readString(p, 'kind')
    const id = readString(p, 'id')
    const reason = readString(p, 'reason').trim()
    if ((kind !== 'witness' && kind !== 'material') || !isUuid(id)) throw new HttpError(400, "Choose from your side's witnesses and documents.")
    if (!reason) throw new HttpError(400, 'Write a reason for each witness and document you disclose.')
    if (reason.length > MAX_REASON_LENGTH) throw new HttpError(400, `Keep each reason to ${MAX_REASON_LENGTH} characters.`)
    return { kind: kind as 'witness' | 'material', id, reason }
  })
  const heldBackReason = readString(req.body, 'heldBackReason').trim()
  const options = (await disclosureOptions(ctx.caseId)).filter((o) => o.side === ctx.side)
  if (picks.length < options.length && !heldBackReason) {
    throw new HttpError(400, "Say why you're holding back the rest.")
  }
  if (heldBackReason.length > MAX_REASON_LENGTH) throw new HttpError(400, `Keep your reason to ${MAX_REASON_LENGTH} characters.`)
  await submitDisclosures(ctx.caseId, ctx.userId, ctx.side, picks, heldBackReason)
  res.status(201).json({ exchange: await studentExchange(ctx) })
})

/** Sends a set to the other team: `{ kind: 'interrogatories' | 'rfas', items: string[] }`, one per line. */
myExchangeRouter.post('/requests', async (req, res) => {
  const ctx = await requireStudentContext(req)
  if (!requestsOpen(ctx.phase)) throw new HttpError(409, 'Requests open in the information exchange phase.')
  const kind = readString(req.body, 'kind') as ExchangeKind
  if (!EXCHANGE_KINDS.includes(kind)) throw new HttpError(400, 'Choose interrogatories or requests for admission.')
  const settings = await getSettings(ctx.caseId)
  if (!settings[kind].enabled) throw new HttpError(409, "This case doesn't include that kind of request.")
  const items = readItems(req.body)
  const check = await submissionCheck(ctx, field(req.body, 'checkId'), { kind, mode: 'draft', items })
  await sendRequest(ctx, kind, settings[kind], items, check)
  res.status(201).json({ exchange: await studentExchange(ctx) })
})

function readItems(body: unknown) {
  const items = field(body, 'items')
  if (!Array.isArray(items) || items.some((t) => typeof t !== 'string')) throw new HttpError(400, 'Send one question per line.')
  return items as string[]
}

function readResponses(body: unknown): ItemResponse[] {
  const raw = field(body, 'responses')
  if (!Array.isArray(raw)) throw new HttpError(400, 'Send a response for each item.')
  return raw.map((r) => {
    const admission = readString(r, 'admission')
    return {
      position: Number(field(r, 'position')),
      answer: readString(r, 'answer'),
      objection: field(r, 'objection') === true,
      admission: admission === 'agree' || admission === 'disagree' || admission === 'partial' ? admission : null,
      agreePart: readString(r, 'agreePart'),
      disagreePart: readString(r, 'disagreePart'),
    }
  })
}

const readSubpoena = (body: unknown, settings: SubpoenaSettings) => ({
  recipient: readString(body, 'recipient'),
  recipientDescription: readString(body, 'recipientDescription'),
  requestType: subpoenaType(readString(body, 'requestType'), settings),
  records: readString(body, 'records'),
  justification: readString(body, 'justification'),
})

/**
 * Has the discovery mentor check a draft before it's sent: `{ kind, mode,
 * requestId, draft }`. A subpoena's `draft` is the subpoena; a set's is `{
 * items }`; answers (mode answer, with the set's `requestId`) are `{
 * responses }`. Returns `{ check: { id, tag, feedback } }`; send the `id` with
 * the submission.
 */
myExchangeRouter.post('/check', async (req, res) => {
  const ctx = await requireStudentContext(req)
  if (!requestsOpen(ctx.phase)) throw new HttpError(409, 'Requests open in the information exchange phase.')
  const settings = await getSettings(ctx.caseId)
  const kind = readString(req.body, 'kind')
  const mode = readString(req.body, 'mode')
  const draftBody = field(req.body, 'draft')
  let draft: CheckDraft
  if (kind === 'subpoena') {
    if (!settings.subpoenas.enabled) throw new HttpError(409, "This case doesn't include subpoenas.")
    const subpoena = readSubpoena(draftBody, settings.subpoenas)
    if (!subpoena.recipient.trim() || !subpoena.records.trim()) throw new HttpError(400, 'Fill in who the subpoena is for and what you want first.')
    draft = { kind, mode: 'draft', subpoena }
  } else if (EXCHANGE_KINDS.includes(kind as ExchangeKind)) {
    if (!settings[kind as ExchangeKind].enabled) throw new HttpError(409, "This case doesn't include that kind of request.")
    if (mode === 'answer') {
      const requestId = readString(req.body, 'requestId')
      if (!isUuid(requestId)) throw new HttpError(404, 'Request not found.')
      draft = { kind: kind as ExchangeKind, mode: 'answer', requestId, responses: readResponses(draftBody) }
    } else {
      const items = readItems(draftBody)
      if (!items.some((t) => t.trim())) throw new HttpError(400, 'Write at least one question first.')
      draft = { kind: kind as ExchangeKind, mode: 'draft', items }
    }
  } else throw new HttpError(400, 'Choose what to check.')
  res.json({ check: await runCheck(ctx, draft) })
})

/** The team's responses to a set it received: `{ responses: [{ position, answer, objection, admission, agreePart, disagreePart }] }`. */
myExchangeRouter.post('/requests/:requestId/responses', async (req, res) => {
  const ctx = await requireStudentContext(req)
  const requestId = req.params.requestId
  if (!isUuid(requestId)) throw new HttpError(404, 'Request not found.')
  const responses = readResponses(req.body)
  const { rows } = await pool.query<{ kind: ExchangeKind }>('SELECT kind FROM exchange_requests WHERE id = $1 AND case_id = $2', [
    requestId,
    ctx.caseId,
  ])
  const check = rows[0]
    ? await submissionCheck(ctx, field(req.body, 'checkId'), { kind: rows[0].kind, mode: 'answer', requestId, responses })
    : null
  await respondToRequest(ctx, requestId, responses, check)
  res.json({ exchange: await studentExchange(ctx) })
})

/**
 * Serves a subpoena: `{ recipient, recipientDescription, requestType, records,
 * justification, checkId }`: who it's for and who they are, what kind of
 * request, what it wants, how the team would justify it to the judge, and the
 * discovery mentor's check before it (optional).
 */
myExchangeRouter.post('/subpoenas', async (req, res) => {
  const ctx = await requireStudentContext(req)
  if (!requestsOpen(ctx.phase)) throw new HttpError(409, 'Subpoenas open in the information exchange phase.')
  const settings = await getSettings(ctx.caseId)
  if (!settings.subpoenas.enabled) throw new HttpError(409, "This case doesn't include subpoenas.")
  const subpoena = readSubpoena(req.body, settings.subpoenas)
  const check = await submissionCheck(ctx, field(req.body, 'checkId'), { kind: 'subpoena', mode: 'draft', subpoena })
  await serveSubpoena(ctx, settings.subpoenas, subpoena, check)
  res.status(201).json({ exchange: await studentExchange(ctx) })
})

/** Marks the responses to the team's sets, and the answers to its subpoenas, as read by this student. */
myExchangeRouter.post('/seen', async (req, res) => {
  const ctx = await studentContext(req)
  if (ctx) {
    await markExchangeSeen(ctx.caseId, ctx.teamId, ctx.userId)
    await markSubpoenasSeen(ctx.caseId, ctx.teamId, ctx.userId)
  }
  res.status(204).end()
})
