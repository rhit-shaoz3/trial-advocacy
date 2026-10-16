import type { Side } from './types'

/** The role a side plays in a case world. */
export const ROLE_LABEL: Record<Side, string> = { plaintiff: 'Plaintiff', defense: 'Defendant' }

/** The case world's letter: 1 → "A", 26 → "Z", 27 → "AA". */
export function worldLabel(number: number) {
  let label = ''
  for (let n = number; n > 0; n = Math.floor((n - 1) / 26)) {
    label = String.fromCharCode(65 + ((n - 1) % 26)) + label
  }
  return label
}
