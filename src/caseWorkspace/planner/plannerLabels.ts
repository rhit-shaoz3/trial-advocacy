import type { PlannerCard, PlannerChart, PlannerGap, PlannerTool } from '../../courses/types'

export const TOOL_LABEL: Record<PlannerTool, string> = {
  interview: 'Interview a witness',
  client: 'Ask your client',
  investigator: 'Investigator',
  interrogatories: 'Interrogatories',
  rfas: 'Requests for admission',
  document_request: 'Document request',
  subpoena: 'Subpoena',
  deposition: 'Deposition',
}

/** What each tool is good for, from what good lawyers weigh. */
export const TOOL_HINT: Record<PlannerTool, string> = {
  interview: 'Talk to your own side’s witnesses. Quick, cheap, and the other side doesn’t see it.',
  client: 'Your client’s own records, messages, photos, and the people they know. In writing, so it may be discoverable.',
  investigator: 'Public records, background, and people to talk to. Doesn’t alert the other side.',
  interrogatories: 'Names, documents, dates, and the basis for the other side’s claims, under oath. Limited in number.',
  rfas: 'Best late: narrow the issues and pin down facts the other side can’t honestly deny. They don’t uncover anything new.',
  document_request: 'Documents the other side has. Get them before depositions.',
  subpoena: 'Documents from someone who isn’t a party, like a hospital or a business.',
  deposition: 'Live answers under oath, with follow-up questions. Costly, and the order matters.',
}

/** The tools that go through one person, who's named with them. */
export const WITNESS_TOOLS: PlannerTool[] = ['interview', 'deposition']

/** The prompt for each tool's specifics. */
export const SPECIFICS_HINT: Record<PlannerTool, string> = {
  interview: 'Whom you’ll ask, and what.',
  client: 'What you’ll ask your client for.',
  investigator: 'What you’ll ask the investigator to find.',
  interrogatories: 'What you’ll ask, and what it should pin down.',
  rfas: 'The fact you want admitted.',
  document_request: 'The documents, and the time frame.',
  subpoena: 'Whom you’d subpoena, for which records, and over what time.',
  deposition: 'Whom you’d depose, about what, and when.',
}

export const STEPS = [
  {
    id: 'facts',
    title: 'Facts of consequence',
    guide: [
      'Start from the law. Each claim, charge, or defense has elements, as the jury instructions or the statute state them. Which do you have to prove, and which does the other side?',
      'Write each one as a fact about this case: who did what, when, and how. “The ride” is a topic, and “the park was negligent” is a conclusion; neither can be proven by any one piece of evidence.',
    ],
  },
  {
    id: 'evidence',
    title: 'Sub-facts and evidence',
    guide: [
      'Most facts are proven through a chain: evidence supports a sub-fact, which supports a fact. Break each fact of consequence into the smaller facts that add up to it.',
      'Attach the documents, or the parts of them, that show each one, and tag the witnesses who can speak to it from what they saw or did. Does the excerpt really say what the card claims?',
    ],
  },
  {
    id: 'gaps',
    title: 'Gaps',
    guide: [
      'Tell your story start to finish, the way a juror would hear it. Where would they ask “how do you know that?” or “why would anyone do that?”',
      'Look for holes in the timeline, especially just before and just after the key events. Then tell the other side’s best story: what would it need, and what would undercut it? Not every gap matters; is this one worth filling?',
    ],
  },
  {
    id: 'tools',
    title: 'Tools',
    guide: [
      'For each gap, choose how you’d get the information, and say why. If you choose more than one, put them in order: the one most likely to work, for the least cost, first.',
      'Informal tools (your witnesses, your client, the investigator) are cheap and quiet. Every formal request shows the other side what you care about.',
    ],
  },
  {
    id: 'feedback',
    title: 'Feedback',
    guide: ['When your chart tells your story, ask for feedback. A mentor reads it and asks questions to help you think it through. Then you make the changes.'],
  },
] as const
export type StepId = (typeof STEPS)[number]['id']

/** Whether each step looks done, from the chart. */
export function stepsDone(chart: PlannerChart, feedbackRounds = 0): Record<StepId, boolean> {
  const facts = chart.cards.filter((c) => !c.parentId)
  const backed = (card: PlannerCard) => card.evidence.length > 0 || chart.cards.some((c) => c.parentId === card.id)
  return {
    facts: facts.length > 0,
    evidence: facts.length > 0 && facts.every(backed),
    gaps: chart.gaps.length > 0,
    tools: chart.gaps.length > 0 && chart.gaps.every((g) => g.tools.length > 0),
    feedback: feedbackRounds > 0,
  }
}

/** A card's title, or what it is when it has none yet. */
export const cardTitle = (card: Pick<PlannerCard, 'title' | 'parentId'>) =>
  card.title.trim() || (card.parentId ? 'Untitled sub-fact' : 'Untitled fact')

export const gapTitle = (gap: Pick<PlannerGap, 'description'>) => gap.description.trim() || 'Untitled gap'

/** The cards under `parentId` (the facts of consequence for null), in order. */
export const childrenOf = (chart: PlannerChart, parentId: string | null) =>
  chart.cards.filter((c) => c.parentId === parentId).sort((a, b) => a.position - b.position)

/** Where a dragged card goes: under a card (or the top, null) at a place among its new siblings. */
export interface CardMove {
  cardId: string
  parentId: string | null
  index: number
}

/** The card and every sub-fact under it, which it can't be dropped into. */
export function familyOf(chart: PlannerChart, id: string): Set<string> {
  const family = new Set([id])
  for (let grew = true; grew; ) {
    grew = false
    for (const c of chart.cards) {
      if (c.parentId && family.has(c.parentId) && !family.has(c.id)) {
        family.add(c.id)
        grew = true
      }
    }
  }
  return family
}

/** Where dropping `cardId` on the zone `over` puts it, or null when it can't go there. */
export function dropTarget(chart: PlannerChart, cardId: string, over: string): CardMove | null {
  const family = familyOf(chart, cardId)
  const [zone, id] = over.split(':')
  if (zone === 'root') return { cardId, parentId: null, index: childrenOf(chart, null).filter((c) => c.id !== cardId).length }
  const target = chart.cards.find((c) => c.id === id)
  if (!target) return null
  if (zone === 'into') {
    if (family.has(target.id)) return null
    return { cardId, parentId: target.id, index: childrenOf(chart, target.id).filter((c) => c.id !== cardId).length }
  }
  if (target.id === cardId || (target.parentId && family.has(target.parentId))) return null
  const siblings = childrenOf(chart, target.parentId).filter((c) => c.id !== cardId)
  const at = siblings.findIndex((c) => c.id === target.id)
  return { cardId, parentId: target.parentId, index: zone === 'before' ? at : at + 1 }
}

/** The chart's gaps in the order the tree reads: each card's under it, top to bottom, then the ones about the whole case. */
export function gapsInOrder(chart: PlannerChart): PlannerGap[] {
  const byCard = (cardId: string | null) => chart.gaps.filter((g) => g.cardId === cardId).sort((a, b) => a.position - b.position)
  const walk = (parentId: string | null): PlannerGap[] => childrenOf(chart, parentId).flatMap((c) => [...byCard(c.id), ...walk(c.id)])
  return [...walk(null), ...byCard(null)]
}
