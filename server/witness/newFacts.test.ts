import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { modelFor } from '../ai/models.ts'
import { buildFactsRequest, findNewFacts, MAX_NEW_FACTS, type NewFactsInput } from './newFacts.ts'

const input: NewFactsInput = {
  caseName: 'Ortiz v. FreshMart',
  witnessName: 'Dana Lee',
  documents: [{ title: 'Incident statement', content: 'I walked aisle 5 around 9.\n' }],
  settled: { accepted: ['Dana mopped at 8:45.'], denied: ['A sign was posted.'] },
  transcript: [{ question: 'When did you mop?', answer: 'Around 8:45, and I used the yellow bucket.' }],
}

/** A fake client that answers with `content` and records the request. */
function fakeClient(content: Anthropic.Messages.ContentBlock[]) {
  const requests: Anthropic.Messages.MessageCreateParamsNonStreaming[] = []
  return {
    requests,
    messages: {
      create: async (params: Anthropic.Messages.MessageCreateParamsNonStreaming) => {
        requests.push(params)
        return { content } as Anthropic.Messages.Message
      },
    },
  }
}

const toolUse = (facts: unknown) =>
  ({ type: 'tool_use', id: 't1', name: 'report_new_facts', input: { facts } }) as Anthropic.Messages.ContentBlock

describe('buildFactsRequest', () => {
  it('sends the record, the rulings, and the transcript, and asks for the facts tool', () => {
    const request = buildFactsRequest(input)
    expect(request.model).toBe(modelFor('review'))
    // Some models reject a forced tool call ("tool" or "any"), so the tool is requested in the instructions.
    expect(request.tool_choice).toEqual({ type: 'auto' })
    expect(request.system).toContain('calling the report_new_facts tool exactly once')

    const [record, rest] = request.messages[0].content as Anthropic.Messages.TextBlockParam[]
    // The case file comes first and is cached, so reviews in the same case can share it.
    expect(record.cache_control).toEqual({ type: 'ephemeral' })
    expect(record.text).toContain('Case: Ortiz v. FreshMart')
    expect(record.text).toContain('<document title="Incident statement">\nI walked aisle 5 around 9.\n</document>')
    expect(record.text).not.toContain('Dana Lee')
    // What changes from review to review comes after it.
    expect(rest.cache_control).toBeUndefined()
    expect(rest.text).toContain('Witness: Dana Lee')
    expect(rest.text).toContain('<settled_facts>\n- Dana mopped at 8:45.\n</settled_facts>')
    expect(rest.text).toContain('<facts_ruled_untrue>\n- A sign was posted.\n</facts_ruled_untrue>')
    // Numbered, so each fact can say which exchange it came from.
    expect(rest.text).toContain('Q1: When did you mop?\nA1: Around 8:45, and I used the yellow bucket.')

    const none = buildFactsRequest({ ...input, settled: { accepted: [], denied: [] } }).messages[0]
      .content as Anthropic.Messages.TextBlockParam[]
    expect(none[1].text).toContain('<settled_facts>\n(none)\n</settled_facts>')
  })
})

describe('findNewFacts', () => {
  it('returns the reported facts, trimmed and capped', async () => {
    const client = fakeClient([toolUse(['  Dana used the yellow bucket. ', '', 7, ...Array(30).fill('More.')])])
    const facts = await findNewFacts(client, input)
    // A bare sentence still counts, without links.
    expect(facts[0]).toEqual({ text: 'Dana used the yellow bucket.', producedBy: [], builtOn: [] })
    expect(facts).toHaveLength(MAX_NEW_FACTS)
    expect(client.requests).toHaveLength(1)
  })

  it('turns question numbers into exchanges, dropping ones outside the transcript', async () => {
    const long = { ...input, transcript: [1, 2, 3, 4].map((n) => ({ question: `Q${n}?`, answer: `A${n}.` })) }
    const client = fakeClient([
      toolUse([
        {
          text: 'Dana left the gate open.',
          from_questions: [2, 2, 9],
          later_questions: [
            { question: 3, answer_relies_on_it: true },
            { question: 4, answer_relies_on_it: false },
            { question: 2, answer_relies_on_it: true },
            { question: 0, answer_relies_on_it: true },
          ],
        },
      ]),
    ])
    expect(await findNewFacts(client, long)).toEqual([
      { text: 'Dana left the gate open.', producedBy: [1], builtOn: [{ turn: 2, answer: true }, { turn: 3, answer: false }] },
    ])
  })

  it('asks for the questions behind each fact', () => {
    const tool = buildFactsRequest(input).tools![0] as Anthropic.Messages.Tool
    const items = (tool.input_schema.properties as Record<string, { items: { required: string[] } }>).facts.items
    expect(items.required).toEqual(['text', 'from_questions', 'later_questions'])
    expect(buildFactsRequest(input).system).toContain('answer_relies_on_it')
  })

  it('fails when no list comes back', async () => {
    await expect(findNewFacts(fakeClient([{ type: 'text', text: 'Hi', citations: null } as Anthropic.Messages.ContentBlock]), input)).rejects.toThrow(
      'without a list of facts',
    )
    await expect(findNewFacts(fakeClient([toolUse('nope')]), input)).rejects.toThrow('without a list of facts')
  })
})
