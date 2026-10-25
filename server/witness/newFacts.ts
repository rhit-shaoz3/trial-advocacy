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

/** A new fact, and the exchanges (by turn position, from 0) that stated it or built on it. */
export interface NewFact {
  text: string
  /** The exchanges whose answers stated it. */
  producedBy: number[]
  /** Later exchanges whose questions built on it; `answer` is whether the answer relies on it too. */
  builtOn: { turn: number; answer: boolean }[]
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

For each fact, also say which questions it came from and which later questions built on it, by their numbers in the transcript (Q1, Q2, ...):
- from_questions: the question or questions whose answers stated the detail.
- later_questions: questions asked after that which assumed the detail was true or followed it up (for example, after "I left the gate open", the question "Why did you leave the gate open?"). For each, set answer_relies_on_it to true if the witness's answer also depends on the detail, and false if the answer stands on its own (for example, "I didn't leave it open; I never touched it"). A question that is merely about the same topic doesn't count. Leave later_questions empty when none did.

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
  // Numbered from 1, so the facts can say which exchange they came from.
  const transcript = input.transcript.map((t, i) => `Q${i + 1}: ${t.question}\nA${i + 1}: ${t.answer}`).join('\n\n')
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
            facts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  text: { type: 'string', description: 'The new fact, in one short sentence.' },
                  from_questions: {
                    type: 'array',
                    items: { type: 'integer' },
                    description: 'Numbers of the questions whose answers stated it.',
                  },
                  later_questions: {
                    type: 'array',
                    description: 'Later questions that built on it.',
                    items: {
                      type: 'object',
                      properties: {
                        question: { type: 'integer' },
                        answer_relies_on_it: { type: 'boolean' },
                      },
                      required: ['question', 'answer_relies_on_it'],
                    },
                  },
                },
                required: ['text', 'from_questions', 'later_questions'],
              },
            },
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

/** The new facts the witness added in this transcript (possibly none), with the exchanges behind each. */
export async function findNewFacts(client: FactsClient, input: NewFactsInput): Promise<NewFact[]> {
  const response = await client.messages.create(buildFactsRequest(input))
  const call = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use' && block.name === TOOL_NAME,
  )
  if (!call) throw new Error('The review summary came back without a list of facts.')
  const facts = (call.input as { facts?: unknown }).facts
  if (!Array.isArray(facts)) throw new Error('The review summary came back without a list of facts.')
  return facts
    .map((f) => readFact(f, input.transcript.length))
    .filter((f): f is NewFact => f !== null)
    .slice(0, MAX_NEW_FACTS)
}

/**
 * One reported fact, with its question numbers turned into turn positions.
 * Numbers outside the transcript are dropped, and so is a later question that
 * is also where the fact came from. A bare string still counts, without links.
 */
function readFact(raw: unknown, turns: number): NewFact | null {
  const value = typeof raw === 'string' ? { text: raw } : (raw as Record<string, unknown> | null)
  const text = typeof value?.text === 'string' ? value.text.trim() : ''
  if (!text) return null
  const position = (n: unknown) => (Number.isInteger(n) && (n as number) >= 1 && (n as number) <= turns ? (n as number) - 1 : null)
  const producedBy = [...new Set((Array.isArray(value!.from_questions) ? value!.from_questions : []).map(position))].filter(
    (p): p is number => p !== null,
  )
  const builtOn: NewFact['builtOn'] = []
  for (const later of Array.isArray(value!.later_questions) ? value!.later_questions : []) {
    const turn = position((later as { question?: unknown })?.question)
    if (turn === null || producedBy.includes(turn) || builtOn.some((b) => b.turn === turn)) continue
    builtOn.push({ turn, answer: (later as { answer_relies_on_it?: unknown }).answer_relies_on_it === true })
  }
  return { text, producedBy, builtOn }
}
