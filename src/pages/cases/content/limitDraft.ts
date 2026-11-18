import { MAX_LIMIT, type InteractionLimit, type LimitScope } from '../../../courses/types'

/** A limit as it's being typed: the number stays text until it's saved. */
export interface LimitDraft {
  max: string
  per: LimitScope
}

export const limitDraft = (limit: InteractionLimit): LimitDraft => ({ max: String(limit.max), per: limit.per })

/** The draft as a limit, or null while the number isn't a whole number from 1 to MAX_LIMIT. */
export function parseLimit(draft: LimitDraft): InteractionLimit | null {
  const max = Number(draft.max)
  return /^\d+$/.test(draft.max.trim()) && max >= 1 && max <= MAX_LIMIT ? { max, per: draft.per } : null
}

export const sameLimit = (a: InteractionLimit | null, b: InteractionLimit) => a?.max === b.max && a?.per === b.per
