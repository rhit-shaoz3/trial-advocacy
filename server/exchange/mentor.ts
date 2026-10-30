import type Anthropic from '@anthropic-ai/sdk'
import { modelFor } from '../ai/models.ts'
import type { ReportClient } from '../investigator/investigate.ts'
import { buildMentorMessage, buildMentorPrompt, parseMentorReply, type MentorContext, type MentorTag } from './mentorPrompt.ts'

// One pass of the discovery mentor over a team's draft: a tag (LOOKS_GOOD,
// SMALL_EDITS, or NEEDS_IMPROVEMENT) and Socratic feedback, in one turn.

/** Thinking counts toward this; the feedback itself is short. Long enough to need a streamed request. */
export const MENTOR_MAX_TOKENS = 16000

export function buildMentorRequest(context: MentorContext, model = modelFor('mentor')): Anthropic.Beta.Messages.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: MENTOR_MAX_TOKENS,
    thinking: { type: 'adaptive' },
    // What the team can see is the bulk of the prompt and the same each time
    // it checks again (the draft is the message), so it's cached for an hour.
    system: [{ type: 'text', text: buildMentorPrompt(context), cache_control: { type: 'ephemeral', ttl: '1h' } }],
    messages: [{ role: 'user', content: buildMentorMessage(context) }],
  }
}

/** The mentor's tag and feedback (without the tag line). */
export async function reviewDiscovery(client: ReportClient, context: MentorContext): Promise<{ tag: MentorTag; feedback: string }> {
  const response = await client.beta.messages.stream(buildMentorRequest(context)).finalMessage()
  if (response.stop_reason === 'refusal') throw new Error('The AI declined to review this draft.')
  if (response.stop_reason === 'max_tokens') throw new Error('The feedback was cut off.')
  const text = response.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
  if (!text) throw new Error('No feedback was written.')
  return parseMentorReply(text)
}
