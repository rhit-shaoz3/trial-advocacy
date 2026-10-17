import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { buildFactsRequest, findNewFacts, MAX_NEW_FACTS, NEW_FACTS_MODEL, type NewFactsInput } from './newFacts.ts'

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
  it('sends the record, the rulings, and the transcript, and forces the facts tool', () => {
    const request = buildFactsRequest(input)
    expect(request.model).toBe(NEW_FACTS_MODEL)
    expect(request.tool_choice).toEqual({ type: 'tool', name: 'report_new_facts' })
    const text = request.messages[0].content as string
    expect(text).toContain('<document title="Incident statement">\nI walked aisle 5 around 9.\n</document>')
    expect(text).toContain('<settled_facts>\n- Dana mopped at 8:45.\n</settled_facts>')
    expect(text).toContain('<facts_ruled_untrue>\n- A sign was posted.\n</facts_ruled_untrue>')
    expect(text).toContain('Q: When did you mop?\nA: Around 8:45, and I used the yellow bucket.')
    expect(buildFactsRequest({ ...input, settled: { accepted: [], denied: [] } }).messages[0].content).toContain(
      '<settled_facts>\n(none)\n</settled_facts>',
    )
  })
})

describe('findNewFacts', () => {
  it('returns the reported facts, trimmed and capped', async () => {
    const client = fakeClient([toolUse(['  Dana used the yellow bucket. ', '', 7, ...Array(30).fill('More.')])])
    const facts = await findNewFacts(client, input)
    expect(facts[0]).toBe('Dana used the yellow bucket.')
    expect(facts).toHaveLength(MAX_NEW_FACTS)
    expect(client.requests).toHaveLength(1)
  })

  it('fails when no list comes back', async () => {
    await expect(findNewFacts(fakeClient([{ type: 'text', text: 'Hi', citations: null } as Anthropic.Messages.ContentBlock]), input)).rejects.toThrow(
      'without a list of facts',
    )
    await expect(findNewFacts(fakeClient([toolUse('nope')]), input)).rejects.toThrow('without a list of facts')
  })
})
