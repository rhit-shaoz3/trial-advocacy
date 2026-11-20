import { ai } from '../ai/ai.ts'
import { findWitness, type Witness } from '../courses/caseContent.ts'
import { findCase, type CourseCase } from '../courses/cases.ts'
import type { Side } from '../courses/matchups.ts'
import { findStudentTeamId, getStudentWorkspace, teamMatchupId, type CaseWorkspace } from '../courses/workspace.ts'
import { pool } from '../db/pool.ts'
import { getSettings } from '../exchange/exchange.ts'
import { HttpError } from '../httpError.ts'
import { settledFacts } from '../reviews/reviews.ts'
import { isUuid } from '../validation.ts'
import {
  asExhibits,
  INTERVIEW_MINUTES,
  MAX_EXHIBITS,
  MAX_QUESTION_LENGTH,
  withExhibits,
  witnessHttpError,
  type Exhibit,
} from '../witness/interviews.ts'
import { testimonyMemory } from '../witness/memory.ts'
import { depositionSettings, isAiWitness, loadProfile } from '../witness/profile.ts'
import { isTrialExam, type Cooperation, type PracticeSettings, type PracticeType } from '../witness/prompt.ts'
import type { PracticeBlocks, PracticeTurnKind } from './turn.ts'

// A student's practice sessions with the AI witnesses. Each is the student's
// own (not their partner's): one witness, one setting (an interview or
// deposition, or at trial a direct, cross or redirect), and what they want to
// practice. The witness answers as it always would, from the same facts and
// the team's real testimony, but nothing said here goes anywhere: practice
// sessions have tables of their own, so no interview count, witness memory,
// new facts, planner, exhibit list or packet ever reads them. Only the
// student's learning library does. The instructor caps the sessions each
// student has in the case; one counts once it has a turn.

export const PRACTICE_TYPES: PracticeType[] = ['interview', 'deposition', 'direct', 'cross', 'redirect']
export const COOPERATION: Cooperation[] = ['hostile', 'regular', 'cooperative']
/** Practice is for one point or section, so a session is shorter than an interview can be. */
export const PRACTICE_MAX_TURNS = 100
export const MAX_GOAL_LENGTH = 2000
export const MAX_TONE_LENGTH = 500
export const MAX_PRIOR_LENGTH = 4000
const SESSION_MS = INTERVIEW_MINUTES * 60 * 1000

/** Who objects at trial when the other side's firm has no partner named. */
export const DEFAULT_OPPOSING_COUNSEL = 'Opposing counsel'

/**
 * The settings a witness offers: the team's own witnesses are interviewed and
 * examined on direct and redirect; the other side's are deposed and crossed.
 */
export const practiceTypesFor = (witnessSide: Side | null, teamSide: Side): PracticeType[] =>
  witnessSide === teamSide ? ['interview', 'direct', 'redirect'] : ['deposition', 'cross']

export interface PracticeContext {
  courseCase: CourseCase
  workspace: CaseWorkspace
  teamId: string
  side: Side
  matchupId: string | null
  userId: string
  closed: boolean
  exhibits: Exhibit[]
}

/**
 * The student's practice in a case, or a 409 saying why there's none: it's
 * off, or the student has no team in a case world yet.
 */
export async function practiceContext(courseId: string, caseId: string, userId: string): Promise<PracticeContext> {
  const workspace = isUuid(courseId) && isUuid(caseId) ? await getStudentWorkspace(courseId, caseId, userId) : null
  if (!workspace) throw new HttpError(404, 'Case not found.')
  if (!workspace.practice.enabled) throw new HttpError(409, 'Your instructor hasn’t turned on practice for this case.')
  const teamId = await findStudentTeamId(caseId, userId)
  const matchupId = teamId ? await teamMatchupId(teamId) : null
  if (!teamId || !matchupId || !workspace.side) throw new HttpError(409, 'You can practice once your team is in a case world.')
  const courseCase = (await findCase(courseId, caseId))!
  return {
    courseCase,
    workspace,
    teamId,
    side: workspace.side,
    matchupId,
    userId,
    closed: workspace.case.status !== 'active',
    exhibits: asExhibits(workspace.materials),
  }
}

export interface PracticeTurn {
  position: number
  kind: PracticeTurnKind
  text: string
  blocks: PracticeBlocks
  createdAt: Date
}

// Shape sent to the client; matches `PracticeSession` in src/courses/types.ts.
export interface PracticeSession {
  id: string
  witness: { id: string; name: string; role: string; avatarUrl: string | null }
  side: Side
  type: PracticeType
  goal: string
  cooperation: Cooperation
  toneNotes: string
  priorTestimony: string
  /** At trial, the other side's lawyer who objects. */
  opposingCounsel: string | null
  turns: PracticeTurn[]
  /** What the student has to do next: rework a held question, or answer an objection. */
  pending: 'hold' | 'objection' | null
  maxTurns: number
  exhibits?: Exhibit[]
  /** An hour after the first turn. */
  endsAt: Date | null
  endedAt: Date | null
  canAsk: boolean
  notice: string | null
  /** The student's sessions in the case, against the instructor's cap (this one included once it counts). */
  limit: { max: number; used: number }
  createdAt: Date
}

