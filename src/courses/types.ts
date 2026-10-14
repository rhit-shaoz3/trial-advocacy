import type { CourseHome } from '../workspace/types'

export interface Course {
  id: string
  code: string
  title: string
  /** e.g. "Fall 2026" */
  term: string
  instructorName: string | null
}

export const SEASONS = ['Fall', 'Winter', 'Spring', 'Summer'] as const
export type Season = (typeof SEASONS)[number]

/** A course as its instructor sees it. */
export interface TaughtCourse extends Course {
  /** `term` split into its parts, for the edit form. */
  season: Season
  year: number
  entryCode: string
  /** Joined students. */
  studentCount: number
  /** Students who entered the entry code and are waiting to be admitted. */
  requestCount: number
  /** Invitations not yet accepted. */
  invitedCount: number
}

export interface NewCourseInput {
  code: string
  title: string
  season: Season
  year: number
}

/**
 * joined: in the course. invited: added by email, waiting for the student to
 * accept. requested: entered the entry code, waiting for the instructor.
 */
export type RosterStatus = 'joined' | 'invited' | 'requested'

export interface RosterEntry {
  email: string
  /** Null until the student signs up. */
  name: string | null
  /** The student's account, if they have one. */
  userId: string | null
  status: RosterStatus
}

export type Decision = 'admit' | 'deny'

/** A course in a student's inbox, e.g. an invitation. */
export interface InboxCourse {
  courseId: string
  /** e.g. "LAW 540: Trial Advocacy" */
  courseName: string
}

export interface StudentInbox {
  invitations: InboxCourse[]
  pendingRequests: InboxCourse[]
  denials: InboxCourse[]
}

export interface JoinResult {
  course: Course
  /** 'joined' if the instructor had invited them, otherwise waiting to be admitted. */
  status: 'joined' | 'requested'
}

export interface AddStudentsResult {
  added: string[]
  skipped: { email: string; reason: string }[]
  roster: RosterEntry[]
}

export interface FactPattern {
  id: string
  filename: string
  sizeBytes: number
  uploadedAt: string
}

/** Everything the UI needs from the courses backend. See `httpCourseService`. */
export interface CourseService {
  // Students
  /** The current user's courses, newest term first. */
  listMyCourses(): Promise<Course[]>
  /** Asks to join (or joins, if invited). */
  joinCourse(entryCode: string): Promise<JoinResult>
  getInbox(): Promise<StudentInbox>
  answerInvitation(courseId: string, accept: boolean): Promise<void>
  dismissDenial(courseId: string): Promise<void>
  /** Everything the course home page (the student's course dashboard) shows. */
  getCourseHome(courseId: string): Promise<CourseHome>

  // Instructors
  /** Courses the current instructor teaches, newest term first. */
  listTaughtCourses(): Promise<TaughtCourse[]>
  createCourse(input: NewCourseInput): Promise<TaughtCourse>
  getCourse(courseId: string): Promise<TaughtCourse>
  updateCourse(courseId: string, input: NewCourseInput): Promise<TaughtCourse>
  /** Also deletes the roster and fact patterns. */
  deleteCourse(courseId: string): Promise<void>
  listRoster(courseId: string): Promise<RosterEntry[]>
  addStudents(courseId: string, emails: string[]): Promise<AddStudentsResult>
  removeStudent(courseId: string, email: string): Promise<void>
  /** Admits or denies students who entered the entry code. Returns the new roster. */
  decideRequests(courseId: string, userIds: string[], decision: Decision): Promise<RosterEntry[]>
  listFactPatterns(courseId: string): Promise<FactPattern[]>
  uploadFactPattern(courseId: string, file: File): Promise<FactPattern>
  deleteFactPattern(courseId: string, factPatternId: string): Promise<void>
  factPatternDownloadUrl(courseId: string, factPatternId: string): string
}
