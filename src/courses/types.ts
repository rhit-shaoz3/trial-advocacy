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
 * instructor says so. Introduction: teams get the case and a welcome email,
 * and each student picks their initial disclosures. Information exchange: the
 * instructor's initial disclosures are shared, and teams send interrogatories
 * and requests for admission (only once it's set up). Investigate: the
 * background investigator opens (only cases with one). Deposition: every
 * witness is revealed to both sides.
 */
export const CASE_PHASES = ['introduction', 'information_exchange', 'investigate', 'deposition'] as const
export type CasePhase = (typeof CASE_PHASES)[number]

/**
 * A case's phases: no information exchange phase until it's set up, and no
 * investigate phase without a background investigator.
 */
export const casePhases = (investigatorEnabled = true, exchangeReady = false): CasePhase[] =>
  CASE_PHASES.filter(
    (p) => (p !== 'investigate' || investigatorEnabled) && (p !== 'information_exchange' || exchangeReady),
  )

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

/** The parties as the instructor named them; empty when they haven't been named. */
export interface CaseParties {
  plaintiff: string
  defendant: string
}

export interface CourseCase {
  id: string
  title: string
  summary: string
  parties?: CaseParties
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
  /** Whether the information exchange setup is finished (students see it, and the case has its phase). */
  exchangeReady?: boolean
  /** A copy whose guided setup is just its teams and worlds, until finished. */
  copySetup?: boolean
  /** The case it was copied from, and whose it was; null for a case made from scratch. */
  copiedFrom?: { title: string; owner: string | null } | null
  createdAt: string
  updatedAt: string
}

/** A case another instructor shared, waiting to be accepted or declined. */
export interface SharedCase {
  id: string
  caseTitle: string
  summary: string
  fromName: string | null
  fromEmail: string | null
  sharedAt: string
  includeTasks: boolean
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
  /** The parties' names; left out of an edit, they stay as they are. */
  plaintiffName?: string
  defendantName?: string
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
  parties?: CaseParties
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
  /** The one case world the file belongs to (a subpoena response), by number; null or missing for every world's. */
  worldNumber?: number | null
  /** Where it came from; missing means the instructor uploaded it. */
  source?: MaterialSource
}

/** Where a case file came from: the instructor's upload, or a subpoena response approved in one case world. */
export const MATERIAL_SOURCES = ['instructor', 'subpoena'] as const
export type MaterialSource = (typeof MATERIAL_SOURCES)[number]

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
  /** The other side's witness, shown because the instructor disclosed them; not to be interviewed yet. */
  disclosed?: boolean
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
  /** Case files the asker can show the witness during the interview. */
  exhibits?: { id: string; title: string }[]
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
  /** The investigator's report had no list of its new facts and files, so read it before finishing. */
  reviewBlockMissing?: boolean
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
  /** Case files the report unlocked for the team, attached to it. */
  unlocked: { id: string; title: string; filename: string; contentType: string; sizeBytes: number }[]
  seen: boolean
}

/** Why an exchange is struck out: it stated a denied fact, or its question built on one. */
export interface StrikeReason {
  kind: 'produced' | 'builtOn'
  fact: string
}

export interface ReviewTurn {
  position: number
  question: string
  objection: string | null
  answer: string
  askedBy: string | null
  /** all: the question and answer rest on a denied fact; question: only the question does. */
  struck?: 'all' | 'question' | null
  reasons?: StrikeReason[]
}

/** The conversation behind a review; `marked` is false for reviews from before exchanges were linked to facts. */
export interface ReviewTranscript {
  turns: ReviewTurn[]
  marked: boolean
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
    parties?: CaseParties
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
  /** Whether the information exchange is set up, so the team has its tab. */
  exchangeReady?: boolean
  /**
   * Soonest due first; completion is the team's. `auto` tasks come from the
   * information exchange (initial disclosures, responding to a set) and
   * complete themselves.
   */
  tasks: (CaseTask & { completedAt: string | null; completedBy: string | null; auto?: boolean })[]
  /** The instructor viewing it as a team would; nothing can be changed. */
  preview: boolean
}

// Information exchange --------------------------------------------------------

/** Interrogatories, or requests for admission (RFAs). */
export type ExchangeKind = 'interrogatories' | 'rfas'

