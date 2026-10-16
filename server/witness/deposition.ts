import Anthropic from '@anthropic-ai/sdk'
import { buildSystemPrompt, type DepositionSettings, type WitnessProfile } from './prompt.ts'

export const WITNESS_MODEL = 'claude-opus-5-5'

/**
 * Thinking depth per answer. Answers are short, but the witness has a lot of
 * rules to weigh (what it knows, what it may add, which side it's on), so
 * this stays at the model's default rather than dropping to "low". Tune it
 * against the eval (npm run witness:eval).
 */
export const WITNESS_EFFORT = 'medium'

/** One question and the witness's reply, exactly as the model gave it (objection included). */
export interface TranscriptTurn {
  question: string
  reply: string
}

export interface WitnessReply {
  /** The full reply, as stored in the transcript. */
  reply: string
  /** The defending lawyer's objection, when there is one. */
  objection: { speaker: string; text: string } | null
  /** What the witness said. */
  answer: string
  /** The model that answered (differs from WITNESS_MODEL if a fallback served it). */
  model: string
  usage: Anthropic.Beta.Messages.BetaUsage
}

export class WitnessRefusalError extends Error {
  readonly category: string | null

  constructor(category: string | null) {
    super(`The witness model declined to answer${category ? ` (${category})` : ''}.`)
    this.category = category
  }
}

/** The only part of the client the witness needs, so tests can pass a fake. */
export interface MessagesClient {
  beta: {
    messages: {
      create(params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming): Promise<Anthropic.Beta.Messages.BetaMessage>
    }
  }
}

/**
 * The conversation so far as API messages: each question is a user turn, each
 * reply an assistant turn, and the new question last.
 */
export function buildMessages(transcript: TranscriptTurn[], question: string): Anthropic.Beta.Messages.BetaMessageParam[] {
  return [
    ...transcript.flatMap((turn): Anthropic.Beta.Messages.BetaMessageParam[] => [
      { role: 'user', content: turn.question },
      { role: 'assistant', content: turn.reply },
    ]),
    { role: 'user', content: question },
  ]
}

export function buildRequest(options: {
  profile: WitnessProfile
  settings: DepositionSettings
  transcript: TranscriptTurn[]
  question: string
  model?: string
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
}): Anthropic.Beta.Messages.MessageCreateParamsNonStreaming {
  return {
    model: options.model ?? WITNESS_MODEL,
    max_tokens: 16000,
    // Thinking is always on for this model; effort sets how much.
    thinking: { type: 'adaptive' },
    output_config: { effort: options.effort ?? WITNESS_EFFORT },
    // If a safety classifier declines (unlikely for a deposition), retry on
    // Anthropic's recommended fallback model instead of failing the turn.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    // The system prompt (case documents included) is large and identical for
    // the whole deposition, so cache it; the top-level breakpoint also caches
    // the growing transcript turn by turn.
    system: [{ type: 'text', text: buildSystemPrompt(options.profile, options.settings), cache_control: { type: 'ephemeral' } }],
    cache_control: { type: 'ephemeral' },
    messages: buildMessages(options.transcript, options.question),
  }
}

/** Asks the witness the next question and returns their reply. */
export async function askWitness(
  client: MessagesClient,
  options: Parameters<typeof buildRequest>[0],
): Promise<WitnessReply> {
  const response = await client.beta.messages.create(buildRequest(options))
  if (response.stop_reason === 'refusal') throw new WitnessRefusalError(response.stop_details?.category ?? null)
  if (response.stop_reason === 'max_tokens') throw new Error('The witness reply was cut off (max_tokens).')

  const reply = response.content
    .filter((block): block is Anthropic.Beta.Messages.BetaTextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim()
  return { reply, ...splitObjection(reply, options.settings.defendingCounselName), model: response.model, usage: response.usage }
}

/**
 * When the defending lawyer speaks, the template puts "Name: objection" on the
 * first line, a blank line, then the witness's answer. Splits the two so a
 * transcript can show them separately.
 */
export function splitObjection(reply: string, counselName?: string) {
  const answerOnly = { objection: null, answer: stripAnswerLabel(reply) }
  if (!counselName) return answerOnly
  const prefix = `${counselName}:`
  if (!reply.startsWith(prefix)) return answerOnly

  const [firstLine, ...rest] = reply.split('\n')
  return {
    objection: { speaker: counselName, text: firstLine.slice(prefix.length).trim() },
    answer: stripAnswerLabel(rest.join('\n')),
  }
}

/** Some replies start with a transcript-style "A:" label; the transcript adds its own. */
const stripAnswerLabel = (text: string) => text.trim().replace(/^A:\s*/, '')
