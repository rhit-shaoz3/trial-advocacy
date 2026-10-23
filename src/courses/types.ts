import type { CourseHome } from '../workspace/types'

export interface Course {
  id: string
  code: string
  title: string
  /** e.g. "Fall 2026" */
  term: string
  instructorName: string | null
  /** The instructor's profile picture, or null for initials. */
  instructorAvatarUrl?: string | null
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
  /** Their profile picture, or null for initials. */
  avatarUrl?: string | null
}

export interface AddStudentsResult {
  added: string[]
  skipped: { email: string; reason: string }[]
  roster: RosterEntry[]
}

/**
 * Every case world in a case moves through these together, in order, when the
 * instructor says so. Subpoena: each side sees only its own witnesses.
 * Investigate: the background investigator opens (only cases with one have
 * this phase). Deposition: every witness is revealed to both sides.
 */
export const CASE_PHASES = ['subpoena', 'investigate', 'deposition'] as const
export type CasePhase = (typeof CASE_PHASES)[number]

/** A case's phases: without a background investigator there's no investigate phase. */
export const casePhases = (investigatorEnabled = true): CasePhase[] =>
  investigatorEnabled ? [...CASE_PHASES] : CASE_PHASES.filter((p) => p !== 'investigate')

/** What every case's background investigator is called until the instructor renames him. */
export const DEFAULT_INVESTIGATOR_NAME = 'John Hastings'
/** His portrait, the same in every case. */
export const INVESTIGATOR_AVATAR_URL = '/investigator.png'

/** The case's background investigator, the same for every team. */
export interface InvestigatorSettings {
  enabled: boolean
  name: string
  /** The instructor's extra instructions, added to his prompt. */
  instructions: string
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
  phase: CasePhase
  /** Shown on every student's case dashboard. */
  instructorNote: string
  /** "Today" inside the case for its AI witnesses (YYYY-MM-DD); null means the real date. */
  inWorldDate: string | null
  /** Issues the AI witnesses must leave disputed. */
  disputedIssues: string
  /** The AI witnesses never contradict these. */
  importantFacts: ImportantFacts
  /** The furthest step of the guided setup reached. */
  setupStep?: SetupStep
  /** When the instructor finished the guided setup; null while it's unfinished. */
  setupCompletedAt?: string | null
  /** The background investigator; cases without the field have one, as John Hastings. */
  investigator?: InvestigatorSettings
  createdAt: string
  updatedAt: string
}

/** The case's investigator settings (cases from before the field have him, as John Hastings). */
export const investigatorOf = (c: Pick<CourseCase, 'investigator'>): InvestigatorSettings =>
  c.investigator ?? { enabled: true, name: DEFAULT_INVESTIGATOR_NAME, instructions: '' }

/** The guided setup's steps, in order (matches SETUP_STEPS on the server). */
export const SETUP_STEPS = ['details', 'facts', 'files', 'teams', 'worlds', 'witnesses', 'investigator', 'tasks'] as const
export type SetupStep = (typeof SETUP_STEPS)[number]

export interface WitnessSettingsInput {
  inWorldDate: string | null
  disputedIssues: string
}

export interface CaseInput {
  title: string
  summary: string
  /** Defaults to draft when creating. */
  status?: CourseCaseStatus
  /** Launching needs at least one per side. Left out of an edit, they stay as they are. */
  importantFacts?: ImportantFacts
}

/** Students paired for one case: usually two, three for the odd one out. */
export interface Team {
  id: string
  /** The label, as in "Team 3". */
  number: number
  members: RosterEntry[]
}

/** Auto-pair makes teams of this many students, as the instructor chooses. */
export const MIN_AUTO_TEAM_SIZE = 2
export const MAX_AUTO_TEAM_SIZE = 6
/** The most a team can hold, leaving room to add a leftover student by hand. */
export const MAX_TEAM_SIZE = MAX_AUTO_TEAM_SIZE + 1

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
  /** The file every team starts from, shown on their Overview; always shared with everyone. */
  initial: boolean
  /** Case worlds and teams the file is shared with, on top of its audience. */
  shares?: MaterialShares
}

export interface MaterialShares {
  matchupIds: string[]
  teamIds: string[]
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
  /** Which of the WITNESS_AVATAR_PRESETS picture designs the witness uses, or null. */
  avatarPreset?: number | null
  /** The design or uploaded picture to show, or null for an icon. */
  avatarUrl?: string | null
}

/** How many witness picture designs there are, in public/witness-avatars/ (01.svg to 12.svg). */
export const WITNESS_AVATAR_PRESETS = 12

export const witnessAvatarPresetUrl = (preset: number) => `/witness-avatars/${String(preset).padStart(2, '0')}.svg`

