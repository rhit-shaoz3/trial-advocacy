import { randomInt } from 'node:crypto'

const MAX_PREFIX_LENGTH = 4
const FALLBACK_PREFIX = 'CLASS'

/**
 * The part of a join code taken from the class name: the first character of
 * each word, or the first few characters of a single-word name.
 * "Trial Advocacy Fall 2026" -> "TAF2", "Evidence" -> "EVID".
 */
export function joinCodePrefix(className: string) {
  const words = className
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
  if (words.length === 0) return FALLBACK_PREFIX
  if (words.length === 1) return words[0].slice(0, MAX_PREFIX_LENGTH)
  return words
    .slice(0, MAX_PREFIX_LENGTH)
    .map((word) => word[0])
    .join('')
}

/** e.g. makeJoinCode("Evidence", 3) -> "EVID517". Uniqueness is up to the caller. */
export function makeJoinCode(className: string, digits: number) {
  const suffix = String(randomInt(10 ** digits)).padStart(digits, '0')
  return joinCodePrefix(className) + suffix
}

/** Turns what a user typed into the stored form: " taf2-482" -> "TAF2482". */
export function normalizeJoinCode(input: string) {
  return input.toUpperCase().replace(/[\s-]/g, '')
}
