import type Anthropic from '@anthropic-ai/sdk'
import { modelFor } from '../ai/models.ts'
import { buildMentorMessage, buildMentorPrompt, parseMentorReply, type MentorContext, type MentorTag } from './mentorPrompt.ts'

// One pass of the discovery mentor over a team's draft: a tag (LOOKS_GOOD,
// SMALL_EDITS, or NEEDS_IMPROVEMENT) and Socratic feedback, in one turn.

/** Thinking counts toward this; the feedback itself is short. Long enough to need a streamed request. */
export const MENTOR_MAX_TOKENS = 16000

type Message = Anthropic.Beta.Messages.BetaMessage
type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming

/** What the mentor needs of the Anthropic client (a fake in tests). */
export interface MentorClient {
  beta: {
    messages: {
      stream(params: Params): { on(event: 'text', listener: (text: string) => void): unknown; finalMessage(): Promise<Message> }
      create(params: Params): PromiseLike<Message>
    }
  }
}

/** How long a check took, and how much of the prompt came from the cache. */
export interface MentorUsage {
  durationMs: number
  /** Until the first word of feedback (after the mentor's thinking); null if none came. */
  firstTextMs: number | null
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
}

export interface MentorReview {
  tag: MentorTag
  feedback: string
  usage?: MentorUsage
}

/** The feedback as it's written: the tag once its line is in, then the text after it. */
export interface MentorProgress {
  onTag?(tag: MentorTag): void
  onText?(text: string): void
}

/** The cached system block: the rules and everything the team can see. */
const systemBlock = (context: MentorContext): Params['system'] => [
  // What the team can see is the bulk of the prompt and the same each time
  // it checks again (the draft is the message), so it's cached for an hour.
  { type: 'text', text: buildMentorPrompt(context), cache_control: { type: 'ephemeral', ttl: '1h' } },
]

export function buildMentorRequest(context: MentorContext, model = modelFor('mentor')): Params {
  return {
    model,
    max_tokens: MENTOR_MAX_TOKENS,
    thinking: { type: 'adaptive' },
    system: systemBlock(context),
    messages: [{ role: 'user', content: buildMentorMessage(context) }],
  }
}

/**
 * A request that only loads the system prompt into the cache, for a team
 * that's opened a form and may check soon: the same model and system block
 * as a check, so the check reads it from the cache. Thinking settings don't
 * affect a cached system prompt.
 */
export function buildMentorWarmRequest(context: MentorContext, model = modelFor('mentor')): Params {
  return { model, max_tokens: 1, system: systemBlock(context), messages: [{ role: 'user', content: 'Ready?' }] }
}

/**
 * Splits streamed text into the reply's tag line and the feedback after it,
 * the way parseMentorReply reads the whole reply: a first line that isn't a
 * tag means the whole reply is feedback that needs work.
 */
export function tagSplitter(progress: MentorProgress) {
  let head = ''
  let decided = false
  return {
    push(chunk: string) {
      if (decided) {
        if (chunk) progress.onText?.(chunk)
        return
      }
      head = (head + chunk).replace(/^\s+/, '')
      const newline = head.indexOf('\n')
      if (newline === -1) return
      decided = true
      const first = head.slice(0, newline)
      const { tag, feedback } = parseMentorReply(`${first}\nx`)
      if (feedback === 'x') {
        progress.onTag?.(tag)
        const rest = head.slice(newline + 1).replace(/^\s+/, '')
        if (rest) progress.onText?.(rest)
      } else {
        progress.onTag?.('NEEDS_IMPROVEMENT')
        progress.onText?.(head)
      }
    },
    /** The reply ended: a lone line is the tag, or else feedback. */
    end() {
      if (decided || !head) return
      decided = true
      const { tag, feedback } = parseMentorReply(head)
      progress.onTag?.(tag)
      if (feedback) progress.onText?.(feedback)
    },
  }
}

/** The mentor's tag and feedback (without the tag line), with how long it took. */
export async function reviewDiscovery(client: MentorClient, context: MentorContext, progress?: MentorProgress): Promise<MentorReview> {
  const started = performance.now()
  let firstTextMs: number | null = null
  const split = progress ? tagSplitter(progress) : null
  const stream = client.beta.messages.stream(buildMentorRequest(context))
  stream.on('text', (text) => {
    firstTextMs ??= Math.round(performance.now() - started)
    split?.push(text)
  })
  const response = await stream.finalMessage()
  split?.end()
  if (response.stop_reason === 'refusal') throw new Error('The AI declined to review this draft.')
  if (response.stop_reason === 'max_tokens') throw new Error('The feedback was cut off.')
  const text = response.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
  if (!text) throw new Error('No feedback was written.')
  const u = response.usage
  return {
    ...parseMentorReply(text),
    usage: {
      durationMs: Math.round(performance.now() - started),
      firstTextMs,
      inputTokens: u.input_tokens,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      outputTokens: u.output_tokens,
    },
  }
}

/** Loads the team's system prompt into the cache; returns how much was written or already there. */
export async function warmMentorCache(client: MentorClient, context: MentorContext) {
  const { usage } = await client.beta.messages.create(buildMentorWarmRequest(context))
  return { cacheReadTokens: usage.cache_read_input_tokens ?? 0, cacheWriteTokens: usage.cache_creation_input_tokens ?? 0 }
}