/** One part of the exchange: whether it's included, each team's limit, and the days the other side has to respond. */
export interface PartSettings {
  enabled: boolean
  limit: number
  days: number
}

/** What a subpoena can ask for (the boxes on the federal form, AO 88B). */
export const SUBPOENA_TYPES = ['documents', 'esi', 'tangible_things', 'inspection'] as const
export type SubpoenaType = (typeof SUBPOENA_TYPES)[number]

/** Subpoenas' settings, plus the kinds of request the instructor allows. */
export interface SubpoenaSettings extends PartSettings {
  types: SubpoenaType[]
}

/** The firm a side's teams work for, and the senior partner who signs their welcome email. */
export interface Firm {
  firm: string
  partner: string
}

export interface ExchangeSettings {
  /** Null until the instructor finishes the setup; students see nothing until then. */
  setupCompletedAt: string | null
  disclosures: { enabled: boolean; materialIds: string[]; witnessIds: string[] }
  subpoenas: SubpoenaSettings
  interrogatories: PartSettings
  rfas: PartSettings
  firms: Record<Side, Firm>
}

export type ExchangeSettingsInput = Omit<ExchangeSettings, 'setupCompletedAt' | 'disclosures'> & {
  disclosures: { enabled: boolean }
}

/** The federal rules students are taught: 25 interrogatories (FRCP 33), 30 days to respond (FRCP 33 and 36). */
export const FEDERAL = { interrogatoryLimit: 25, responseDays: 30 }

/** A witness or one-side case file a side could disclose. */
export interface DisclosureOption {
  kind: 'witness' | 'material'
  id: string
  side: Side
  name: string
  detail: string
  avatarUrl: string | null
}

/** A disclosed witness or file, with the student's reason when it's their pick. */
export type DisclosureItem = Omit<DisclosureOption, 'side'> & { reason: string | null }

export interface DisclosureSubmission {
  submittedAt: string
  heldBackReason: string
  items: DisclosureItem[]
}

/** How a student's picks compare with the instructor's for their side. */
export interface DisclosureReview {
  matched: DisclosureItem[]
  extra: DisclosureItem[]
  missing: DisclosureItem[]
}

export interface DisclosurePick {
  kind: 'witness' | 'material'
  id: string
  reason: string
}

/** One question or request in a set, and the response once it's in. */
export interface ExchangeItem {
  position: number
  text: string
  /** How many it counts toward the limit: each lettered subpart of an interrogatory counts. */
  weight: number
  answer: string | null
  objection: boolean
  admission: 'agree' | 'disagree' | 'partial' | null
  agreePart: string | null
  disagreePart: string | null
}

export interface ExchangeRequest {
  id: string
  kind: ExchangeKind
  fromTeam: { id: string; number: number; side: Side }
  toTeam: { id: string; number: number; side: Side }
  worldNumber: number
  sentBy: string | null
  sentAt: string
  dueAt: string
  respondedAt: string | null
  respondedBy: string | null
  items: ExchangeItem[]
  /** The instructor's view only: each team's last AI check before sending the set, and before answering it. */
  check?: DiscoveryCheckRecord | null
  responseCheck?: DiscoveryCheckRecord | null
}

/** What the discovery mentor (Check with AI) said about a draft. */
export type CheckTag = 'LOOKS_GOOD' | 'SMALL_EDITS' | 'NEEDS_IMPROVEMENT'

/** A check, as the student sees it right after asking. */
export interface DiscoveryCheck {
  id: string
  tag: CheckTag
  /** The mentor's feedback, without its tag line. */
  feedback: string
}

/** A check as a draft keeps it: with the key of the draft it checked, to tell when it's been edited since. */
export type KeyedCheck = DiscoveryCheck & { key: string }

export type DraftKind = 'subpoena' | ExchangeKind

/** A subpoena as typed so far: any field may be blank. */
export interface SubpoenaDraftContent {
  recipient: string
  recipientDescription: string
  requestType: SubpoenaType | ''
  records: string
  justification: string
}

export type DraftContent = SubpoenaDraftContent | { items: string[] }

/** A new subpoena or set the team hasn't sent yet, shared by the team. */
export interface DiscoveryDraft {
  id: string
  kind: DraftKind
  content: DraftContent
  /** The last AI check of the draft. */
  lastCheck: KeyedCheck | null
  updatedAt: string
  /** Who saved it last. */
  updatedBy: string | null
}

