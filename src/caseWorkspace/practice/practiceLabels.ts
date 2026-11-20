import type { CoachKind, Cooperation, PracticeType, Side } from '../../courses/types'

/** What every student reads before starting, from the practice supplement. */
export const PRACTICE_INTRO =
  'Practice isn’t about getting through the whole conversation. Pick one point or section and work on it; the habits carry over to everything else.'

export const PRACTICE_TYPE_LABEL: Record<PracticeType, string> = {
  interview: 'Interview',
  deposition: 'Deposition',
  direct: 'Direct examination',
  cross: 'Cross-examination',
  redirect: 'Redirect examination',
}

/** What each setting is, for the setup form. */
export const PRACTICE_TYPE_HINT: Record<PracticeType, string> = {
  interview: 'Informal, before trial, with your side’s own witness. Leading is fine and nobody objects.',
  deposition: 'Under oath, before trial. The witness’s lawyer may object to the form of a question.',
  direct: 'At trial, with your own witness. No leading questions; opposing counsel objects and the judge rules.',
  cross: 'At trial, with the other side’s witness. Short, leading questions, one fact at a time.',
  redirect: 'At trial, after cross. Repair the damage briefly, only on what cross raised, and without leading.',
}

export const COOPERATION_LABEL: Record<Cooperation, string> = {
  hostile: 'Hostile',
  regular: 'Regular',
  cooperative: 'Cooperative',
}

/** The settings a witness offers (as the server allows): your own side's examined, the other side's deposed and crossed. */
export const practiceTypesFor = (witnessSide: Side | null, teamSide: Side | null): PracticeType[] =>
  witnessSide === teamSide ? ['interview', 'direct', 'redirect'] : ['deposition', 'cross']

export const isTrialExam = (type: PracticeType) => type === 'direct' || type === 'cross' || type === 'redirect'

export const COACH_LABEL: Record<CoachKind, string> = {
  good: 'Good question',
  off_target: 'Off target',
  leading: 'Leading',
  evidence: 'Evidence',
  ethics: 'Professional responsibility',
  judge_jury: 'Judge and jury',
  grammar: 'Wording',
  polish: 'Polish',
  note: 'Coach',
}

/** How each note is colored: green for good, amber for off target, rose for problems, blue for style. */
export const COACH_TONE: Record<CoachKind, 'good' | 'aim' | 'problem' | 'style'> = {
  good: 'good',
  off_target: 'aim',
  leading: 'problem',
  evidence: 'problem',
  ethics: 'problem',
  judge_jury: 'problem',
  grammar: 'style',
  polish: 'style',
  note: 'style',
}

/** For matching a quote: one case, and straight quotes for curly ones (the same length, so places line up). */
const loose = (text: string) => text.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"')

/** Where each quote is in the text, first match, in order, skipping any that overlap one before. */
export function markQuotes(text: string, quotes: (string | null)[]) {
  const lower = loose(text)
  const spans: { start: number; end: number; index: number }[] = []
  quotes.forEach((quote, index) => {
    if (!quote) return
    const start = lower.indexOf(loose(quote))
    if (start < 0) return
    const end = start + quote.length
    if (spans.some((s) => start < s.end && end > s.start)) return
    spans.push({ start, end, index })
  })
  return spans.sort((a, b) => a.start - b.start)
}
