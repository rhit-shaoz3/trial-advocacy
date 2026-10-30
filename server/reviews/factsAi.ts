import type Anthropic from '@anthropic-ai/sdk'
import { modelFor } from '../ai/models.ts'
import type { FactsClient } from '../witness/newFacts.ts'

// The AI step for the instructor's review: which pending new facts are alike
// enough to rule on together.

function toolInput(response: Anthropic.Messages.Message, name: string) {
  const call = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use' && block.name === name,
  )
  return (call?.input ?? null) as Record<string, unknown> | null
}

// Grouping ---------------------------------------------------------------------

/** A new fact waiting for a ruling, and where it came from. */
export interface PendingFact {
  id: string
  text: string
  /** The witness's name, or "the investigator". */
  source: string
  teamNumber: number
  worldNumber: number
  /** The review it's in; facts from one review are never grouped together. */
  reviewId: string
}

export interface FactGroupProposal {
  headline: string
  differences: string
  factIds: string[]
}

const GROUP_TOOL = 'report_fact_groups'

const GROUP_INSTRUCTIONS = `You help a law instructor review new facts that AI witnesses (and an AI investigator) added in students' practice interviews. Different teams often get the same thing out of a witness. Group facts that are about the same thing, so the instructor can rule on them together.

- Group facts that make the same or a highly similar claim about the same matter, even when details differ (for example, "medical expenses were $6,000" and "medical expenses were $8,000"). Don't group facts that are merely on the same topic but say different things.
- Each group needs facts from at least two different reviews (the review attribute). Never group facts from the same review.
- headline: one sentence saying who got what, for example "Teams 1 and 2, interviewing Paige Turner, both got numerical estimates of medical expenses."
- differences: one sentence on how the facts differ, naming the teams, for example "$6,000 (Team 1) vs. $8,000 (Team 2)." Leave it empty when they say the same thing.
- A fact belongs to at most one group. Leave out facts that have no match.

Give your answer by calling the ${GROUP_TOOL} tool exactly once (with an empty list if nothing groups), and write nothing else.`

export function buildGroupRequest(facts: PendingFact[], model = modelFor('review')): Anthropic.Messages.MessageCreateParamsNonStreaming {
  const list = facts
    .map(
      (f) =>
        `<fact id="${f.id}" review="${f.reviewId}" team="${f.teamNumber}" world="${f.worldNumber}" source="${f.source}">${f.text}</fact>`,
    )
    .join('\n')
  return {
    model,
    max_tokens: 4000,
    system: GROUP_INSTRUCTIONS,
    tools: [
      {
        name: GROUP_TOOL,
        description: 'Report the groups of similar facts.',
        input_schema: {
          type: 'object',
          properties: {
            groups: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  headline: { type: 'string' },
                  differences: { type: 'string' },
                  fact_ids: { type: 'array', items: { type: 'string' } },
                },
                required: ['headline', 'differences', 'fact_ids'],
              },
            },
          },
          required: ['groups'],
        },
      },
    ],
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: `<new_facts>\n${list}\n</new_facts>` }],
  }
}

/**
 * Groups of similar facts. Unknown ids are dropped, a fact goes in its first
 * group only, and a group needs facts from two reviews or more.
 */
export async function groupFacts(client: FactsClient, facts: PendingFact[]): Promise<FactGroupProposal[]> {
  const value = toolInput(await client.messages.create(buildGroupRequest(facts)), GROUP_TOOL)
  if (!Array.isArray(value?.groups)) throw new Error('The grouping came back without a list of groups.')
  return readGroups(value.groups, facts)
}

export function readGroups(raw: unknown[], facts: PendingFact[]): FactGroupProposal[] {
  const byId = new Map(facts.map((f) => [f.id, f]))
  const used = new Set<string>()
  const groups: FactGroupProposal[] = []
  for (const g of raw) {
    const value = g as Record<string, unknown> | null
    const headline = typeof value?.headline === 'string' ? value.headline.trim() : ''
    const ids = (Array.isArray(value?.fact_ids) ? value.fact_ids : []).filter(
      (id): id is string => typeof id === 'string' && byId.has(id) && !used.has(id),
    )
    const unique = [...new Set(ids)]
    if (!headline || new Set(unique.map((id) => byId.get(id)!.reviewId)).size < 2) continue
    for (const id of unique) used.add(id)
    groups.push({ headline, differences: typeof value?.differences === 'string' ? value.differences.trim() : '', factIds: unique })
  }
  return groups
}
