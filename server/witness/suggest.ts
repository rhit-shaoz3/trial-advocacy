import type Anthropic from '@anthropic-ai/sdk'
import { modelFor } from '../ai/models.ts'

// When an instructor sets up a case, the AI reads the complaint (the case's
// initial file) and suggests who is likely to testify, so the instructor can
// start the witness list with a few ticks instead of typing each one.

export const MAX_SUGGESTIONS = 10

export interface SuggestInput {
  caseTitle: string
  plaintiffName: string
  defendantName: string
  /** The initial file's text: usually the complaint. */
  complaint: string
}

/** A likely witness; matches `WitnessSuggestion` in src/courses/types.ts. */
export interface WitnessSuggestion {
  name: string
  /** Their title or job, e.g. "Ride operator". */
  role: string
  /** Their part in the events, in a sentence. */
  description: string
  /** Which side they'd testify for, if it's clear. */
  alignedSide: 'plaintiff' | 'defense' | null
}

/** The only part of the client this needs, so tests can pass a fake. */
export interface SuggestClient {
  messages: {
    create(params: Anthropic.Messages.MessageCreateParamsNonStreaming): Promise<Anthropic.Messages.Message>
  }
}

const TOOL_NAME = 'suggest_witnesses'

const INSTRUCTIONS = `You help a law instructor set up a practice civil case. From the complaint below, list the people most likely to be deposed as witnesses.

- The named plaintiff and defendant usually testify. Include them when they are people. When a party is a company, include the employees or officers the complaint names or clearly describes instead.
- Add other people the complaint's account of what happened names or clearly describes: eyewitnesses, companions, employees involved, first responders, treating doctors.
- Only people the complaint actually mentions. Never invent anyone. When someone is described but not named, use the description as their name (for example, "The ride operator").
- For each: their name; their title or role in a few words; one sentence on their part in the events; and which side they'd most likely testify for (plaintiff or defense), or none if it isn't clear.

List at most ${MAX_SUGGESTIONS}, the most important first. Give your answer by calling the ${TOOL_NAME} tool exactly once, and write nothing else.`

export function buildSuggestRequest(input: SuggestInput, model = modelFor('review')): Anthropic.Messages.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: 2000,
    system: INSTRUCTIONS,
    tools: [
      {
        name: TOOL_NAME,
        description: 'Report the likely witnesses.',
        input_schema: {
          type: 'object',
          properties: {
            witnesses: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  role: { type: 'string' },
                  description: { type: 'string' },
                  side: { type: 'string', enum: ['plaintiff', 'defense', 'none'] },
                },
                required: ['name', 'role', 'description', 'side'],
              },
            },
          },
          required: ['witnesses'],
        },
      },
    ],
    // Some models don't accept a forced tool call, so the instructions ask for it.
    tool_choice: { type: 'auto' },
    messages: [
      {
        role: 'user',
        content: `Case: ${input.caseTitle}\nPlaintiff: ${input.plaintiffName}\nDefendant: ${input.defendantName}\n\n<complaint>\n${input.complaint.trim()}\n</complaint>`,
      },
    ],
  }
}

const clean = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

/** The likely witnesses the complaint names or describes (possibly none). */
export async function suggestWitnesses(client: SuggestClient, input: SuggestInput): Promise<WitnessSuggestion[]> {
  const response = await client.messages.create(buildSuggestRequest(input))
  const call = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use' && block.name === TOOL_NAME,
  )
  const witnesses = (call?.input as { witnesses?: unknown } | undefined)?.witnesses
  if (!Array.isArray(witnesses)) throw new Error('The witness suggestions came back without a list.')
  const seen = new Set<string>()
  return witnesses
    .map((w): WitnessSuggestion | null => {
      const raw = w as Record<string, unknown>
      const name = clean(raw.name, 120)
      if (!name || seen.has(name.toLowerCase())) return null
      seen.add(name.toLowerCase())
      const side = raw.side === 'plaintiff' || raw.side === 'defense' ? raw.side : null
      return { name, role: clean(raw.role, 120), description: clean(raw.description, 500), alignedSide: side }
    })
    .filter((w): w is WitnessSuggestion => w !== null)
    .slice(0, MAX_SUGGESTIONS)
}
