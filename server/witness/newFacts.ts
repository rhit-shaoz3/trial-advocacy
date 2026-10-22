import type Anthropic from '@anthropic-ai/sdk'
import { modelFor } from '../ai/models.ts'

// After a team ends an interview, the AI reads the transcript against the
// record (the case files and facts already settled by the instructor) and
// lists the new facts the witness added, for the instructor to rule on.

export const MAX_NEW_FACTS = 25

export interface NewFactsInput {
  caseName: string
  witnessName: string
  /** Every case file the witness's answers are checked against. */
  documents: { title: string; content: string }[]
  /** Facts already settled for this world or the whole case (accepted), and ones ruled untrue (denied). */
  settled: { accepted: string[]; denied: string[] }
  transcript: { question: string; answer: string }[]
}

/** The only part of the client this needs, so tests can pass a fake. */
export interface FactsClient {
  messages: {
    create(params: Anthropic.Messages.MessageCreateParamsNonStreaming): Promise<Anthropic.Messages.Message>
  }
}

const TOOL_NAME = 'report_new_facts'

const INSTRUCTIONS = `You review a practice deposition from a legal training app. An AI played a witness and, like a real witness, sometimes added details that aren't in the case record. An instructor will rule on each added detail, so list them.

List every concrete factual detail the witness stated that is NOT already in the record below (the case documents and the settled facts). Include details that contradict the record, and details that repeat a fact already ruled untrue.

Write each one as a single short sentence that makes sense on its own, naming the witness (for example: "Torres says she was on her break from 2:40 to 3:00."). One detail per sentence.

Leave out:
- anything the record already says, even in other words
- opinions, feelings, impressions, and guesses the witness marks as uncertain
- "I don't know", "I don't remember", and refusals
- objections and anything said by a lawyer
- trivial small talk (agreeing they're under oath, spelling their name)

If the witness added nothing new, report an empty list. Report at most ${MAX_NEW_FACTS} facts, the most significant first.

Give your answer by calling the ${TOOL_NAME} tool exactly once, and write nothing else.`

export function buildFactsRequest(
  input: NewFactsInput,
  model = modelFor('review'),
): Anthropic.Messages.MessageCreateParamsNonStreaming {
  const documents = input.documents
    .map((d) => `<document title="${d.title}">\n${d.content.trim()}\n</document>`)
    .join('\n')
  const list = (facts: string[]) => (facts.length ? facts.map((f) => `- ${f}`).join('\n') : '(none)')
  const transcript = input.transcript.map((t) => `Q: ${t.question}\nA: ${t.answer}`).join('\n\n')
  return {
    model,
    max_tokens: 4000,
    system: INSTRUCTIONS,
    tools: [
      {
        name: TOOL_NAME,
        description: 'Report the new facts the witness added.',
        input_schema: {
          type: 'object',
          properties: {
            facts: { type: 'array', items: { type: 'string' }, description: 'One short sentence per new fact.' },
          },
          required: ['facts'],
        },
      },
    ],
    // Some models (Claude Opus 5.5, for one) don't accept a forced tool call
    // ("tool" or "any"), so the instructions ask for the tool and
    // findNewFacts fails if it isn't used.
    tool_choice: { type: 'auto' },
    messages: [
      {
        role: 'user',
        content: [
          // The case file is the same for every review in the case, so it's
          // cached (with the instructions and tool before it): reviews close
          // together, like several teams ending interviews at the end of
          // class, read it at a fraction of the price.
          {
            type: 'text',
            text: `Case: ${input.caseName}

<case_documents>
${documents}
</case_documents>`,
            cache_control: { type: 'ephemeral' },
          },
          {
            type: 'text',
            text: `Witness: ${input.witnessName}

<settled_facts>
${list(input.settled.accepted)}
</settled_facts>

<facts_ruled_untrue>
${list(input.settled.denied)}
</facts_ruled_untrue>

<deposition_transcript>
${transcript}
</deposition_transcript>`,
          },
        ],
      },
    ],
  }
}

/** The new facts the witness added in this transcript (possibly none). */
export async function findNewFacts(client: FactsClient, input: NewFactsInput): Promise<string[]> {
  const response = await client.messages.create(buildFactsRequest(input))
  const call = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use' && block.name === TOOL_NAME,
  )
  if (!call) throw new Error('The review summary came back without a list of facts.')
  const facts = (call.input as { facts?: unknown }).facts
  if (!Array.isArray(facts)) throw new Error('The review summary came back without a list of facts.')
  return facts
    .filter((f): f is string => typeof f === 'string')
    .map((f) => f.trim())
    .filter(Boolean)
    .slice(0, MAX_NEW_FACTS)
}
