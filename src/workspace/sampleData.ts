import type { CourseHome } from './types'

/**
 * Made-up cases, activity, and deadlines for previewing the course home page
 * before the real case data exists. Only used in development, when the URL has
 * `?sample` (see WorkspaceLayout). Dates are relative to `now` so the page
 * always looks current.
 */
export function withSampleData(home: CourseHome, now = new Date()): CourseHome {
  const at = (days: number, hours: number, minutes: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() + days)
    d.setHours(hours, minutes, 0, 0)
    return d.toISOString()
  }
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString()
  const shortDate = (days: number) =>
    new Date(now.getTime() + days * 86_400_000).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })

  return {
    ...home,
    cases: [
      {
        id: 'sample-1',
        caseNumber: '24-CV-1847',
        title: 'Anderson v. Caldwell',
        caseType: 'Premises liability · Civil',
        summary:
          'A customer injured in a grocery store alleges the owner failed to address a known hazardous condition.',
        status: 'active',
        progress: 62,
        nextMilestone: `Discovery due ${shortDate(3)}`,
        participants: [
          { name: 'Alex Morgan' },
          { name: 'Jordan Kim' },
          { name: 'Sam Patel' },
          { name: 'Taylor Nguyen' },
        ],
      },
      {
        id: 'sample-2',
        caseNumber: '24-CV-1122',
        title: 'Rivera v. Metro Transit',
        caseType: 'Negligence · Civil',
        summary:
          'A transit passenger brings a negligence claim following an injury during an emergency stop.',
        status: 'in-review',
        progress: 88,
        nextMilestone: 'Awaiting instructor review',
        participants: [
          { name: 'Alex Morgan' },
          { name: 'Lee Brooks' },
          { name: 'Nia Okafor' },
          { name: 'Dana Wells' },
        ],
      },
    ],
    activity: [
      {
        id: 'a1',
        kind: 'task',
        actor: 'Jordan Kim',
        action: 'completed the witness interview',
        caseTitle: 'Anderson v. Caldwell',
        at: ago(42),
      },
      {
        id: 'a2',
        kind: 'document',
        actor: null,
        action: 'New document added to the evidence locker',
        caseTitle: 'Anderson v. Caldwell',
        at: ago(120),
      },
      {
        id: 'a3',
        kind: 'approval',
        actor: null,
        action: 'Your deposition outline was approved',
        caseTitle: 'Rivera v. Metro Transit',
        at: ago(26 * 60),
      },
    ],
    upcoming: [
      {
        id: 'u1',
        kind: 'deadline',
        title: 'Discovery deadline',
        caseTitle: 'Anderson v. Caldwell',
        at: at(3, 23, 59),
      },
      {
        id: 'u2',
        kind: 'event',
        title: 'Team deposition',
        caseTitle: 'Rivera v. Metro Transit',
        at: at(8, 14, 30),
      },
    ],
    stats: { tasksCompleted: 18, tasksCompletedThisWeek: 6 },
  }
}
