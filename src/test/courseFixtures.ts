import type { RosterEntry, TaughtCourse } from '../courses/types'

export const trialAd: TaughtCourse = {
  id: 'c1',
  code: 'LAW 540',
  title: 'Trial Advocacy',
  term: 'Fall 2026',
  instructorName: 'Ivy Brooks',
  season: 'Fall',
  year: 2026,
  entryCode: 'K7PQ2M',
  studentCount: 1,
  requestCount: 2,
  invitedCount: 2,
}

export const roster: RosterEntry[] = [
  { email: 'sam@school.edu', name: 'Sam', userId: 'u-1', status: 'joined' },
  { email: 'bo@school.edu', name: 'Bo', userId: 'u-2', status: 'requested' },
  { email: 'cy@school.edu', name: 'Cy', userId: 'u-3', status: 'requested' },
  { email: 'ana@school.edu', name: 'Ana', userId: 'u-4', status: 'invited' },
  { email: 'new@school.edu', name: null, userId: null, status: 'invited' },
]
