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

export const COURSE_CASE_STATUSES = ['draft', 'active', 'closed'] as const
/** Draft: hidden from students. Active: the case worlds have launched. Closed: finished. */
export type CourseCaseStatus = (typeof COURSE_CASE_STATUSES)[number]

/**
 * A case the whole class works on, as its instructor manages it. Teams and
 * case worlds (matchups) hang off it; for now it is just the shell.
 */
export interface CourseCase {
  id: string
  title: string
  summary: string
  status: CourseCaseStatus
  createdAt: string
  updatedAt: string
}

export interface CaseInput {
  title: string
  summary: string
  /** Defaults to draft when creating. */
  status?: CourseCaseStatus
}

/** Students paired for one case: usually two, three for the odd one out. */
export interface Team {
  id: string
  /** The label, as in "Team 3". */
  number: number
  members: RosterEntry[]
}

export const MAX_TEAM_SIZE = 3

export type Side = 'plaintiff' | 'defense'

/** One case world: two teams of a case on opposite sides. `number` 1 is World A. */
export interface Matchup {
  id: string
  number: number
  plaintiffTeamId: string
  defenseTeamId: string
}

/** How a case is paired: its teams, the roster students not on one yet, and the case worlds. */
export interface CaseTeams {
  teams: Team[]
  unpaired: RosterEntry[]
  matchups: Matchup[]
}

export type MyTeamMember = RosterEntry & { you: boolean }

/** A case as a student sees it, with their team and world. Drafts are never included. */
export interface MyCase {
  id: string
  title: string
  summary: string
  status: Exclude<CourseCaseStatus, 'draft'>
  /** Null until the instructor pairs this student for the case. */
  team: { number: number; members: MyTeamMember[] } | null
  /** Null until their team is matched. `number` 1 is World A. */
  world: { number: number; side: Side; opponents: { number: number; members: MyTeamMember[] } } | null
}

/** Everything the UI needs from the courses backend. See `httpCourseService`. */
export interface CourseService {
  // Students
  /** The current user's courses, newest term first. */
  listMyCourses(): Promise<Course[]>
  joinCourse(entryCode: string): Promise<Course>
  /** Everything the course home page (the student's course dashboard) shows. */
  getCourseHome(courseId: string): Promise<CourseHome>

  // Instructors
  /** Courses the current instructor teaches, newest term first. */
  listTaughtCourses(): Promise<TaughtCourse[]>
  createCourse(input: NewCourseInput): Promise<TaughtCourse>
  getCourse(courseId: string): Promise<TaughtCourse>
  updateCourse(courseId: string, input: NewCourseInput): Promise<TaughtCourse>
  /** Also deletes the roster, fact patterns, and cases. */
  deleteCourse(courseId: string): Promise<void>
  listRoster(courseId: string): Promise<RosterEntry[]>
  addStudents(courseId: string, emails: string[]): Promise<AddStudentsResult>
  removeStudent(courseId: string, email: string): Promise<void>
  listFactPatterns(courseId: string): Promise<FactPattern[]>
  uploadFactPattern(courseId: string, file: File): Promise<FactPattern>
  deleteFactPattern(courseId: string, factPatternId: string): Promise<void>
  factPatternDownloadUrl(courseId: string, factPatternId: string): string
  /** Oldest first. */
  listCases(courseId: string): Promise<CourseCase[]>
  createCase(courseId: string, input: CaseInput): Promise<CourseCase>
  getCase(courseId: string, caseId: string): Promise<CourseCase>
  updateCase(courseId: string, caseId: string, input: Required<CaseInput>): Promise<CourseCase>
  deleteCase(courseId: string, caseId: string): Promise<void>
  // Teams for one case. Every change resolves to the case's teams afterwards.
  listTeams(courseId: string, caseId: string): Promise<CaseTeams>
  createTeam(courseId: string, caseId: string, emails: string[]): Promise<CaseTeams>
  /** Pairs every unpaired student at random, avoiding past partners. */
  autoPair(courseId: string, caseId: string): Promise<CaseTeams>
  clearTeams(courseId: string, caseId: string): Promise<CaseTeams>
  deleteTeam(courseId: string, caseId: string, teamId: string): Promise<CaseTeams>
  addTeamMember(courseId: string, caseId: string, teamId: string, email: string): Promise<CaseTeams>
  /** A team left with nobody is deleted. */
  removeTeamMember(courseId: string, caseId: string, teamId: string, email: string): Promise<CaseTeams>
  // Case worlds (matchups). Changes also resolve to the case's teams.
  createMatchup(
    courseId: string,
    caseId: string,
    plaintiffTeamId: string,
    defenseTeamId: string,
  ): Promise<CaseTeams>
  /** Matches every waiting team, avoiding past opponents and alternating sides. */
  autoMatch(courseId: string, caseId: string): Promise<CaseTeams>
  clearMatchups(courseId: string, caseId: string): Promise<CaseTeams>
  swapSides(courseId: string, caseId: string, matchupId: string): Promise<CaseTeams>
  deleteMatchup(courseId: string, caseId: string, matchupId: string): Promise<CaseTeams>

  // Students
  /** The current student's non-draft cases and their team in each. */
  listMyCases(courseId: string): Promise<MyCase[]>
}
