import Anthropic from '@anthropic-ai/sdk'
import { ai, AiNotConfiguredError } from '../ai/ai.ts'
import type { Witness } from '../courses/caseContent.ts'
import type { CourseCase } from '../courses/cases.ts'
import type { Side } from '../courses/matchups.ts'
import { pool } from '../db/pool.ts'
import { HttpError } from '../httpError.ts'
import { readString } from '../validation.ts'
import { WitnessRefusalError } from './deposition.ts'
import { depositionSettings, isAiWitness, loadProfile, WitnessNotReadyError } from './profile.ts'

// A team's interview of an AI witness, stored turn by turn, before the
// deposition. Partners share one interview per witness, always as their own
// team's side: the witness treats them as that side's lawyers. An
// instructor's test runs (no team) are kept apart, one per side. "Start over"
// ends an interview and the next visit opens a new, empty one.

export const MAX_QUESTION_LENGTH = 2000
/** Keeps a runaway interview from growing the prompt (and the bill) without end. */
export const MAX_TURNS = 150

/** Who owns an interview: a team, or the instructor testing (team null). */
export interface InterviewOwner {
  teamId: string | null
  side: Side
}

// Shape sent to the client; matches `Interview` in src/courses/types.ts.
export interface Interview {
  id: string
  side: Side
  witness: { id: string; name: string; role: string }
  turns: { position: number; question: string; objection: string | null; answer: string; askedBy: string | null; createdAt: Date }[]
  maxTurns: number
  /** False when the witness isn't set up yet, or the case is closed. */
  canAsk: boolean
  /** Why questions can't be asked, when they can't. */
  notice: string | null
}

const UNIQUE_VIOLATION = '23505'
const NO_TEAM = '00000000-0000-0000-0000-000000000000'

async function findOpen(witnessId: string, owner: InterviewOwner) {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM interviews
     WHERE witness_id = $1 AND COALESCE(team_id, $2::uuid) = COALESCE($3::uuid, $2::uuid) AND side = $4 AND ended_at IS NULL`,
    [witnessId, NO_TEAM, owner.teamId, owner.side],
  )
  return rows[0]?.id ?? null
}

/** The open interview, started now if there isn't one. */
async function openInterview(witnessId: string, owner: InterviewOwner, userId: string) {
  const existing = await findOpen(witnessId, owner)
  if (existing) return existing
  try {
    const { rows } = await pool.query<{ id: string }>(
      'INSERT INTO interviews (witness_id, team_id, side, started_by) VALUES ($1, $2, $3, $4) RETURNING id',
      [witnessId, owner.teamId, owner.side, userId],
    )
    return rows[0].id
  } catch (err) {
    // A partner opened it at the same moment.
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) return (await findOpen(witnessId, owner))!
    throw err
  }
}

async function listTurns(interviewId: string) {
  const { rows } = await pool.query<Interview['turns'][number] & { reply: string }>(
    `SELECT t.position, t.question, t.reply, t.objection, t.answer, u.name AS "askedBy", t.created_at AS "createdAt"
     FROM interview_turns t LEFT JOIN users u ON u.id = t.asked_by
     WHERE t.interview_id = $1 ORDER BY t.position`,
    [interviewId],
  )
  return rows
}

function notice(witness: Witness, closed: boolean) {
  if (closed) return 'This case is closed, so the interview can no longer continue.'
  if (!isAiWitness(witness)) return `${witness.name} isn't available for interviews yet.`
  return null
}

async function view(witness: Witness, owner: InterviewOwner, interviewId: string, closed: boolean): Promise<Interview> {
  const turns = await listTurns(interviewId)
  const reason = notice(witness, closed) ?? (turns.length >= MAX_TURNS ? 'This interview has reached its question limit. Start over to begin a new one.' : null)
  return {
    id: interviewId,
    side: owner.side,
    witness: { id: witness.id, name: witness.name, role: witness.role },
    // The raw reply is for the model's transcript; clients get the objection and answer split out.
    turns: turns.map((t) => ({
      position: t.position,
      question: t.question,
      objection: t.objection,
      answer: t.answer,
      askedBy: t.askedBy,
      createdAt: t.createdAt,
    })),
    maxTurns: MAX_TURNS,
    canAsk: reason === null,
    notice: reason,
  }
}

export interface InterviewContext {
  courseCase: Pick<CourseCase, 'id' | 'title' | 'summary' | 'inWorldDate' | 'disputedIssues' | 'importantFacts'>
  witness: Witness
  owner: InterviewOwner
  userId: string
  /** The case is closed: the interview can be read but not continued. */
  closed: boolean
}

export async function getInterview(ctx: InterviewContext) {
  return view(ctx.witness, ctx.owner, await openInterview(ctx.witness.id, ctx.owner, ctx.userId), ctx.closed)
}

/** Ends the current interview and opens a fresh one. */
export async function restartInterview(ctx: InterviewContext) {
  const current = await findOpen(ctx.witness.id, ctx.owner)
  if (current) await pool.query('UPDATE interviews SET ended_at = now() WHERE id = $1', [current])
  return getInterview(ctx)
}

/** Asks the next question (`{ question }`) and stores the witness's reply. */
export async function askQuestion(ctx: InterviewContext, body: unknown) {
  const question = readString(body, 'question').trim()
  if (!question) throw new HttpError(400, 'Type a question first.')
  if (question.length > MAX_QUESTION_LENGTH) {
    throw new HttpError(400, `Questions must be at most ${MAX_QUESTION_LENGTH} characters.`)
  }
  const interviewId = await openInterview(ctx.witness.id, ctx.owner, ctx.userId)
  const before = await view(ctx.witness, ctx.owner, interviewId, ctx.closed)
  if (!before.canAsk) throw new HttpError(409, before.notice!)

  const transcript = await listTurns(interviewId)
  let reply
  try {
    const profile = await loadProfile(ctx.courseCase, ctx.witness)
    const settings = depositionSettings(profile, ctx.witness, ctx.owner.side)
    reply = await ai.askWitness({
      profile,
      settings,
      transcript: transcript.map((t) => ({ question: t.question, reply: t.reply })),
      question,
    })
  } catch (err) {
    if (err instanceof WitnessNotReadyError) throw new HttpError(409, err.message)
    if (err instanceof AiNotConfiguredError) throw new HttpError(503, 'The AI witness is not set up on this server yet.')
    if (err instanceof WitnessRefusalError) throw new HttpError(422, 'The witness could not answer that question. Try rephrasing it.')
    if (err instanceof Anthropic.APIError) {
      console.error('AI witness request failed:', err.message)
      throw new HttpError(502, 'The witness could not answer just now. Try again in a moment.')
    }
    throw err
  }

  try {
    await pool.query(
      `INSERT INTO interview_turns (interview_id, position, question, reply, objection, answer, asked_by, model)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        interviewId,
        transcript.length,
        question,
        reply.reply,
        reply.objection ? `${reply.objection.speaker}: ${reply.objection.text}` : null,
        reply.answer,
        ctx.userId,
        reply.model,
      ],
    )
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new HttpError(409, 'Your partner asked a question at the same time. Their question is shown now; ask yours again.')
    }
    throw err
  }
  return view(ctx.witness, ctx.owner, interviewId, ctx.closed)
}
