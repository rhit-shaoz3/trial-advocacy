import type { CaseParties, Side } from './types'

/** The role a side plays in a case world. */
export const ROLE_LABEL: Record<Side, string> = { plaintiff: 'Plaintiff', defense: 'Defendant' }

/** A side as students see it: "Paige Winston (Plaintiff)", or just "Plaintiff" when the party isn't named. */
export function sideLabel(side: Side, parties?: CaseParties | null) {
  const name = side === 'plaintiff' ? parties?.plaintiff : parties?.defendant
  return name ? `${name} (${ROLE_LABEL[side]})` : ROLE_LABEL[side]
}

/** The parties an "X v. Y" title names, or empty names. */
export function titleParties(title = ''): CaseParties {
  const [plaintiff, defendant] = title.split(/\s+v\.?\s+/i)
  return defendant !== undefined ? { plaintiff: plaintiff.trim(), defendant: defendant.trim() } : { plaintiff: '', defendant: '' }
}

/** The case world's letter: 1 → "A", 26 → "Z", 27 → "AA". */
export function worldLabel(number: number) {
  let label = ''
  for (let n = number; n > 0; n = Math.floor((n - 1) / 26)) {
    label = String.fromCharCode(65 + ((n - 1) % 26)) + label
  }
  return label
}