interface SessionRow {
  id: string
  witnessId: string
  side: Side
  type: PracticeType
  goal: string
  cooperation: Cooperation
  toneNotes: string
  priorTestimony: string
  createdAt: Date
  endedAt: Date | null
}

const SESSION_COLUMNS = `s.id, s.witness_id AS "witnessId", s.side, s.practice_type AS type, s.goal, s.cooperation,
  s.tone_notes AS "toneNotes", s.prior_testimony AS "priorTestimony", s.created_at AS "createdAt", s.ended_at AS "endedAt"`

async function findSession(ctx: PracticeContext, id: string) {
  if (!isUuid(id)) throw new HttpError(404, 'Practice session not found.')
  const { rows } = await pool.query<SessionRow>(
    `SELECT ${SESSION_COLUMNS} FROM practice_sessions s WHERE s.id = $1 AND s.case_id = $2 AND s.user_id = $3`,
    [id, ctx.courseCase.id, ctx.userId],
  )
  if (!rows[0]) throw new HttpError(404, 'Practice session not found.')
  return rows[0]
}

export async function listPracticeTurns(sessionId: string) {
  const { rows } = await pool.query<PracticeTurn & { reply: string }>(
    `SELECT position, kind, text, reply, blocks, created_at AS "createdAt"
     FROM practice_turns WHERE session_id = $1 ORDER BY position`,
    [sessionId],
  )
  return rows
}

/** The student's counted sessions in the case: the others, and whether this one counts yet. */
async function sessionsUsed(ctx: PracticeContext, sessionId: string | null) {
  const { rows } = await pool.query<{ others: number; current: boolean }>(
    `SELECT count(*) FILTER (WHERE s.id IS DISTINCT FROM $3)::int AS others, coalesce(bool_or(s.id = $3), false) AS current
     FROM practice_sessions s
     WHERE s.case_id = $1 AND s.user_id = $2 AND EXISTS (SELECT 1 FROM practice_turns t WHERE t.session_id = s.id)`,
    [ctx.courseCase.id, ctx.userId, sessionId],
  )
  return rows[0]
}

/** What the last turn left the student to do. */
export function pendingOf(turns: Pick<PracticeTurn, 'blocks'>[]): PracticeSession['pending'] {
  const last = turns.at(-1)?.blocks
  if (last?.hold) return 'hold'
  if (last?.awaitResponse) return 'objection'
  return null
}

async function opposingCounsel(ctx: PracticeContext) {
  const other: Side = ctx.side === 'plaintiff' ? 'defense' : 'plaintiff'
  return (await getSettings(ctx.courseCase.id)).firms[other].partner.trim() || DEFAULT_OPPOSING_COUNSEL
}

const limitReached = (max: number) =>
  `You’ve used your ${max === 1 ? 'practice session' : `${max} practice sessions`} in this case.`

async function view(ctx: PracticeContext, row: SessionRow, witness: Witness): Promise<PracticeSession> {
  const [turns, used, counsel] = await Promise.all([
    listPracticeTurns(row.id),
    sessionsUsed(ctx, row.id),
    isTrialExam(row.type) ? opposingCounsel(ctx) : null,
  ])
  const max = ctx.workspace.practice.limit
  const endsAt = turns.length ? new Date(new Date(turns[0].createdAt).getTime() + SESSION_MS) : null
  const reason = ctx.closed
    ? 'This case is closed, so practice is over.'
    : row.endedAt
      ? 'This practice session has ended. It’s in your learning library.'
      : !isAiWitness(witness)
        ? `${witness.name} isn’t available for practice right now.`
        : !used.current && used.others >= max
          ? limitReached(max)
          : turns.length >= PRACTICE_MAX_TURNS
            ? 'This session has reached its question limit. Start a new one to keep practicing.'
            : null
  return {
    id: row.id,
    witness: { id: witness.id, name: witness.name, role: witness.role, avatarUrl: witness.avatarUrl },
    side: row.side,
    type: row.type,
    goal: row.goal,
    cooperation: row.cooperation,
    toneNotes: row.toneNotes,
    priorTestimony: row.priorTestimony,
    opposingCounsel: counsel,
    turns: turns.map((t) => ({ position: t.position, kind: t.kind, text: t.text, blocks: t.blocks, createdAt: t.createdAt })),
    pending: pendingOf(turns),
    maxTurns: PRACTICE_MAX_TURNS,
    endsAt,
    endedAt: row.endedAt,
    canAsk: reason === null,
    notice: reason,
    limit: { max, used: used.others + (used.current ? 1 : 0) },
    createdAt: row.createdAt,
  }
}

