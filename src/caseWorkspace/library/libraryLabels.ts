import type { CheckTag, LibraryKind } from '../../courses/types'
import { PRACTICE_TYPE_LABEL } from '../practice/practiceLabels'

export const KIND_LABEL: Record<LibraryKind, string> = {
  practice: 'Practice',
  discovery: 'Information exchange',
  planner: 'Planner',
}

/** The kinds within each, for the second filter. */
export const SUBKIND_LABEL: Record<string, string> = {
  ...PRACTICE_TYPE_LABEL,
  interrogatories: 'Interrogatories',
  rfas: 'Requests for admission',
  subpoena: 'Subpoenas',
  interrogatories_answers: 'Answers to interrogatories',
  rfas_answers: 'Answers to requests for admission',
  planner: 'Planner feedback',
}

/** Each AI's verdict, in its own words: the discovery mentor's, or the planner's. */
export function tagLabel(kind: LibraryKind, tag: CheckTag) {
  if (kind === 'planner') return { LOOKS_GOOD: 'Ready to act on', SMALL_EDITS: 'Small edits', NEEDS_IMPROVEMENT: 'Needs work' }[tag]
  return { LOOKS_GOOD: 'Looks good', SMALL_EDITS: 'Small edits', NEEDS_IMPROVEMENT: 'Needs improvement' }[tag]
}

/** "Nov 20, 2026" */
export const shortDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
