import type Anthropic from '@anthropic-ai/sdk'
import { modelFor } from '../ai/models.ts'
import { buildMessages, hasServerFallback, WitnessRefusalError, type MessagesClient } from '../witness/deposition.ts'
import { buildSystemPrompt, type DepositionSettings, type PracticeSettings, type WitnessProfile } from '../witness/prompt.ts'

// One turn of a practice session: the student's question (or their edit of a
// held one, or their answer to an objection) and the reply, written as the
// practice supplement's tagged blocks: the coach's notes, a hold, opposing
// counsel's objection, the judge's ruling, the witness's lawyer, and the
// witness's answer.

/**
 * Lower than the witness's "high": Sonnet keeps to the template's rules at
 * medium, and each turn stays quick enough to feel like a conversation.
 */
export const PRACTICE_EFFORT = 'medium'

/** What kind of student turn it is; all but a plain question reach the model with the supplement's label. */
export type PracticeTurnKind = 'question' | 'edited' | 'as_written' | 'objection_response'

export const TURN_LABEL: Record<PracticeTurnKind, string | null> = {
  question: null,
  edited: '[Edited question]',
  as_written: '[Asked as written]',
  objection_response: '[Response to objection]',
}

/** The turn as the model reads it: its label, then what the student wrote. */
export const labelled = (kind: PracticeTurnKind, text: string) => (TURN_LABEL[kind] ? `${TURN_LABEL[kind]} ${text}` : text)

export const COACH_KINDS = ['good', 'off_target', 'leading', 'evidence', 'ethics', 'judge_jury', 'grammar', 'polish'] as const
/** `note` is a coach note of a kind the template doesn't name. */
export type CoachKind = (typeof COACH_KINDS)[number] | 'note'

/** The most coach notes one turn shows, as the template asks. */
export const MAX_NOTES = 2

/** A reply's blocks, as the page shows them. */
export interface PracticeBlocks {
  /** The coach's side notes, each anchored to words of the student's turn when it quotes them. */
  coach: { kind: CoachKind; quote: string | null; text: string }[]
  /** The question wasn't asked: the student can edit it or ask it as written. */
  hold: boolean
  objection: { by: string; text: string } | null
  /** Opposing counsel objected, and the student answers the objection before the witness does. */
  awaitResponse: boolean
  ruling: { result: 'sustained' | 'overruled'; text: string } | null
  /** The witness's own lawyer, in a deposition. */
  counsel: string | null
  witness: string | null
}

export interface PracticeReply {
  reply: string
  blocks: PracticeBlocks
  model: string
  usage: Anthropic.Beta.Messages.BetaUsage
}

const attributes = (raw: string) => Object.fromEntries([...raw.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]))

/** The text of the first `<tag ...>…</tag>`, with its attributes; null when there's none. */
function block(reply: string, tag: string) {
  const match = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`).exec(reply)
  return match ? { attrs: attributes(match[1]), text: match[2].trim() } : null
}

/** For matching a quote: one case, and straight quotes for curly ones (the same length, so places line up). */
export const loose = (text: string) => text.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"')

/** Some answers start with a transcript-style "A:" label; the page adds its own. */
const spoken = (text: string) => text.trim().replace(/^A:\s*/, '')

/**
 * Reads a reply's blocks. A quote counts as an anchor only when it's really
 * in what the student wrote; a reply with no tags at all is the witness
 * speaking. After a hold, or an objection the student hasn't answered, the
 * witness says nothing, whatever the reply has.
 */
export function parsePracticeReply(reply: string, studentText: string): PracticeBlocks {
  const said = loose(studentText)
  const coach = [...reply.matchAll(/<coach\b([^>]*)>([\s\S]*?)<\/coach>/g)]
    .map((m) => {
      const attrs = attributes(m[1])
      const kind = (COACH_KINDS as readonly string[]).includes(attrs.kind) ? (attrs.kind as CoachKind) : 'note'
      const quote = attrs.quote?.trim()
      return { kind, quote: quote && said.includes(loose(quote)) ? quote : null, text: m[2].trim() }
    })
    .filter((n) => n.text)
    .slice(0, MAX_NOTES)
  const hold = /<hold\s*\/?>/.test(reply)
  const awaitResponse = /<await_response\s*\/?>/.test(reply)
  const objection = block(reply, 'objection')
  const ruling = block(reply, 'ruling')
  const result = ruling?.attrs.result?.toLowerCase()
  const counsel = block(reply, 'counsel')
  const witness = block(reply, 'witness')
  const tagged = /<(coach|hold|objection|await_response|ruling|counsel|witness)\b/.test(reply)
  const silent = hold || (awaitResponse && !ruling) || result === 'sustained'
  return {
    coach,
    hold,
    objection: objection ? { by: objection.attrs.by?.trim() || 'Counsel', text: objection.text } : null,
    awaitResponse: awaitResponse && !ruling,
    ruling: ruling && (result === 'sustained' || result === 'overruled') ? { result, text: ruling.text } : null,
    counsel: counsel?.text || null,
    witness: silent ? null : witness ? spoken(witness.text) || null : tagged ? null : spoken(reply) || null,
  }
}

/** One earlier turn, as the model gave it. */
export interface PracticeTranscriptTurn {
  kind: PracticeTurnKind
  text: string
  reply: string
}

export function buildPracticeRequest(options: {
  profile: WitnessProfile
  settings: DepositionSettings
  practice: PracticeSettings
  transcript: PracticeTranscriptTurn[]
  kind: PracticeTurnKind
  text: string
  /** What the witness said in the team's real sessions, read-only. */
  memory?: string[]
  model?: string
}): Anthropic.Beta.Messages.MessageCreateParamsNonStreaming {
  const model = options.model ?? modelFor('practice')
  return {
    model,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: PRACTICE_EFFORT },
    ...(hasServerFallback(model) && { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
    // As with an interview: the case file is cached for the session's hour,
    // the growing transcript for the usual five minutes.
    system: [
      {
        type: 'text',
        text: buildSystemPrompt(options.profile, options.settings, options.practice),
        cache_control: { type: 'ephemeral', ttl: '1h' },
      },
    ],
    ...(!options.memory?.length && { cache_control: { type: 'ephemeral' as const } }),
    messages: buildMessages(
      options.transcript.map((t) => ({ question: labelled(t.kind, t.text), reply: t.reply })),
      labelled(options.kind, options.text),
      options.memory,
    ),
  }
}

/** The reply to the student's next turn, its blocks read. */
export async function practiceTurn(client: MessagesClient, options: Parameters<typeof buildPracticeRequest>[0]): Promise<PracticeReply> {
  const response = await client.beta.messages.create(buildPracticeRequest(options))
  if (response.stop_reason === 'refusal') throw new WitnessRefusalError(response.stop_details?.category ?? null)
  if (response.stop_reason === 'max_tokens') throw new Error('The practice reply was cut off (max_tokens).')
  const reply = response.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
  return { reply, blocks: parsePracticeReply(reply, options.text), model: response.model, usage: response.usage }
}