/** The session, ended first if its hour is up. */
async function current(ctx: PracticeContext, id: string) {
  let row = await findSession(ctx, id)
  const witness = await findWitness(ctx.courseCase.id, row.witnessId)
  if (!witness) throw new HttpError(404, 'Practice session not found.')
  let shown = await view(ctx, row, witness)
  if (!row.endedAt && shown.endsAt && shown.endsAt <= new Date()) {
    await pool.query('UPDATE practice_sessions SET ended_at = now() WHERE id = $1 AND ended_at IS NULL', [row.id])
    row = await findSession(ctx, id)
    shown = await view(ctx, row, witness)
  }
  return { row, witness, session: { ...shown, exhibits: ctx.exhibits } }
}

export const getPracticeSession = async (ctx: PracticeContext, id: string) => (await current(ctx, id)).session

/** The student's sessions in the case, newest first, with the cap. */
export async function practiceOverview(ctx: PracticeContext) {
  const [{ rows }, used] = await Promise.all([
    pool.query<{
      id: string
      witnessId: string
      witnessName: string
      type: PracticeType
      goal: string
      turns: number
      createdAt: Date
      endedAt: Date | null
    }>(
      `SELECT s.id, s.witness_id AS "witnessId", w.name AS "witnessName", s.practice_type AS type, s.goal, s.created_at AS "createdAt", s.ended_at AS "endedAt",
              (SELECT count(*)::int FROM practice_turns t WHERE t.session_id = s.id) AS turns
       FROM practice_sessions s JOIN case_witnesses w ON w.id = s.witness_id
       WHERE s.case_id = $1 AND s.user_id = $2
       ORDER BY s.created_at DESC`,
      [ctx.courseCase.id, ctx.userId],
    ),
    sessionsUsed(ctx, null),
  ])
  return {
    limit: { max: ctx.workspace.practice.limit, used: used.others },
    sessions: rows,
  }
}

function readText(body: Record<string, unknown>, key: string, max: number, what: string, required = false) {
  const value = body[key] ?? ''
  if (typeof value !== 'string') throw new HttpError(400, `Write ${what} as text.`)
  const text = value.trim()
  if (required && !text) throw new HttpError(400, `Say ${what}.`)
  if (text.length > max) throw new HttpError(400, `Keep ${what} to ${max} characters.`)
  return text
}

/**
 * Starts a session: `{ witnessId, type, goal, cooperation?, toneNotes?,
 * priorTestimony? }`. The witness must be one the team can talk to now, in a
 * setting it offers.
 */
export async function startPractice(ctx: PracticeContext, raw: unknown) {
  if (ctx.closed) throw new HttpError(409, 'This case is closed, so practice is over.')
  const body = (raw ?? {}) as Record<string, unknown>
  const witnessId = String(body.witnessId ?? '')
  const seen = isUuid(witnessId) ? ctx.workspace.witnesses.find((w) => w.id === witnessId) : undefined
  if (!seen) throw new HttpError(404, 'Witness not found.')
  if (seen.locked) throw new HttpError(409, 'You can practice with the other side’s witnesses from the deposition phase on.')
  if (!seen.canInterview) throw new HttpError(409, `${seen.name} isn’t available for practice right now.`)
  const type = body.type as PracticeType
  if (!practiceTypesFor(seen.side, ctx.side).includes(type)) {
    throw new HttpError(400, `Choose a setting ${seen.name} can be practiced in.`)
  }
  const cooperation = (body.cooperation ?? 'regular') as Cooperation
  if (!COOPERATION.includes(cooperation)) throw new HttpError(400, 'Choose how cooperative the witness is.')
  const goal = readText(body, 'goal', MAX_GOAL_LENGTH, 'what you want to practice', true)
  const toneNotes = readText(body, 'toneNotes', MAX_TONE_LENGTH, 'the witness’s tone')
  const priorTestimony = type === 'cross' || type === 'redirect' ? readText(body, 'priorTestimony', MAX_PRIOR_LENGTH, 'the earlier testimony') : ''
  const used = await sessionsUsed(ctx, null)
  if (used.others >= ctx.workspace.practice.limit) throw new HttpError(409, limitReached(ctx.workspace.practice.limit))
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO practice_sessions (case_id, team_id, user_id, witness_id, side, practice_type, goal, cooperation, tone_notes, prior_testimony)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [ctx.courseCase.id, ctx.teamId, ctx.userId, witnessId, ctx.side, type, goal, cooperation, toneNotes, priorTestimony],
  )
  return getPracticeSession(ctx, rows[0].id)
}

