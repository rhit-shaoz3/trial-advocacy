import type Anthropic from '@anthropic-ai/sdk'
import { modelFor } from '../ai/models.ts'
import type { ReportClient } from '../investigator/investigate.ts'
import { hasServerFallback } from '../witness/deposition.ts'
import { buildSubpoenaMessage, buildSubpoenaPrompt, type SubpoenaContext } from './subpoenaPrompt.ts'

// One subpoena's response, drafted by the recipient (its records custodian or
// counsel) in a single turn. The reply starts with any tag lines, then the
// response document; the instructor reviews it before the team sees it.

export const SUBPOENA_EFFORT = 'high'
/**
 * Thinking counts toward this, and at high effort it can take most of 16K
 * tokens before a long production starts, so there's room for both; a limit
 * this size needs a streamed request.
 */
export const SUBPOENA_MAX_TOKENS = 64000


export function buildSubpoenaRequest(
  context: SubpoenaContext,
  model = modelFor('subpoena'),
): Anthropic.Beta.Messages.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: SUBPOENA_MAX_TOKENS,
    // Adaptive thinking: the model decides how much to reason; effort caps it.
    thinking: { type: 'adaptive' },
    output_config: { effort: SUBPOENA_EFFORT },
    // As for the witness: a safety decline retries on the fallback model where there is one.
    ...(hasServerFallback(model) && { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
    // The case file is the bulk of the prompt and the same for every subpoena
    // in the case world (the subpoena is the message), so it's cached for an hour.
    system: [{ type: 'text', text: buildSubpoenaPrompt(context), cache_control: { type: 'ephemeral', ttl: '1h' } }],
    messages: [{ role: 'user', content: buildSubpoenaMessage(context) }],
  }
}

/** The recipient's response, tag lines and all, exactly as written. */
export async function respondToSubpoena(client: ReportClient, context: SubpoenaContext): Promise<string> {
  const response = await client.beta.messages.stream(buildSubpoenaRequest(context)).finalMessage()
  if (response.stop_reason === 'refusal') throw new Error('The recipient declined to draft a response. Try again with notes.')
  if (response.stop_reason === 'max_tokens') throw new Error('The response was cut off.')
  const text = response.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
  if (!text) throw new Error('No response was written.')
  return text
}
