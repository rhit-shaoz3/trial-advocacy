import type { SubpoenaType } from './types'

/** What a subpoena asks for, as the form and its menu name it. */
export const SUBPOENA_TYPE_LABEL: Record<SubpoenaType, string> = {
  documents: 'Physical documents',
  esi: 'Electronically stored information',
  tangible_things: 'Tangible things',
  inspection: 'Inspection of premises',
}

/** A line on what each kind of request covers. */
export const SUBPOENA_TYPE_HINT: Record<SubpoenaType, string> = {
  documents: 'Paper or scanned records: files, logs, letters, reports.',
  esi: 'Emails, texts, databases, video, and other electronic data. Say what form you want it in.',
  tangible_things: 'Objects, like a part, a device, or a piece of clothing, made available to inspect.',
  inspection: 'Entry onto land or a building to inspect, measure, and photograph it.',
}

const DISTRICTS = [
  'Northern District of Lincoln',
  'Southern District of Lincoln',
  'Eastern District of Columbia',
  'Western District of Franklin',
  'Central District of Jefferson',
  'District of Madison',
]

const CLERKS = ['Margaret A. Holloway', 'Desmond K. Reyes', 'Patricia L. Onwuachi', 'Gregory T. Lindqvist', 'Helen M. Castellano', 'Samuel J. Whitfield']

/** A small, stable number from text (the same case always gets the same court). */
function seed(text: string) {
  let h = 0
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}

/**
 * The made-up court details on a case's subpoenas: its district, civil action
 * number, and clerk. Picked from the case id, so every subpoena in a case shows
 * the same ones.
 */
export function courtDetails(caseId: string) {
  const h = seed(caseId)
  return {
    district: DISTRICTS[h % DISTRICTS.length],
    actionNumber: `1:26-cv-${String(1000 + (h % 9000)).padStart(5, '0')}`,
    clerk: CLERKS[Math.floor(h / DISTRICTS.length) % CLERKS.length],
  }
}

/** "October 28, 2026", from an ISO date. */
export const formDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
