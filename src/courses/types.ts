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

export const COURSE_CASE_STATUSES = ['draft', 'active', 'closed'] as const
/** Draft: hidden from students. Active: the case worlds have launched. Closed: finished. */
export type CourseCaseStatus = (typeof COURSE_CASE_STATUSES)[number]

/**
 * A case the whole class works on, as its instructor manages it. Teams, case
 * worlds (matchups), materials, witnesses, and tasks hang off it.
 */
/** The most important facts for each side. Instructors and AI witnesses only; students never see them. */
export interface ImportantFacts {
  plaintiff: string[]
  defense: string[]
}

export interface CourseCase {
  id: string
  title: string
  summary: string
  status: CourseCaseStatus
  /** Shown on every student's case dashboard. */
  instructorNote: string
  /** "Today" inside the case for its AI witnesses (YYYY-MM-DD); null means the real date. */
  inWorldDate: string | null
  /** Issues the AI witnesses must leave disputed. */
  disputedIssues: string
  /** The AI witnesses never contradict these. */
  importantFacts: ImportantFacts
  createdAt: string
  updatedAt: string
}

export interface WitnessSettingsInput {
  inWorldDate: string | null
  disputedIssues: string
}

export interface CaseInput {
  title: string
  summary: string
  /** Defaults to draft when creating. */
  status?: CourseCaseStatus
  /** At least one per side. */
  importantFacts: ImportantFacts
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

/** Who can see a piece of case content: everyone in the case, or one side. */
export type Audience = 'all' | Side
export const AUDIENCES: Audience[] = ['all', 'plaintiff', 'defense']

/** Case files can also be kept from students entirely, like an AI witness's deposition. */
export type MaterialAudience = Audience | 'instructor'
export const MATERIAL_AUDIENCES: MaterialAudience[] = [...AUDIENCES, 'instructor']

/**
 * Each file is transcribed once, after upload, for the AI witnesses to read:
 * pending while that runs, then ready, failed, or none (nothing to read, like audio).
 */
export type TextStatus = 'pending' | 'ready' | 'failed' | 'none'

/** A file in a case's case file: one piece of the fact pattern. */
export interface CaseMaterial {
  id: string
  audience: MaterialAudience
  filename: string
  description: string
  contentType: string
  sizeBytes: number
  uploadedAt: string
  textStatus: TextStatus
  textError: string | null
}

export interface MaterialInput {
  audience: MaterialAudience
  description: string
}

/**
 * Someone in the case's story. With a side and a deposition file, an AI
 * witness that teams can interview.
 */
export interface Witness {
  id: string
  name: string
  role: string
  description: string
  audience: Audience
  /** The side the witness testifies for; null until it is an AI witness. */
  alignedSide: Side | null
  /** Demeanor and background for the AI to play. */
  personaNotes: string
  /** The witness's own deposition, the account the AI keeps to. */
  depositionMaterialId: string | null
  /** Other case files the witness has seen. */
  knownMaterialIds: string[]
  /** The witness's lawyer, who may object when the other side asks. */
  defendingCounsel: string
}

export type WitnessInput = Omit<Witness, 'id'>

/** What students see of a witness (never its AI setup). */
export interface WorkspaceWitness {
  id: string
  name: string
  role: string
  description: string
  audience: Audience
  /** An AI witness the team can interview. */
  canInterview: boolean
}

/** A team's (or the instructor's test) interview of an AI witness, before any deposition. */
export interface Interview {
  id: string
  side: Side
  witness: { id: string; name: string; role: string }
  turns: {
    position: number
    question: string
    /** The defending lawyer's objection, as "Name: text". */
    objection: string | null
    answer: string
    askedBy: string | null
    createdAt: string
  }[]
  maxTurns: number
  canAsk: boolean
  /** Why questions can't be asked, when they can't. */
  notice: string | null
}

/** Whose interview: the student's team (as its own side), or the instructor testing as one side. */
export type InterviewAs = 'team' | Side

/** Work every team on `audience`'s side does for the case. */
export interface CaseTask {
  id: string
  title: string
  description: string
  /** ISO timestamp, or null for no due date. */
  dueAt: string | null
  audience: Audience
}

export type TaskInput = Omit<CaseTask, 'id'>

/** One thing that must be true before the case worlds can launch. */
export interface LaunchCheck {
  key: 'paired' | 'matched' | 'caseFile'
  ok: boolean
  message: string
}

/**
 * One case as a student sees it (or as the instructor previews it): their
 * team and world, and the material their side can see.
 */
export interface CaseWorkspace {
  case: {
    id: string
    title: string
    summary: string
    status: CourseCaseStatus
    instructorNote: string
  }
  team: MyCase['team']
  world: MyCase['world']
  /** Which side's material is shown; null before the student's team is matched. */
  side: Side | null
  materials: CaseMaterial[]
  witnesses: WorkspaceWitness[]
  /** Soonest due first; completion is the team's. */
  tasks: (CaseTask & { completedAt: string | null; completedBy: string | null })[]
  /** The instructor viewing it as a team would; nothing can be changed. */
  preview: boolean
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
  /** Also deletes the roster and the cases with everything in them. */
  deleteCourse(courseId: string): Promise<void>
  listRoster(courseId: string): Promise<RosterEntry[]>
  addStudents(courseId: string, emails: string[]): Promise<AddStudentsResult>
  removeStudent(courseId: string, email: string): Promise<void>
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
  // What the instructor provides for a case.
  /** The case file, in upload order. */
  listMaterials(courseId: string, caseId: string): Promise<CaseMaterial[]>
  uploadMaterial(courseId: string, caseId: string, file: File, input: MaterialInput): Promise<CaseMaterial>
  updateMaterial(courseId: string, caseId: string, materialId: string, input: MaterialInput): Promise<CaseMaterial>
  deleteMaterial(courseId: string, caseId: string, materialId: string): Promise<void>
  materialDownloadUrl(courseId: string, caseId: string, materialId: string): string
  /** The file's transcription (what the AI witnesses read), as plain text. */
  materialTextUrl(courseId: string, caseId: string, materialId: string): string
  /** Starts transcribing the file again; resolves at once with it pending. */
  retryTranscription(courseId: string, caseId: string, materialId: string): Promise<CaseMaterial>
  listWitnesses(courseId: string, caseId: string): Promise<Witness[]>
  createWitness(courseId: string, caseId: string, input: WitnessInput): Promise<Witness>
  updateWitness(courseId: string, caseId: string, witnessId: string, input: WitnessInput): Promise<Witness>
  deleteWitness(courseId: string, caseId: string, witnessId: string): Promise<void>
  /** Soonest due first. */
  listTasks(courseId: string, caseId: string): Promise<CaseTask[]>
  createTask(courseId: string, caseId: string, input: TaskInput): Promise<CaseTask>
  updateTask(courseId: string, caseId: string, taskId: string, input: TaskInput): Promise<CaseTask>
  deleteTask(courseId: string, caseId: string, taskId: string): Promise<void>
  saveInstructorNote(courseId: string, caseId: string, note: string): Promise<CourseCase>
  saveWitnessSettings(courseId: string, caseId: string, input: WitnessSettingsInput): Promise<CourseCase>
  getLaunchChecks(courseId: string, caseId: string): Promise<LaunchCheck[]>
  /** Makes a ready draft case active, launching every case world. */
  launchCase(courseId: string, caseId: string): Promise<CourseCase>
  /** The case dashboard as one side (or one world's team on that side) sees it. */
  previewWorkspace(courseId: string, caseId: string, side: Side, matchupId: string | null): Promise<CaseWorkspace>

  // Students
  /** The current student's non-draft cases and their team in each. */
  listMyCases(courseId: string): Promise<MyCase[]>
  /** The student's dashboard for one launched case. */
  getMyCaseWorkspace(courseId: string, caseId: string): Promise<CaseWorkspace>
  /** Marks a task done (or not) for the student's whole team. */
  setTaskDone(courseId: string, caseId: string, taskId: string, done: boolean): Promise<CaseWorkspace>
  myMaterialDownloadUrl(courseId: string, caseId: string, materialId: string): string

  // Interviews with AI witnesses: the student's team's, or the instructor's test as one side.
  getInterview(courseId: string, caseId: string, witnessId: string, as: InterviewAs): Promise<Interview>
  askWitness(courseId: string, caseId: string, witnessId: string, as: InterviewAs, question: string): Promise<Interview>
  /** Ends the interview and starts an empty one. */
  restartInterview(courseId: string, caseId: string, witnessId: string, as: InterviewAs): Promise<Interview>
}