export async function endPractice(ctx: PracticeContext, id: string) {
  const row = await findSession(ctx, id)
  await pool.query('UPDATE practice_sessions SET ended_at = now() WHERE id = $1 AND ended_at IS NULL', [row.id])
  return getPracticeSession(ctx, id)
}

function readExhibits(ctx: PracticeContext, raw: unknown): Exhibit[] {
  const ids = raw ?? []
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw new HttpError(400, 'Choose documents from the case file.')
  const unique = [...new Set(ids as string[])]
  if (unique.length > MAX_EXHIBITS) throw new HttpError(400, `Show at most ${MAX_EXHIBITS} documents with one question.`)
  return unique.map((id) => {
    const exhibit = ctx.exhibits.find((e) => e.id === id)
    if (!exhibit) throw new HttpError(400, 'You can only show the witness files your team has.')
    return exhibit
  })
}

/** The kinds of turn the student can take next. */
const NEXT: Record<'none' | 'hold' | 'objection', PracticeTurnKind[]> = {
  none: ['question'],
  hold: ['edited', 'as_written'],
  // A new question withdraws the one objected to.
  objection: ['objection_response', 'question'],
}

/**
 * The student's next turn: `{ kind, text, exhibitIds? }`. After a hold it
 * must be the question edited, or asked as written (the held words again);
 * after an objection, an answer to it, or a new question. The reply is stored
 * with the session alone.
 */
export async function takePracticeTurn(ctx: PracticeContext, id: string, raw: unknown) {
  const body = (raw ?? {}) as Record<string, unknown>
  const { row, witness, session } = await current(ctx, id)
  if (!session.canAsk) throw new HttpError(409, session.notice!)
  const kind = body.kind as PracticeTurnKind
  if (!NEXT[session.pending ?? 'none'].includes(kind)) {
    throw new HttpError(
      409,
      session.pending === 'hold'
        ? 'Edit the held question, or ask it as written.'
        : session.pending === 'objection'
          ? 'Answer the objection, or ask a new question.'
          : 'Ask a question.',
    )
  }
  const turns = await listPracticeTurns(row.id)
  let text: string
  if (kind === 'as_written') {
    text = turns.at(-1)!.text
  } else {
    text = readText(body, 'text', MAX_QUESTION_LENGTH, kind === 'objection_response' ? 'your response' : 'your question', true)
    if (kind !== 'objection_response') text = withExhibits(text, readExhibits(ctx, body.exhibitIds))
  }

  let reply
  try {
    const profile = await loadProfile(ctx.courseCase, witness, await settledFacts(ctx.courseCase.id, ctx.matchupId), ctx.matchupId)
    const deposition = depositionSettings(profile, witness, ctx.side)
    // At trial the objections come from opposing counsel, not the witness's lawyer.
    const settings = isTrialExam(row.type) ? { ...deposition, defendingCounselName: undefined } : deposition
    const practice: PracticeSettings = {
      type: row.type,
      goal: row.goal,
      cooperation: row.cooperation,
      toneNotes: row.toneNotes || undefined,
      opposingCounselName: session.opposingCounsel ?? DEFAULT_OPPOSING_COUNSEL,
      priorTestimony: row.priorTestimony || undefined,
    }
    reply = await ai.practiceTurn({
      profile,
      settings,
      practice,
      transcript: turns.map((t) => ({ kind: t.kind, text: t.text, reply: t.reply })),
      kind,
      text,
      memory: await earlierTestimony(ctx, witness.id, text),
    })
  } catch (err) {
    throw witnessHttpError(err)
  }

  try {
    await pool.query(
      `INSERT INTO practice_turns (session_id, position, kind, text, reply, blocks, model,
                                   input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        row.id,
        turns.length,
        kind,
        text,
        reply.reply,
        JSON.stringify(reply.blocks),
        reply.model,
        reply.usage.input_tokens,
        reply.usage.output_tokens,
        reply.usage.cache_read_input_tokens ?? null,
        reply.usage.cache_creation_input_tokens ?? null,
      ],
    )
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new HttpError(409, 'That turn was already sent. The session is shown as it is now.')
    throw err
  }
  return getPracticeSession(ctx, row.id)
}

/**
 * What the witness said in the team's real sessions in this world, read the
 * way an interview reads it, so the witness stays consistent. Nothing from
 * practice is ever added to it.
 */
async function earlierTestimony(ctx: PracticeContext, witnessId: string, question: string) {
  if (!ctx.matchupId || process.env.WITNESS_MEMORY === 'off') return []
  try {
    return (await testimonyMemory(witnessId, ctx.matchupId, null, question)).map((c) => c.text)
  } catch (err) {
    console.error('Could not read the testimony for a practice session:', err)
    return []
  }
}
