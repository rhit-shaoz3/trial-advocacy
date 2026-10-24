import type Anthropic from '@anthropic-ai/sdk'
import { modelFor } from '../ai/models.ts'

// The report the team gets after the instructor's review: the investigator's
// report without the review block and source tags, and without anything the
// instructor turned down (a denied fact, or a file the team may not have).
// With nothing turned down, the tags come off in code; otherwise one AI call
// edits the report.

/** The source tags the investigator puts on each finding (for the instructor's review). */
// The title is optional: he sometimes leaves it off.
const SOURCE_TAG = /\s*\[(?:CASE FILE|NEW ACCESS)(?:\s*:[^\]]*)?\]|\s*\[(?:NEW|EXISTING) FACT\]/gi

/** The report with its source tags removed. */
export const stripTags = (body: string) =>
  body
    .replace(SOURCE_TAG, '')
    .replace(/[ \t]+$/gm, '')
    .trim()

export interface FinalizeInput {
  investigatorName: string
  /** The report without its review block. */
  body: string
  deniedFacts: string[]
  /** Files the team may not see: nothing from them may stay in the report. */
  deniedTitles: string[]
}

/** The only part of the client this needs, so tests can pass a fake. */
export interface EditClient {
  messages: {
    create(params: Anthropic.Messages.MessageCreateParamsNonStreaming): Promise<Anthropic.Messages.Message>
  }
}

const INSTRUCTIONS = `You edit a background investigator's report before the legal team that hired him reads it. The team's instructor has reviewed the report and turned some things down. Remove them, and change nothing else.

Remove:
- every statement of a fact the instructor denied (listed below), and anything that depends on it
- everything taken from a document the team may not have (listed below): its contents, its title, and any mention that it exists

Then:
- Keep every other sentence word for word, in the same voice (first person, from the investigator).
- Renumber the findings so they run 1, 2, 3 without gaps. If a finding loses all its content, drop it.
- Remove the source tags in square brackets, such as [NEW FACT], [EXISTING FACT], [CASE FILE: ...] and [NEW ACCESS: ...].
- If nothing is left, write one sentence saying the investigator found nothing more he can report on this assignment.

Write only the edited report, in plain text, with no notes about your changes.`

export function buildFinalizeRequest(
  input: FinalizeInput,
  model = modelFor('review'),
): Anthropic.Messages.MessageCreateParamsNonStreaming {
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join('\n') : '(none)')
  return {
    model,
    max_tokens: 8000,
    system: INSTRUCTIONS,
    messages: [
      {
        role: 'user',
        content: `Investigator: ${input.investigatorName}

<denied_facts>
${list(input.deniedFacts)}
</denied_facts>

<documents_the_team_may_not_have>
${list(input.deniedTitles)}
</documents_the_team_may_not_have>

<report>
${input.body}
</report>`,
      },
    ],
  }
}

/** The clean report the team gets. */
export async function finalizeReport(client: EditClient, input: FinalizeInput): Promise<string> {
  if (input.deniedFacts.length === 0 && input.deniedTitles.length === 0) return stripTags(input.body)
  const response = await client.messages.create(buildFinalizeRequest(input))
  if (response.stop_reason === 'max_tokens') throw new Error('The edited report was cut off.')
  const text = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
  // In case the model kept a tag or two.
  const clean = stripTags(text)
  if (!clean) throw new Error('The edited report came back empty.')
  return clean
}
