import type { Exhibit, ExhibitStatus, Side } from './types'

/** Where an exhibit stands, for the instructor (who's on neither side). */
export const EXHIBIT_STATUS_LABEL: Record<ExhibitStatus, string> = {
  awaiting_authenticity: 'Waiting on authenticity',
  authenticity_review: 'Authenticity challenged',
  inauthentic: 'Rejected as inauthentic',
  awaiting_admission: 'Waiting on admission',
  objection_response: 'Objected to',
  admission_review: 'Objection to rule on',
  dropped: 'Dropped',
  admitted: 'Admitted',
  excluded: 'Excluded',
}

export const EXHIBIT_SIDE: Record<Side, string> = { plaintiff: 'Plaintiff', defense: 'Defense' }

/** "P-1" or "D-A", once the list is final. */
export const exhibitLabel = (x: Pick<Exhibit, 'label' | 'offeredBy'>) =>
  x.label ? `${x.offeredBy === 'plaintiff' ? 'P' : 'D'}-${x.label}` : null

/** "3-5, 9" → [3, 4, 5, 9]; null when it isn't a list of pages. */
export function parsePages(text: string): number[] | null {
  const pages = new Set<number>()
  for (const piece of text.split(',').map((p) => p.trim()).filter(Boolean)) {
    const match = /^(\d+)\s*(?:[-–]\s*(\d+))?$/.exec(piece)
    if (!match) return null
    const from = Number(match[1])
    const to = Number(match[2] ?? match[1])
    if (from < 1 || to < from || to - from > 2000) return null
    for (let n = from; n <= to; n++) pages.add(n)
  }
  return pages.size > 0 ? [...pages].sort((a, b) => a - b) : null
}

/** [3, 4, 5, 9] → "3–5, 9". */
export function pagesText(pages: number[]) {
  const ranges: string[] = []
  for (let i = 0; i < pages.length; i++) {
    let j = i
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++
    ranges.push(j > i ? `${pages[i]}–${pages[j]}` : `${pages[i]}`)
    i = j
  }
  return ranges.join(', ')
}
