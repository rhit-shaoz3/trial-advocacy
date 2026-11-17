import type Anthropic from '@anthropic-ai/sdk'
import { modelFor } from '../ai/models.ts'
import type { ReportClient } from '../investigator/investigate.ts'
import { hasServerFallback } from '../witness/deposition.ts'
import { buildClientMessage, buildClientPrompt, type ClientContext, type ClientEmail } from './prompt.ts'

// The clients' reply to one email from their team, written in a single turn:
// tag lines, the email, any records they hand over, and a review block.

export const CLIENT_EFFORT = 'high'
/** Room for thinking and a reply with a few documents written out; a limit this size needs a streamed request. */
export const CLIENT_MAX_TOKENS = 32000

export interface ClientReplyInput {
  context: ClientContext
  email: ClientEmail
}

export function buildClientRequest(
  { context, email }: ClientReplyInput,
  model = modelFor('client'),
): Anthropic.Beta.Messages.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: CLIENT_MAX_TOKENS,
    // Adaptive thinking: the model decides how much to reason; effort caps it.
    thinking: { type: 'adaptive' },
    output_config: { effort: CLIENT_EFFORT },
    // As for the witness: a safety decline retries on the fallback model where there is one.
    ...(hasServerFallback(model) && { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
    // The case file is the bulk of the prompt and the same for the team's next email, so it's cached for an hour.
    system: [{ type: 'text', text: buildClientPrompt(context), cache_control: { type: 'ephemeral', ttl: '1h' } }],
    messages: [{ role: 'user', content: buildClientMessage(email) }],
  }
}

/** The clients' reply, tag lines and all, exactly as written. */
export async function replyAsClient(client: ReportClient, input: ClientReplyInput): Promise<string> {
  const response = await client.beta.messages.stream(buildClientRequest(input)).finalMessage()
  if (response.stop_reason === 'refusal') throw new Error('The client declined to reply. Try again.')
  if (response.stop_reason === 'max_tokens') throw new Error('The reply was cut off.')
  const text = response.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
  if (!text) throw new Error('No reply was written.')
  return text
}