/** The last check before a submission, for the instructor; `current` is false when it was edited after. */
export interface DiscoveryCheckRecord {
  tag: CheckTag
  feedback: string
  current: boolean
}

/** What to check: a subpoena, a set of interrogatories or RFAs, or the answers to one. */
export type CheckInput =
  | { kind: 'subpoena'; mode: 'draft'; draft: SubpoenaInput }
  | { kind: ExchangeKind; mode: 'draft'; draft: { items: string[] } }
  | { kind: ExchangeKind; mode: 'answer'; requestId: string; draft: { responses: ItemResponse[] } }

export interface ItemResponse {
  position: number
  answer: string
  objection: boolean
  admission: 'agree' | 'disagree' | 'partial' | null
  agreePart: string
  disagreePart: string
}

/** One part of the exchange as a team sees it. */
export interface StudentPart {
  limit: number
  days: number
  used: number
  remaining: number
  /** `seen`: whether this student has read the response (for answered sets the team sent). */
  requests: (ExchangeRequest & { seen: boolean; direction: 'sent' | 'received' })[]
  /** The team's unsent sets of this kind, newest first. */
  drafts: DiscoveryDraft[]
}

/** How the instructor answered a subpoena: sent the recipient's response, or denied it. */
export type SubpoenaOutcome = 'responded' | 'denied'

/** A case file produced in answer to a subpoena. */
export interface ProducedDocument {
  materialId: string
  title: string
}

/** A subpoena the team served, with the answer once it's in. */
export interface TeamSubpoena {
  id: string
  recipient: string
  /** Who the recipient is and how they connect to the case. */
  recipientDescription: string
  requestType: SubpoenaType
  records: string
  /** What the team would tell the judge on a motion to quash or modify; blank for older subpoenas. */
  justification?: string
  sentBy: string | null
  sentAt: string
  dueAt: string
  outcome: SubpoenaOutcome | null
  /** The response document, or the instructor's note on a denial. */
  response: string | null
  respondedAt: string | null
  documents: ProducedDocument[]
  /** Whether this student has read the answer. */
  seen: boolean
}

/** Notice of a subpoena the other team in the case world served (never what came back). */
export interface SubpoenaNotice {
  id: string
  teamNumber: number
  recipient: string
  requestType: SubpoenaType
  records: string
  sentAt: string
  /** Whether this student has seen the notice. */
  seen: boolean
}

/** A team's subpoenas: its limit, what it has left, the ones it served, and notice of the other team's. */
export interface StudentSubpoenas {
  /** What the team may ask for. */
  types: SubpoenaType[]
  limit: number
  days: number
  used: number
  remaining: number
  served: TeamSubpoena[]
  notices: SubpoenaNotice[]
  /** The team's unsent subpoenas, newest first. */
  drafts: DiscoveryDraft[]
}

/** Where the AI's draft of a subpoena's response stands. */
export type SubpoenaStatus = 'drafting' | 'open' | 'failed' | 'answered'

/** A subpoena as the instructor reviews it on the Review page. */
export interface CourseSubpoena extends Omit<TeamSubpoena, 'seen'> {
  caseId: string
  caseTitle: string
  parties: { plaintiff: string; defendant: string }
  /** The requesting side's firm, for the subpoena form. */
  firm: Firm
  worldNumber: number
  teamNumber: number
  side: Side
  team: string[]
  respondedBy: string | null
  status: SubpoenaStatus
  /** The AI's draft of the recipient's response. */
  draft: string | null
  /** Whether the AI thinks a court would likely quash or modify the subpoena. */
  flag: 'quash' | 'modify' | null
  /** Existing case files the draft produces; `producedToTeam` when one is an earlier subpoena response. */
  existing: (ProducedDocument & { producedToTeam: number | null })[]
  /** Another case world's response the draft adapts, to compare with. */
  basedOn: (ProducedDocument & { worldNumber: number }) | null
  /** Files the draft named that match no case file. */
  unknownTitles: string[]
  /** The instructor's notes for the latest draft. */
  instructions: string
  createNew: boolean
  error: string | null
  /** The team's last AI check before serving it; null when it wasn't checked. */
  check?: DiscoveryCheckRecord | null
}

