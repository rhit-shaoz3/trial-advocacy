import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import { buildClaimsRequest, findClaims, MAX_CLAIMS_PER_TURN } from './claims.ts'
import type { FactsClient } from './newFacts.ts'

const input = { witnessName: 'Elena Torres', question: 'Were you at the booth?', answer: 'No, I was on break.' }

/** A client that reports these claims (or, with none, writes text instead of using the tool). */
function fakeClient(claims?: unknown): FactsClient {
  const content = claims === undefined ? [{ type: 'text', text: 'Nothing to report.' }] : [{ type: 'tool_use', name: 'report_claims', input: { claims } }]
  return { messages: { create: async () => ({ content }) as unknown as Anthropic.Messages.Message } }
}

describe('buildClaimsRequest', () => {
  it('sends the one exchange, marked off from the instructions', () => {
    const request = buildClaimsRequest(input, 'test-model')
    expect(request.model).toBe('test-model')
    expect(request.messages[0].content).toContain('<question>\nWere you at the booth?\n</question>')
    expect(request.messages[0].content).toContain('<answer>\nNo, I was on break.\n</answer>')
    expect(request.messages[0].content).toContain('Witness: Elena Torres')
  })
})

describe('findClaims', () => {
  it('reads the claims, with a plain statement for an unknown kind', async () => {
    const claims = await findClaims(
      fakeClient([
        { kind: 'denial', text: ' Torres says she was not at the booth. ' },
        { kind: 'no_recall', text: 'Torres does not recall the time.' },
        { kind: 'guess', text: 'Torres says she was on break.' },
      ]),
      input,
    )
    expect(claims).toEqual([
      { kind: 'denial', text: 'Torres says she was not at the booth.' },
      { kind: 'no_recall', text: 'Torres does not recall the time.' },
      { kind: 'statement', text: 'Torres says she was on break.' },
    ])
  })

  it('skips empty claims and keeps to the limit', async () => {
    const many = Array.from({ length: MAX_CLAIMS_PER_TURN + 3 }, (_, i) => ({ kind: 'statement', text: `Claim ${i}.` }))
    const claims = await findClaims(fakeClient([{ kind: 'statement', text: '  ' }, null, ...many]), input)
    expect(claims).toHaveLength(MAX_CLAIMS_PER_TURN)
    expect(claims[0].text).toBe('Claim 0.')
  })

  it('counts a reply without the tool as nothing, since retrying would not change it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await findClaims(fakeClient(), input)).toEqual([])
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
})
