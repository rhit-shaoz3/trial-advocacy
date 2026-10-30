import {
  DEFAULT_AI_FEEDBACK,
  SUBPOENA_TYPES,
  type AiFeedbackSettings,
  type ExchangeKind,
  type PartSettings,
  type Side,
  type SubpoenaSettings,
  type SubpoenaType,
} from '../../../courses/types'

export const SIDE_LABEL: Record<Side, string> = { plaintiff: 'Plaintiff', defense: 'Defense' }

export const KIND_LABEL: Record<ExchangeKind, string> = {
  interrogatories: 'Interrogatories',
  rfas: 'Requests for admission',
}

/** "AI feedback: 2 rounds", "AI feedback: unlimited", or "No AI feedback" (the default when not given). */
export function aiFeedbackSummary(given: AiFeedbackSettings | undefined) {
  const ai = given ?? DEFAULT_AI_FEEDBACK
  if (!ai.enabled) return 'No AI feedback'
  if (!ai.rounds) return 'AI feedback: unlimited'
  return `AI feedback: ${ai.rounds} round${ai.rounds === 1 ? '' : 's'}`
}

/** "15 questions per team · 30 days to respond · AI feedback: 2 rounds" */
export const partSummary = (part: PartSettings, unit: string) =>
  `${part.limit} ${unit} per team · ${part.days} day${part.days === 1 ? '' : 's'} to respond · ${aiFeedbackSummary(part.aiFeedback)}`

/** Short names for what subpoenas can ask for, for summaries. */
export const SUBPOENA_TYPE_SHORT: Record<SubpoenaType, string> = {
  documents: 'documents/ESI',
  tangible_things: 'tangible things',
  inspection: 'inspections',
}

/** "3 subpoenas per team · documents/ESI and tangible things only · AI feedback: 2 rounds" (no deadline: the instructor answers them). */
export function subpoenaSummary(part: SubpoenaSettings) {
  const base = `${part.limit} subpoena${part.limit === 1 ? '' : 's'} per team`
  const ai = aiFeedbackSummary(part.aiFeedback)
  const types = part.types ?? SUBPOENA_TYPES
  if (types.length === SUBPOENA_TYPES.length) return `${base} · ${ai}`
  const names = types.map((t) => SUBPOENA_TYPE_SHORT[t])
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  return `${base} · ${list} only · ${ai}`
}
