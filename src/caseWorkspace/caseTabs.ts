/** The tabs of a student's case page, in order. */
const TABS = ['overview', 'case-file', 'witnesses', 'investigator', 'tasks', 'reviews'] as const
export type CaseTab = (typeof TABS)[number]

/** A tab named in a link (`?tab=investigator`), or undefined when it names none. */
export function caseTab(value: string | null): CaseTab | undefined {
  return TABS.find((t) => t === value)
}
