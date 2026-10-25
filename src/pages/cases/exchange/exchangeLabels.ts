import type { ExchangeKind, PartSettings, Side } from '../../../courses/types'

export const SIDE_LABEL: Record<Side, string> = { plaintiff: 'Plaintiff', defense: 'Defense' }

export const KIND_LABEL: Record<ExchangeKind, string> = {
  interrogatories: 'Interrogatories',
  rfas: 'Requests for admission',
}

/** "15 questions per team · 30 days to respond" */
export const partSummary = (part: PartSettings, unit: string) =>
  `${part.limit} ${unit} per team · ${part.days} day${part.days === 1 ? '' : 's'} to respond`