/** What the student fills in to serve a subpoena. */
export interface SubpoenaInput {
  recipient: string
  recipientDescription: string
  requestType: SubpoenaType
  records: string
  /** What the team would tell the judge on a motion to quash or modify. */
  justification: string
}

/** A team's information exchange. */
export interface StudentExchange {
  phase: CasePhase
  /** Whether teams can send and respond (after the introduction phase). */
  requestsOpen: boolean
  side: Side
  teamNumber: number
  opponentNumber: number
  firm: Firm
  disclosures: {
    /** Whether the student can still submit (the introduction phase). */
    open: boolean
    options: DisclosureOption[]
    submission: DisclosureSubmission | null
    review: DisclosureReview | null
  } | null
  /** Optional for responses from before subpoenas; null when the case leaves them out. */
  subpoenas?: StudentSubpoenas | null
  interrogatories: StudentPart | null
  rfas: StudentPart | null
}

export interface ExchangeOverview {
  /** Students who have submitted initial disclosures, of the students in case worlds. */
  submissions: { submitted: number; total: number; byWorld: { number: number; submitted: number; total: number }[] }
  activity: {
    interrogatoriesSent: number
    rfasSent: number
    teams: number
    teamsSentInterrogatories: number
    teamsSentRfas: number
    waiting: number
    overdue: number
    subpoenasServed?: number
    subpoenasWaiting?: number
  }
  /** What moving to information exchange shares, by name. */
  disclosed: { materials: string[]; witnesses: string[] }
}

/** How many questions an interrogatory counts as: one, or one per lettered subpart like "(a)". */
export function questionWeight(text: string) {
  return Math.max(1, (text.match(/\([a-z]\)/gi) ?? []).length)
}

/** Everything the UI needs from the courses backend. See `httpCourseService`. */
/** A file's text version: `ready` with the text, or why there's none yet. */
export interface MaterialTextResult {
  status: 'pending' | 'ready' | 'none' | 'failed'
  text: string | null
}

/** What's on a course calendar: a task's due date, or an event. */
export type CalendarKind = 'task' | 'case' | 'personal' | 'team'

/** One thing on the calendar; matches `CalendarItem` in server/calendar/calendar.ts. */
export interface CalendarItem {
  id: string
  kind: CalendarKind
  title: string
  notes: string
  /** YYYY-MM-DD: the event's day, or the day a task is due. */
  date: string
  /** A task's exact due time. */
  dueAt: string | null
  caseId: string | null
  caseTitle: string | null
  /** A team event's team. */
  teamNumber: number | null
  /** A student's task: whether their team has done it. */
  done: boolean | null
  /** Whether this user made it (and so can change it). */
  mine: boolean
}

/** A new calendar event: a case date (instructor), a personal reminder, or one shared with the team. */
export interface CalendarEventInput {
  kind: 'case' | 'personal' | 'team'
  title: string
  notes: string
  date: string
  /** The case date's case, or the case whose team to share with. */
  caseId?: string | null
}

/** How teams have used the background investigator; matches server/courses/phaseOverview.ts. */
export interface InvestigatorOverview {
  /** Teams in a case world. */
  teams: number
  /** Teams that have sent him at least one assignment. */
  teamsUsed: number
  /** Assignments sent, whole class. */
  requests: number
  /** With him or the instructor, not back to the team yet. */
  waiting: number
}

/** How teams are deposing the other side's witnesses; matches server/courses/phaseOverview.ts. */
export interface DepositionOverview {
  teams: number
  /** Teams that have deposed at least one of the other side's witnesses. */
  teamsDeposed: number
  depositions: number
  questions: number
  /** Objections from the witnesses' lawyers. */
  objections: number
  /** Interview reviews still waiting for the instructor. */
  reviewsWaiting: number
}

/** A likely witness the AI read from the initial file; matches server/witness/suggest.ts. */
export interface WitnessSuggestion {
  name: string
  role: string
  description: string
  alignedSide: Side | null
}

/** Where the suggested witnesses stand; matches `SuggestionsState` in server/witness/suggestions.ts. */
/** Text the AI suggests for a case's own fields, from its initial file, for the instructor to keep or edit. */
export interface CaseSuggestions {
  disputedIssues: string
  investigatorNotes: string
  instructorNote: string
  tasks: { title: string; description: string }[]
}

