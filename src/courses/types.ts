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
  studentCount: number
}

export interface NewCourseInput {
  code: string
  title: string
  season: Season
  year: number
}

export interface RosterEntry {
  email: string
  /** Null until the student signs up. */
  name: string | null
  /** False while the student is pending (added by email, no account yet). */
  joined: boolean
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
  joinCourse(entryCode: string): Promise<Course>

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
  listFactPatterns(courseId: string): Promise<FactPattern[]>
  uploadFactPattern(courseId: string, file: File): Promise<FactPattern>
  deleteFactPattern(courseId: string, factPatternId: string): Promise<void>
  factPatternDownloadUrl(courseId: string, factPatternId: string): string
}