export type WitnessInput = Omit<Witness, 'id' | 'avatarUrl'>

/** What students see of a witness (never its AI setup). */
export interface WorkspaceWitness {
  id: string
  name: string
  role: string
  description: string
  audience: Audience
  /** The side the witness testifies for, or null for neither. */
  side: Side | null
  /** An AI witness the team can interview. */
  canInterview: boolean
  /** The witness's picture, or null for an icon. */
  avatarUrl?: string | null
}

/** A team's (or the instructor's test) interview of an AI witness, before any deposition. */
export interface Interview {
  id: string
  side: Side
  witness: { id: string; name: string; role: string; avatarUrl?: string | null }
  turns: {
    position: number
    question: string
    /** The defending lawyer's objection, as "Name: text". */
    objection: string | null
    answer: string
    askedBy: string | null
    /** The asker's profile picture, or null for initials. */
    askedByAvatarUrl?: string | null
    createdAt: string
  }[]
  maxTurns: number
  /**
   * When a team's interview ends on its own (an hour after the first
   * question) and goes to the instructor for review. Null before the first
   * question, and for instructor tests.
   */
  endsAt: string | null
  canAsk: boolean
  /** Why questions can't be asked, when they can't. */
  notice: string | null
}

/**
 * The instructor's ruling on a fact a witness added: accept or deny, for the
 * team's case world only or for every world in the case.
 */
export type FactDecision = 'accept_world' | 'deny_world' | 'accept_case' | 'deny_case'
export const FACT_DECISIONS: FactDecision[] = ['accept_world', 'deny_world', 'accept_case', 'deny_case']

export type DocumentDecision = 'allow' | 'deny'

/**
 * A team's ended interview, sent to the instructor as the new facts the
 * witness added; or (kind 'investigation') a team's request to the background
 * investigator, with his report, its new facts, and the case files he'd unlock.
 */
export interface InterviewReview {
  id: string
  /** Leaving it out means an interview. */
  kind?: 'interview' | 'investigation'
  caseId: string
  caseTitle: string
  /** The witness interviewed; null for an investigation. */
  witness: { id: string; name: string; role: string; avatarUrl?: string | null } | null
  worldNumber: number
  teamNumber: number
  side: Side
  /** The team's members, by name. */
  team: string[]
  /**
   * Summarizing: the AI is still listing the new facts (or investigating).
   * Failed: try again. Finalizing: the AI is writing the team's clean report.
   */
  status: 'summarizing' | 'failed' | 'open' | 'finalizing' | 'completed'
  error: string | null
  createdAt: string
  completedAt: string | null
  facts: { id: string; text: string; decision: FactDecision | null }[]
  /** An investigation: what the team asked, and who sent it. */
  assignment?: string | null
  askedBy?: string | null
  /** An investigation: the investigator's report, and what the team got. */
  report?: string | null
  finalReport?: string | null
  /** Records the team asked for that need legal process. */
  recordsRequested?: string[]
  /** Case files the investigator would unlock for the team. */
  documents?: { materialId: string; title: string; decision: DocumentDecision | null }[]
}

/** A team's request to the background investigator, as the team sees it: never the draft or the rulings. */
export interface Investigation {
  id: string
  assignment: string
  askedBy: string | null
  sentAt: string
  /** Working: with the investigator or the instructor. */
  status: 'working' | 'completed'
  completedAt: string | null
  /** The report, once it's back. */
  report: string | null
  /** Case files the report unlocked for the team. */
  unlocked: { id: string; title: string }[]
  seen: boolean
}

export interface ReviewTurn {
  question: string
  objection: string | null
  answer: string
  askedBy: string | null
}

