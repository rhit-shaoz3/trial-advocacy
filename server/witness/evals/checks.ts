import type { TranscriptTurn } from '../deposition.ts'
import type { PartyRole } from '../prompt.ts'

/**
 * One scripted moment in a deposition: optional earlier turns, then a
 * question. The reply is graded by rule checks here and by a grader model
 * against `rubric` (see runEval.ts). A witness's cases live in the git-ignored
 * .material/witnesses/<name>/eval-cases.json, since they quote case material.
 */
export interface EvalCase {
  id: string
  /** What the case is checking, in a few words. */
  title: string
  side: PartyRole
  attorney?: string
  /** The witness's own lawyer, who may object (only applies to the opposing side). */
  counsel?: string
  transcript?: TranscriptTurn[]
  question: string
  checks?: RuleChecks
  /** What a passing answer does, with the facts the grader needs. */
  rubric: string
}

export interface RuleChecks {
  maxWords?: number
  minWords?: number
  /** Regular expressions (case-insensitive) the answer must match. */
  mustMatch?: string[]
  /** Regular expressions (case-insensitive) the answer must not match. */
  mustNotMatch?: string[]
  /** "required": the defending lawyer must speak; "forbidden": must not. */
  objection?: 'required' | 'forbidden'
  /** When there is an objection, it must match this (case-insensitive). */
  objectionMatch?: string
}

export interface CheckFailure {
  check: string
  detail: string
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length

/**
 * Rules every answer must follow, whatever the question (from the templates:
 * plain spoken text, no stage directions, never step out of character).
 */
export const GLOBAL_CHECKS: { check: string; pattern: RegExp }[] = [
  { check: 'no markdown or lists', pattern: /\*\*|^\s*#{1,6}\s|^\s*[-*•]\s|^\s*\d+[.)]\s/m },
  { check: 'no stage directions', pattern: /\*[^*\n]+\*|\((?:pauses?|laughs?|sighs?|nods?|shrugs?)[^)]*\)|\[[^\]]*\]/i },
  {
    check: 'stays in character',
    pattern: /\b(?:language model|large language|Anthropic|Claude|as an AI|I(?:'m| am) (?:an|a) (?:AI|artificial|chatbot|bot)|simulation|role-?play|my instructions|system prompt)\b/i,
  },
  { check: 'no document labels', pattern: /witness_knows|own_statement|other_witness|case_documents|<\/?document/i },
  { check: 'does not write the next question', pattern: /^\s*Q[:.]/m },
]

/** Rule-checks one reply; an empty list means it passed. */
export function checkReply(
  reply: { answer: string; objection: { text: string } | null },
  checks: RuleChecks = {},
): CheckFailure[] {
  const failures: CheckFailure[] = []
  const answer = reply.answer
  const fail = (check: string, detail: string) => failures.push({ check, detail })

  for (const { check, pattern } of GLOBAL_CHECKS) {
    const match = `${reply.objection?.text ?? ''}\n${answer}`.match(pattern)
    if (match) fail(check, `found "${match[0].trim()}"`)
  }
  if (!answer.trim()) fail('answers the question', 'the answer is empty')

  const count = words(answer)
  if (checks.maxWords !== undefined && count > checks.maxWords) fail('short enough', `${count} words (max ${checks.maxWords})`)
  if (checks.minWords !== undefined && count < checks.minWords) fail('long enough', `${count} words (min ${checks.minWords})`)
  for (const pattern of checks.mustMatch ?? []) {
    if (!new RegExp(pattern, 'i').test(answer)) fail('says what it must', `doesn't match /${pattern}/`)
  }
  for (const pattern of checks.mustNotMatch ?? []) {
    const match = answer.match(new RegExp(pattern, 'i'))
    if (match) fail("doesn't say what it mustn't", `found "${match[0]}" (/${pattern}/)`)
  }

  if (checks.objection === 'required' && !reply.objection) fail('lawyer objects', 'no objection')
  if (checks.objection === 'forbidden' && reply.objection) fail('no objection', `objected: "${reply.objection.text}"`)
  if (reply.objection) {
    if (!/^Objection\b/i.test(reply.objection.text)) fail('objection format', `"${reply.objection.text}" doesn't start with "Objection"`)
    if (checks.objectionMatch && !new RegExp(checks.objectionMatch, 'i').test(reply.objection.text)) {
      fail('right objection', `"${reply.objection.text}" doesn't match /${checks.objectionMatch}/`)
    }
  }
  return failures
}
