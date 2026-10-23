import type { CasePhase, Course, Side } from '../courses/types'

// What a course home page shows. The server sends this from
// GET /api/courses/:id/home. Activity, deadlines, and case progress aren't
// stored yet, so those come back empty (see sampleData.ts for dev previews).

export type CaseStatus = 'active' | 'in-review' | 'closed'

export interface CaseParticipant {
  name: string
  /** Their profile picture, or null for initials. */
  avatarUrl?: string | null
}

export interface CaseSummary {
  id: string
  /** Docket-style number, e.g. "24-CV-1847". Only in sample data so far. */
  caseNumber?: string
  /** e.g. "Anderson v. Caldwell" */
  title: string
  /** e.g. "Premises liability · Civil". Only in sample data so far. */
  caseType?: string
  summary: string
  status: CaseStatus
  /** A student's case world and their role in it, once their team is matched. */
  world?: { number: number; side: Side } | null
  /** How many case worlds the case has; set for the instructor. */
  worldCount?: number | null
  /** 0–100, or null while progress isn't tracked. */
  progress: number | null
  /** The next thing that matters, e.g. "Discovery due Oct 13" or "Awaiting instructor review". */
  nextMilestone: string | null
  /** The team's soonest-due open task (real cases; sample data uses nextMilestone). */
  nextTask?: { title: string; dueAt: string | null } | null
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
  /** Instructor: conversations waiting for review. */
  reviewCount?: number
  /** Student: completed reviews of their interviews they haven't opened yet. */
  newReviewResults?: number
  /** Instructor: their own dashboard. */
  instructor?: InstructorHome
}

// The instructor's dashboard; matches server/courses/instructorHome.ts.

export interface CaseMonitor {
  id: string
  title: string
  status: 'draft' | 'active' | 'closed'
  phase: CasePhase
  /** Whether the case has a background investigator (and so an investigate phase). */
  investigatorEnabled?: boolean
  worldCount: number
  /** Drafts: launch checklist items met, of the total, and the first one still missing. */
  launch: { ready: number; total: number; next: string | null } | null
  /** Active cases: teams that finished every task due so far (`due` tasks), and every task assigned. */
  tasks: { due: number; teamsDoneDue: number; assigned: number; teamsDoneAll: number; teams: number } | null
}

export type AttentionTarget = { page: 'review' } | { page: 'manage' } | { page: 'case'; caseId: string; tab?: 'materials' }

export interface AttentionItem {
  id: string
  kind: 'reviews' | 'failedReviews' | 'transcription' | 'roster' | 'launch'
  text: string
  target: AttentionTarget
}

export interface DeadlineProgress {
  id: string
  title: string
  caseId: string
  caseTitle: string
  /** ISO timestamp */
  dueAt: string
  teamsDone: number
  teams: number
}

export interface InstructorActivity {
  id: string
  kind: 'interview' | 'task' | 'review' | 'join'
  actor: string | null
  action: string
  caseTitle: string | null
  /** ISO timestamp */
  at: string
}

export interface InstructorHome {
  stats: {
    studentsJoined: number
    studentsOnRoster: number
    activeCases: number
    draftCases: number
    questionsThisWeek: number
    reviewsWaiting: number
  }
  cases: CaseMonitor[]
  attention: AttentionItem[]
  deadlines: DeadlineProgress[]
  activity: InstructorActivity[]
}
