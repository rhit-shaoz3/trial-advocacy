import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { buildMentorRequest, buildMentorWarmRequest, reviewDiscovery, tagSplitter, type MentorClient } from './mentor.ts'
import type { MentorContext, MentorTag } from './mentorPrompt.ts'

const context: MentorContext = {
  caseTitle: 'Ramirez v. Thrillville',
  parties: { plaintiff: 'Elena Ramirez', defendant: 'Thrillville Parks' },
  caseSummary: 'A rider was hurt.',
  inWorldDate: '2026-03-15',
  side: 'plaintiff',
  kind: 'interrogatories',
  mode: 'draft',
  draft: '1. Who inspected the harness?',
  interrogatoryLimit: 25,
  interrogatoriesServed: 0,
  documents: [{ title: 'Complaint', content: 'The harness failed.' }],
  acceptedFacts: [],
  priorDiscovery: [],
}

/** What a streamed reply sends: its tag and the feedback, in the pieces it came in. */
function split(chunks: string[]) {
  const seen: { tag?: MentorTag; text: string } = { text: '' }
  const s = tagSplitter({ onTag: (tag) => (seen.tag = tag), onText: (text) => (seen.text += text) })
  chunks.forEach((c) => s.push(c))
  s.end()
  return seen
}

describe('the tag line of a streamed reply', () => {
  it('holds back the tag line, even when it comes in pieces', () => {
    expect(split(['SMALL_', 'EDITS\n\nInterrogatory 1: ', 'Who, exactly?'])).toEqual({ tag: 'SMALL_EDITS', text: 'Interrogatory 1: Who, exactly?' })
    expect(split(['\n**LOOKS GOOD**\n', 'Nice.'])).toEqual({ tag: 'LOOKS_GOOD', text: 'Nice.' })
  })

  it('treats a reply without a tag as feedback that needs work, as the whole reply is read', () => {
    expect(split(['This needs ', 'dates.\nAnd names.'])).toEqual({ tag: 'NEEDS_IMPROVEMENT', text: 'This needs dates.\nAnd names.' })
    expect(split(['LOOKS_GOOD'])).toEqual({ tag: 'LOOKS_GOOD', text: '' })
  })
})

describe('the mentor request', () => {
  it('warms the cache with the same model and cached system prompt a check uses, and nothing else', () => {
    const check = buildMentorRequest(context, 'claude-sonnet-5-5')
    const warm = buildMentorWarmRequest(context, 'claude-sonnet-5-5')
    expect(warm.system).toEqual(check.system)
    expect(warm.model).toBe(check.model)
    expect(warm.max_tokens).toBe(1)
    expect(warm.thinking).toBeUndefined()
  })

  it('streams the feedback and says how long it took and what came from the cache', async () => {
    const reply = 'SMALL_EDITS\nInterrogatory 1: Who, exactly?'
    const client: MentorClient = {
      beta: {
        messages: {
          stream() {
            let onText: (text: string) => void = () => {}
            return {
              on(_event: 'text', listener: (text: string) => void) {
                onText = listener
              },
              async finalMessage() {
                for (const piece of ['SMALL_EDITS\n', 'Interrogatory 1: ', 'Who, exactly?']) onText(piece)
                return {
                  content: [{ type: 'text', text: reply }],
                  stop_reason: 'end_turn',
                  usage: { input_tokens: 380, cache_read_input_tokens: 41200, cache_creation_input_tokens: 0, output_tokens: 410 },
                } as unknown as Anthropic.Beta.Messages.BetaMessage
              },
            }
          },
          create: () => Promise.reject(new Error('not used')),
        },
      },
    }
    const pieces: string[] = []
    const result = await reviewDiscovery(client, context, { onText: (t) => pieces.push(t) })
    expect(pieces).toEqual(['Interrogatory 1: ', 'Who, exactly?'])
    expect(result).toMatchObject({
      tag: 'SMALL_EDITS',
      feedback: 'Interrogatory 1: Who, exactly?',
      usage: { inputTokens: 380, cacheReadTokens: 41200, cacheWriteTokens: 0, outputTokens: 410 },
    })
    expect(result.usage?.firstTextMs).toEqual(expect.any(Number))
  })
})
