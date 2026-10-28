import { SUBPOENA_TYPES, type ExchangeKind, type PartSettings, type Side, type SubpoenaSettings, type SubpoenaType } from '../../../courses/types'

export const SIDE_LABEL: Record<Side, string> = { plaintiff: 'Plaintiff', defense: 'Defense' }

export const KIND_LABEL: Record<ExchangeKind, string> = {
  interrogatories: 'Interrogatories',
  rfas: 'Requests for admission',
}

/** "15 questions per team · 30 days to respond" */
export const partSummary = (part: PartSettings, unit: string) =>
  `${part.limit} ${unit} per team · ${part.days} day${part.days === 1 ? '' : 's'} to respond`

/** Short names for what subpoenas can ask for, for summaries. */
export const SUBPOENA_TYPE_SHORT: Record<SubpoenaType, string> = {
  documents: 'documents',
  esi: 'ESI',
  tangible_things: 'tangible things',
  inspection: 'inspections',
}

/** "3 subpoenas per team · documents and ESI only" (no deadline: the instructor answers them). */
export function subpoenaSummary(part: SubpoenaSettings) {
  const base = `${part.limit} subpoena${part.limit === 1 ? '' : 's'} per team`
  const types = part.types ?? SUBPOENA_TYPES
  if (types.length === SUBPOENA_TYPES.length) return base
  const names = types.map((t) => SUBPOENA_TYPE_SHORT[t])
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  return `${base} · ${list} only`
}