/** A completed review as the team sees it: only whether each fact stands. */
export interface ReviewResult {
  id: string
  witness: { id: string; name: string; avatarUrl?: string | null }
  completedAt: string
  accepted: string[]
  denied: string[]
  /** Whether this student has opened the results. */
  seen: boolean
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
  key: 'importantFacts' | 'paired' | 'matched' | 'caseFile'
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
    phase: CasePhase
    instructorNote: string
  }
  team: MyCase['team']
  world: MyCase['world']
  /** Which side's material is shown; null before the student's team is matched. */
  side: Side | null
  materials: CaseMaterial[]
  witnesses: WorkspaceWitness[]
  /** The case's background investigator, or null if it has none. */
  investigator?: { name: string; avatarUrl: string } | null
  /** Whether the background investigator is open yet (from the investigate phase on). */
  investigatorAvailable: boolean
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
  updateCase(courseId: string, caseId: string, input: CaseInput & { status: CourseCaseStatus }): Promise<CourseCase>
  deleteCase(courseId: string, caseId: string): Promise<void>
  /** The guided setup reached `step` (the furthest step reached is kept). */
  reachSetupStep(courseId: string, caseId: string, step: SetupStep): Promise<CourseCase>
  completeSetup(courseId: string, caseId: string): Promise<CourseCase>
  // Teams for one case. Every change resolves to the case's teams afterwards.
  listTeams(courseId: string, caseId: string): Promise<CaseTeams>
  createTeam(courseId: string, caseId: string, emails: string[]): Promise<CaseTeams>
  /** Pairs every unpaired student at random, avoiding past partners. */
  /** Puts the students not on a team into teams of `teamSize` (default 2); leftovers stay off a team. */
  autoPair(courseId: string, caseId: string, teamSize?: number): Promise<CaseTeams>
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
  /** Makes the file the one every team starts from (null clears it); resolves with the whole case file. */
  setInitialMaterial(courseId: string, caseId: string, materialId: string | null): Promise<CaseMaterial[]>
  /** Shares a file with particular case worlds and teams, on top of its audience. */
  setMaterialShares(courseId: string, caseId: string, materialId: string, shares: MaterialShares): Promise<CaseMaterial>
  materialDownloadUrl(courseId: string, caseId: string, materialId: string): string
  /** The file's transcription (what the AI witnesses read), as plain text. */
  materialTextUrl(courseId: string, caseId: string, materialId: string): string
  /** Starts transcribing the file again; resolves at once with it pending. */
  retryTranscription(courseId: string, caseId: string, materialId: string): Promise<CaseMaterial>
  listWitnesses(courseId: string, caseId: string): Promise<Witness[]>
  createWitness(courseId: string, caseId: string, input: WitnessInput): Promise<Witness>
  updateWitness(courseId: string, caseId: string, witnessId: string, input: WitnessInput): Promise<Witness>
  deleteWitness(courseId: string, caseId: string, witnessId: string): Promise<void>
  /** Gives the witness an uploaded (already cropped) picture in place of a design. */
  uploadWitnessAvatar(courseId: string, caseId: string, witnessId: string, image: Blob): Promise<Witness>
  removeWitnessAvatar(courseId: string, caseId: string, witnessId: string): Promise<Witness>
  /** Soonest due first. */
  listTasks(courseId: string, caseId: string): Promise<CaseTask[]>
  createTask(courseId: string, caseId: string, input: TaskInput): Promise<CaseTask>
  updateTask(courseId: string, caseId: string, taskId: string, input: TaskInput): Promise<CaseTask>
  deleteTask(courseId: string, caseId: string, taskId: string): Promise<void>
  saveInstructorNote(courseId: string, caseId: string, note: string): Promise<CourseCase>
  /** Moves every world in the case to `phase` (forward or back). */
  setCasePhase(courseId: string, caseId: string, phase: CasePhase): Promise<CourseCase>
  saveWitnessSettings(courseId: string, caseId: string, input: WitnessSettingsInput): Promise<CourseCase>
  saveInvestigator(courseId: string, caseId: string, input: InvestigatorSettings): Promise<CourseCase>
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
  /** Ends the team's interview and sends it to the instructor for review; opens a fresh one. */
  endInterview(
    courseId: string,
    caseId: string,
    witnessId: string,
  ): Promise<{ interview: Interview; sentForReview: boolean }>
  /** The team's completed reviews in a case. */
  listMyReviews(courseId: string, caseId: string): Promise<ReviewResult[]>
  markReviewsSeen(courseId: string, caseId: string): Promise<void>
  /** The student's team's requests to the background investigator, newest first. */
  listMyInvestigations(courseId: string, caseId: string): Promise<Investigation[]>
  /** Emails the investigator an assignment; returns the team's requests. */
  sendInvestigation(courseId: string, caseId: string, assignment: string): Promise<Investigation[]>
  markInvestigationsSeen(courseId: string, caseId: string): Promise<void>
  // The instructor's review panel.
  listReviews(courseId: string, status: 'open' | 'completed'): Promise<InterviewReview[]>
  decideFact(courseId: string, reviewId: string, factId: string, decision: FactDecision): Promise<InterviewReview>
  /** Allows (or not) the team to have a case file the investigator found. */
  decideDocument(courseId: string, reviewId: string, materialId: string, decision: DocumentDecision): Promise<InterviewReview>
  completeReview(courseId: string, reviewId: string): Promise<InterviewReview>
  retryReview(courseId: string, reviewId: string): Promise<InterviewReview>
  getReviewTranscript(courseId: string, reviewId: string): Promise<ReviewTurn[]>
}
