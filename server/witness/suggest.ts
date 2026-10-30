import type Anthropic from '@anthropic-ai/sdk'
import { modelFor } from '../ai/models.ts'

// When an instructor sets up a case, the AI reads the complaint (the case's
// initial file) once and suggests everything setup can start from: who is
// likely to testify, so the witness list starts with a few ticks instead of
// typing each one, and text for the case's own fields (the issues the
// witnesses must leave disputed, notes for the investigator, a note to
// students, and a few tasks), which the instructor sees written into each
// field to keep, edit, or clear. One call, saved, for all of it.

export const MAX_SUGGESTIONS = 10
export const MAX_TASKS = 3

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

/** Text for the case's own fields; matches `CaseSuggestions` in src/courses/types.ts. */
export interface CaseSuggestions {
  disputedIssues: string
  investigatorNotes: string
  instructorNote: string
  tasks: { title: string; description: string }[]
}

export interface ComplaintSuggestions {
  witnesses: WitnessSuggestion[]
  content: CaseSuggestions
}

/** The only part of the client this needs, so tests can pass a fake. */
export interface SuggestClient {
  messages: {
    create(params: Anthropic.Messages.MessageCreateParamsNonStreaming): Promise<Anthropic.Messages.Message>
  }
}

const TOOL_NAME = 'suggest_case_setup'

const INSTRUCTIONS = `You help a law instructor set up a practice civil case for a trial advocacy course, from its complaint below. Suggest what setup can start from: the likely witnesses, and text for a few of the case's fields. The instructor picks from the witnesses, and sees each field's text written into its field, to keep, edit, or clear.

witnesses: the people most likely to be deposed.
- The named plaintiff and defendant usually testify. Include them when they are people. When a party is a company, include the employees or officers the complaint names or clearly describes instead.
- Add other people the complaint's account of what happened names or clearly describes: eyewitnesses, companions, employees involved, first responders, treating doctors.
- Only people the complaint actually mentions. Never invent anyone. When someone is described but not named, use the description as their name (for example, "The ride operator").
- For each: their name; their title or job in two to five words, like "Ride operator" or "Park EMT" (not their part in the case); one sentence on their part in the events; and which side they'd most likely testify for (plaintiff or defense), or none if it isn't clear.
- At most ${MAX_SUGGESTIONS}, the most important first.

disputedIssues: the two to four facts the complaint leaves genuinely contested, which the AI witnesses must not settle one way or the other. One short phrase each, separated by semicolons. For example: "Whether the clerk saw the spill before the fall; how long the floor had been wet".

investigatorNotes: one or two sentences for the background investigator who answers the student teams' requests: what matters most in this case, and where a good investigator would look (people, places, or records the complaint mentions).

instructorNote: one or two sentences to the students on what to focus on in this case.

tasks: up to ${MAX_TASKS} concrete assignments for the student teams, in the order they'd come up while preparing the case (interviewing witnesses, the information exchange, depositions). Each has a short title, like "Outline the store manager's deposition", and one or two sentences saying what to do and what to turn in.

Use only the people, places, and events in the complaint; never invent people or facts. Write plainly and briefly, without legal citations. Give your answer by calling the ${TOOL_NAME} tool exactly once, and write nothing else.`

export function buildSuggestRequest(input: SuggestInput, model = modelFor('setup')): Anthropic.Messages.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: 4000,
    system: INSTRUCTIONS,
    tools: [
      {
        name: TOOL_NAME,
        description: 'Report the likely witnesses and the suggested text for the case.',
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
            disputedIssues: { type: 'string' },
            investigatorNotes: { type: 'string' },
            instructorNote: { type: 'string' },
            tasks: {
              type: 'array',
              items: {
                type: 'object',
                properties: { title: { type: 'string' }, description: { type: 'string' } },
                required: ['title', 'description'],
              },
            },
          },
          required: ['witnesses', 'disputedIssues', 'investigatorNotes', 'instructorNote', 'tasks'],
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

/** The likely witnesses the complaint names or describes (possibly none), and text for the case's fields, each within what its field holds. */
export async function suggestFromComplaint(client: SuggestClient, input: SuggestInput): Promise<ComplaintSuggestions> {
  const response = await client.messages.create(buildSuggestRequest(input))
  const call = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use' && block.name === TOOL_NAME,
  )
  const raw = (call?.input ?? {}) as Record<string, unknown>
  if (!Array.isArray(raw.witnesses)) throw new Error('The case suggestions came back without a list of witnesses.')
  const seen = new Set<string>()
  const witnesses = raw.witnesses
    .map((w): WitnessSuggestion | null => {
      const r = w as Record<string, unknown>
      const name = clean(r.name, 120)
      if (!name || seen.has(name.toLowerCase())) return null
      seen.add(name.toLowerCase())
      const side = r.side === 'plaintiff' || r.side === 'defense' ? r.side : null
      return { name, role: clean(r.role, 120), description: clean(r.description, 500), alignedSide: side }
    })
    .filter((w): w is WitnessSuggestion => w !== null)
    .slice(0, MAX_SUGGESTIONS)
  const tasks = Array.isArray(raw.tasks) ? raw.tasks : []
  return {
    witnesses,
    content: {
      disputedIssues: clean(raw.disputedIssues, 2000),
      investigatorNotes: clean(raw.investigatorNotes, 2000),
      instructorNote: clean(raw.instructorNote, 2000),
      tasks: tasks
        .map((t) => ({ title: clean((t as Record<string, unknown>).title, 120), description: clean((t as Record<string, unknown>).description, 4000) }))
        .filter((t) => t.title)
        .slice(0, MAX_TASKS),
    },
  }
}
