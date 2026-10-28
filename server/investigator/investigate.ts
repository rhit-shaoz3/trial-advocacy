import type Anthropic from '@anthropic-ai/sdk'
import { modelFor } from '../ai/models.ts'
import { hasServerFallback } from '../witness/deposition.ts'
import { buildInvestigatorPrompt, buildTeamBlock, type InvestigatorContext } from './prompt.ts'

// One assignment to the background investigator: the team's earlier
// assignments and (reviewed) reports as the conversation so far, then the new
// assignment. His reply is a report ending in a <review> block of new facts,
// files he could get for the team, and records that need legal process.

export const INVESTIGATOR_EFFORT = 'high'
/** The longest assignment a team can send. */
export const MAX_ASSIGNMENT_LENGTH = 4000

/**
 * Thinking counts toward this, and at high effort it can take most of 16K
 * tokens on a large case file before the report starts, so there's room for
 * both; a limit this size needs a streamed request.
 */
export const INVESTIGATOR_MAX_TOKENS = 64000

/** The only part of the client this needs, so tests can pass a fake. */
export interface ReportClient {
  beta: {
    messages: {
      stream(params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming): {
        finalMessage(): Promise<Anthropic.Beta.Messages.BetaMessage>
      }
    }
  }
}

export interface InvestigationInput {
  context: InvestigatorContext
  /** The team's earlier assignments and the reports they got back, oldest first. */
  history: { assignment: string; report: string }[]
  assignment: string
}

export function buildInvestigationRequest(
  input: InvestigationInput,
  model = modelFor('investigator'),
): Anthropic.Beta.Messages.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: INVESTIGATOR_MAX_TOKENS,
    // Adaptive thinking: the model decides how much to reason; effort caps it.
    thinking: { type: 'adaptive' },
    output_config: { effort: INVESTIGATOR_EFFORT },
    // As for the witness: a safety decline retries on the fallback model where there is one.
    ...(hasServerFallback(model) && { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
    // The case file is the bulk of the prompt and the same for every team in
    // the case world (the team comes with its assignment), so it's cached for an hour.
    system: [{ type: 'text', text: buildInvestigatorPrompt(input.context), cache_control: { type: 'ephemeral', ttl: '1h' } }],
    messages: [
      ...input.history.flatMap((turn): Anthropic.Beta.Messages.BetaMessageParam[] => [
        { role: 'user', content: turn.assignment },
        { role: 'assistant', content: turn.report },
      ]),
      // A reminder right where he answers: without the review block, nothing gets ruled on.
      {
        role: 'user',
        content: `${buildTeamBlock(input.context)}\n\nAssignment from Team ${input.context.teamNumber}:\n\n${input.assignment}\n\nReport back, ending with your <review> block.`,
      },
    ],
  }
}

/** The investigator's report: the text, exactly as he wrote it. */
export async function investigate(client: ReportClient, input: InvestigationInput): Promise<string> {
  const response = await client.beta.messages.stream(buildInvestigationRequest(input)).finalMessage()
  if (response.stop_reason === 'refusal') throw new Error('The investigator declined this assignment. Try rewording it.')
  if (response.stop_reason === 'max_tokens') throw new Error('The investigator’s report was cut off.')
  const text = response.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
  if (!text) throw new Error('The investigator didn’t write a report.')
  return text
}

export interface ParsedReport {
  /** The report without its review block. */
  body: string
  /** Whether he ended with a review block at all (if not, the instructor is warned). */
  hasReviewBlock: boolean
  facts: string[]
  /** Titles of case files he says the team could get. */
  accessTitles: string[]
  records: string[]
}

const HEADINGS = { 'NEW FACTS': 'facts', 'NEW ACCESS': 'accessTitles', 'RECORDS REQUESTED': 'records' } as const

/** Splits the report from its <review> block and reads the block's three lists. */
export function parseReport(text: string): ParsedReport {
  const match = text.match(/<review>([\s\S]*?)(<\/review>|$)/i)
  const body = (match ? text.slice(0, match.index) : text).trim()
  const lists: Omit<ParsedReport, 'body' | 'hasReviewBlock'> = { facts: [], accessTitles: [], records: [] }
  let current: keyof typeof lists | null = null
  for (const raw of (match?.[1] ?? '').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    // "NEW FACTS", "NEW FACTS:", or in bold.
    const heading = line.replace(/[*_#]/g, '').trim().replace(/:$/, '').toUpperCase() as keyof typeof HEADINGS
    if (heading in HEADINGS) {
      current = HEADINGS[heading]
      continue
    }
    const item = line.replace(/^[-*•]\s*/, '').trim()
    if (!current || !item || /^none\.?$/i.test(item)) continue
    lists[current].push(item)
  }
  // Files he cites in the report itself count too, so none slips past the instructor.
  for (const tag of body.matchAll(/\[(?:CASE FILE|NEW ACCESS)\s*:\s*([^\]]+)\]/gi)) {
    const title = tag[1].trim()
    if (!lists.accessTitles.some((t) => t.toLowerCase() === title.toLowerCase())) lists.accessTitles.push(title)
  }
  return { body, hasReviewBlock: Boolean(match), ...lists }
}

/** Matches the titles he named to case files ("Title" is a file's label, else its filename). */
export function matchTitles<M extends { title: string }>(titles: string[], files: M[]) {
  const norm = (s: string) => s.trim().replace(/^["“']|["”']$/g, '').toLowerCase()
  const found: M[] = []
  for (const title of titles) {
    const file = files.find((f) => norm(f.title) === norm(title))
    if (file && !found.includes(file)) found.push(file)
  }
  return found
}
