import type { Course } from '../courses/types'

// What a student's course home page shows. The server sends this from
// GET /api/courses/:id/home. Cases, activity, and deadlines aren't stored yet,
// so for now those lists come back empty (see sampleData.ts for dev previews).

export type CaseStatus = 'active' | 'in-review' | 'closed'

export interface CaseParticipant {
  name: string
}

export interface CaseSummary {
  id: string
  /** Docket-style number, e.g. "24-CV-1847". */
  caseNumber: string
  /** e.g. "Anderson v. Caldwell" */
  title: string
  /** e.g. "Premises liability · Civil" */
  caseType: string
  summary: string
  status: CaseStatus
  /** 0–100 */
  progress: number
  /** The next thing that matters, e.g. "Discovery due Oct 13" or "Awaiting instructor review". */
  nextMilestone: string | null
  participants: CaseParticipant[]
}

export type ActivityKind = 'task' | 'document' | 'approval'

export interface ActivityItem {
  id: string
  kind: ActivityKind
  /** Rendered in bold before `action`; null for system events ("New document added…"). */
  actor: string | null
  action: string
  caseTitle: string
  /** ISO timestamp */
  at: string
}

export interface UpcomingItem {
  id: string
  /** Deadlines are highlighted in red; events (depositions, meetings) in blue. */
  kind: 'deadline' | 'event'
  title: string
  caseTitle: string
  /** ISO timestamp */
  at: string
}

export interface CourseHome {
  course: Course
  cases: CaseSummary[]
  activity: ActivityItem[]
  upcoming: UpcomingItem[]
  stats: { tasksCompleted: number; tasksCompletedThisWeek: number }
}