/** Where the case's suggested text stands: still being made, ready, or none to offer. */
export type ContentSuggestions = { status: 'waiting' } | { status: 'ready'; suggestions: CaseSuggestions } | { status: 'none' }

export type WitnessSuggestions =
  | { status: 'waiting'; reason: 'no-file' | 'no-parties' | 'reading' | 'thinking' }
  | { status: 'ready'; suggestions: WitnessSuggestion[] }
  | { status: 'failed'; error: string }
  | { status: 'done' }

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
  /** Copies the case into a class the instructor teaches (this one when `targetCourseId` is the same). */
  duplicateCase(
    courseId: string,
    caseId: string,
    options: { targetCourseId: string; includeTasks: boolean; title: string },
  ): Promise<{ courseId: string; case: CourseCase }>
  /** Shares the case with another instructor by email; they accept or decline it. */
  shareCase(courseId: string, caseId: string, email: string, includeTasks: boolean): Promise<{ toName: string; toEmail: string }>
  /** Cases other instructors shared with this one, waiting to be accepted or declined. */
  listSharedCases(): Promise<SharedCase[]>
  /** Copies a shared case into one of the instructor's classes. */
  acceptSharedCase(shareId: string, courseId: string): Promise<{ courseId: string; case: CourseCase }>
  declineSharedCase(shareId: string): Promise<void>
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
  /** The AI's suggested witnesses from the initial file, offered once. */
  getWitnessSuggestions(courseId: string, caseId: string): Promise<WitnessSuggestions>
  /** The instructor added some suggestions or skipped them: don't offer them again. */
  finishWitnessSuggestions(courseId: string, caseId: string): Promise<void>
  /** Suggested text for the case's own fields, from its initial file. */
  getContentSuggestions(courseId: string, caseId: string): Promise<ContentSuggestions>
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

  // The course calendar: tasks on their due dates, and events.
  getCalendar(courseId: string): Promise<CalendarItem[]>
  /** Each of these returns the whole calendar again. */
  createCalendarEvent(courseId: string, input: CalendarEventInput): Promise<CalendarItem[]>
  updateCalendarEvent(courseId: string, eventId: string, input: Pick<CalendarEventInput, 'title' | 'notes' | 'date'>): Promise<CalendarItem[]>
  deleteCalendarEvent(courseId: string, eventId: string): Promise<CalendarItem[]>
  /** The student's dashboard for one launched case. */
  getMyCaseWorkspace(courseId: string, caseId: string): Promise<CaseWorkspace>
  /** Marks a task done (or not) for the student's whole team. */
  setTaskDone(courseId: string, caseId: string, taskId: string, done: boolean): Promise<CaseWorkspace>
  myMaterialDownloadUrl(courseId: string, caseId: string, materialId: string): string
  /** A case file's text version, for the viewer, if the student can see the file. */
  myMaterialText(courseId: string, caseId: string, materialId: string): Promise<MaterialTextResult>

  // Interviews with AI witnesses: the student's team's, or the instructor's test as one side.
  getInterview(courseId: string, caseId: string, witnessId: string, as: InterviewAs): Promise<Interview>
  /** Asks the next question, showing the witness `exhibitIds` (case files it already has) with it. */
  askWitness(courseId: string, caseId: string, witnessId: string, as: InterviewAs, question: string, exhibitIds?: string[]): Promise<Interview>
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
  // Information exchange: the instructor's setup and views.
  /** The settings (federal defaults until saved), and what each side could disclose. */
  getExchange(courseId: string, caseId: string): Promise<{ settings: ExchangeSettings; options: DisclosureOption[] }>
  saveExchangeSettings(courseId: string, caseId: string, input: ExchangeSettingsInput): Promise<ExchangeSettings>
  /** The instructor's initial disclosures: the answer key, shared once the case leaves the introduction phase. */
  saveDisclosures(courseId: string, caseId: string, ids: { materialIds: string[]; witnessIds: string[] }): Promise<ExchangeSettings>
  /** Finishes the setup: students see it, and the case gains its phase. */
  completeExchangeSetup(courseId: string, caseId: string): Promise<{ settings: ExchangeSettings; case: CourseCase }>
  getExchangeOverview(courseId: string, caseId: string): Promise<ExchangeOverview>
  /** The case dashboard's cards for the investigate and deposition phases. */
  getInvestigatorOverview(courseId: string, caseId: string): Promise<InvestigatorOverview>
  getDepositionOverview(courseId: string, caseId: string): Promise<DepositionOverview>
  /** Every set teams have sent each other, newest first: the instructor's read-only view. */
  listExchangeRequests(courseId: string, caseId: string): Promise<ExchangeRequest[]>
  // Information exchange: the student's team.
  /** Null when there's nothing for the team yet (not set up, or not in a case world). */
  getMyExchange(courseId: string, caseId: string): Promise<StudentExchange | null>
  /** The student's own initial disclosures, once. */
  submitDisclosures(courseId: string, caseId: string, picks: DisclosurePick[], heldBackReason: string): Promise<StudentExchange>
  /**
   * Sends a set to the other team, one question or request per item. `checkId`: the AI check before
   * it, if there was one; `draftId`: the draft it was written in, which sending deletes.
   */
  sendExchangeRequest(
    courseId: string,
    caseId: string,
    kind: ExchangeKind,
    items: string[],
    checkId?: string,
    draftId?: string,
  ): Promise<StudentExchange>
  respondToExchangeRequest(
    courseId: string,
    caseId: string,
    requestId: string,
    responses: ItemResponse[],
    checkId?: string,
  ): Promise<StudentExchange>
  /** Has the discovery mentor check a draft before it's sent. */
  checkDiscovery(courseId: string, caseId: string, input: CheckInput): Promise<DiscoveryCheck>
  /** Serves a subpoena on a person or organization. */
  serveSubpoena(courseId: string, caseId: string, subpoena: SubpoenaInput, checkId?: string, draftId?: string): Promise<StudentExchange>
  /** Saves a new draft. `lastCheck` is kept by its id and key. */
  createExchangeDraft(courseId: string, caseId: string, kind: DraftKind, content: DraftContent, lastCheck: KeyedCheck | null): Promise<DiscoveryDraft>
  /** Saves over a draft. `keepalive` lets the save finish as the page closes. */
  updateExchangeDraft(
    courseId: string,
    caseId: string,
    draftId: string,
    content: DraftContent,
    lastCheck: KeyedCheck | null,
    options?: { keepalive?: boolean },
  ): Promise<DiscoveryDraft>
  deleteExchangeDraft(courseId: string, caseId: string, draftId: string): Promise<void>
  /** Marks the responses to the team's sets, and the answers to its subpoenas, as read. */
  markExchangeSeen(courseId: string, caseId: string): Promise<void>
  // The instructor's review panel.
  /** Subpoenas waiting for the instructor's answer (soonest due first), or answered ones. */
  listSubpoenas(courseId: string, status: 'open' | 'completed'): Promise<CourseSubpoena[]>
  /** Sends the team the response (as drafted or edited); it and the files it produces are shared with the team. */
  approveSubpoena(courseId: string, subpoenaId: string, response: string): Promise<CourseSubpoena>
  /** Denies a subpoena, with an optional note for the team. */
  denySubpoena(courseId: string, subpoenaId: string, note: string): Promise<CourseSubpoena>
  /** Has the AI draft the response again (also retries a failed draft); `createNew` asks for a new file. */
  redraftSubpoena(courseId: string, subpoenaId: string, options: { instructions: string; createNew: boolean }): Promise<CourseSubpoena>
  listReviews(courseId: string, status: 'open' | 'completed'): Promise<InterviewReview[]>
  decideFact(courseId: string, reviewId: string, factId: string, decision: FactDecision): Promise<InterviewReview>
  /** Allows (or not) the team to have a case file the investigator found. */
  decideDocument(courseId: string, reviewId: string, materialId: string, decision: DocumentDecision): Promise<InterviewReview>
  completeReview(courseId: string, reviewId: string): Promise<InterviewReview>
  retryReview(courseId: string, reviewId: string): Promise<InterviewReview>
  getReviewTranscript(courseId: string, reviewId: string): Promise<ReviewTranscript>
  /** One of the student's team's completed reviews, with what rests on denied facts struck out. */
  getMyReviewTranscript(courseId: string, caseId: string, reviewId: string): Promise<ReviewTranscript>
}
