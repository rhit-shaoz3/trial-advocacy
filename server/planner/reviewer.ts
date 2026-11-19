import type Anthropic from '@anthropic-ai/sdk'
import { modelFor } from '../ai/models.ts'
import type { ReportClient } from '../investigator/investigate.ts'
import { hasServerFallback } from '../witness/deposition.ts'
import { buildPlannerPrompt, PLANNER_MESSAGE, type PlannerReviewContext } from './prompt.ts'

// One round of feedback on a team's planner, written in a single turn: the
// tag line, then the overview, the notes on cards and gaps, and the big picture.

export const PLANNER_EFFORT = 'high'
/** Room for thinking over the whole case file; a limit this size needs a streamed request. */
export const PLANNER_MAX_TOKENS = 32000

export function buildPlannerRequest(
  context: PlannerReviewContext,
  model = modelFor('planner'),
): Anthropic.Beta.Messages.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: PLANNER_MAX_TOKENS,
    // Adaptive thinking: the model decides how much to reason; effort caps it.
    thinking: { type: 'adaptive' },
    output_config: { effort: PLANNER_EFFORT },
    ...(hasServerFallback(model) && { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
    // The case file is most of the prompt; a team asking again soon reads it from the cache.
    system: [{ type: 'text', text: buildPlannerPrompt(context), cache_control: { type: 'ephemeral', ttl: '1h' } }],
    messages: [{ role: 'user', content: PLANNER_MESSAGE }],
  }
}

/** The reviewer's reply, tag line and all, exactly as written. */
export async function reviewPlanner(client: ReportClient, context: PlannerReviewContext): Promise<string> {
  const response = await client.beta.messages.stream(buildPlannerRequest(context)).finalMessage()
  if (response.stop_reason === 'refusal') throw new Error('The reviewer declined to answer. Try again.')
  if (response.stop_reason === 'max_tokens') throw new Error('The feedback was cut off.')
  const text = response.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
  if (!text) throw new Error('No feedback was written.')
  return text
}
