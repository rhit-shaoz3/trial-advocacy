import type { ImportantFacts, Side } from '../../courses/types'

export const SIDE_FACT_LABEL: Record<Side, string> = { plaintiff: 'plaintiff', defense: 'defense' }

/** One editable fact; `key` keeps each input's identity while rows come and go. */
export interface FactRow {
  key: number
  text: string
}

let nextKey = 0
export const toRows = (facts: string[]): FactRow[] =>
  (facts.length ? facts : ['']).map((text) => ({ key: nextKey++, text }))

/** The non-blank facts, trimmed. */
export const cleanFacts = (rows: FactRow[]) => rows.map((r) => r.text.trim()).filter(Boolean)

/** The first side with no facts, for the form's error message, or null if both have some. */
export function missingSide(facts: ImportantFacts): Side | null {
  if (facts.plaintiff.length === 0) return 'plaintiff'
  if (facts.defense.length === 0) return 'defense'
  return null
}
