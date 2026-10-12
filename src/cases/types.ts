// Match the shapes returned by server/cases/cases.ts.
import type { Person } from '../classes/types'

export type Side = 'plaintiff' | 'defendant'
export type DocSide = Side | 'both'
export type CharacterRole = 'witness' | 'investigator'
export type Section = 'documents' | 'characters' | 'teams'

export interface CaseSummary {
  id: string
  name: string
  classId: string
  className: string
  published: Record<Section, boolean>
}

export interface StudentCaseSummary {
  id: string
  name: string
  className: string
}

export interface CaseDocument {
  id: string
  filename: string
  contentType: string
  sizeBytes: number
  side: DocSide
  uploadedAt: string
}

export interface Character {
  id: string
  name: string
  /** Job title, e.g. "Police Officer". */
  title: string
  role: CharacterRole
  side: DocSide
  documentIds: string[]
}

export interface CharacterInput {
  name: string
  title: string
  role: CharacterRole
  side: DocSide
}

export interface Team {
  id: string
  name: string
  side: Side
  members: Person[]
}

export interface Matchup {
  id: string
  plaintiffTeamId: string
  defendantTeamId: string
}

export interface InstructorCase extends CaseSummary {
  students: Person[]
  documents: CaseDocument[]
  characters: Character[]
  teams: Team[]
  matchups: Matchup[]
}

export interface StudentCase {
  id: string
  name: string
  className: string
  published: Record<Section, boolean>
  /** null until teams are published, or if the student isn't on a team. */
  team: {
    id: string
    name: string
    side: Side
    teammates: Person[]
    opponents: Team[]
  } | null
  /** null while that section is unpublished. */
  documents: CaseDocument[] | null
  characters: { id: string; name: string; title: string; role: CharacterRole }[] | null
}

export interface TeamInput {
  /** Present for teams that are already saved. */
  id?: string
  name: string
  side: Side
  studentIds: string[]
}

export interface MatchupInput {
  plaintiffTeamId: string
  defendantTeamId: string
}

/** Everything the case pages need from the API; tests swap in a fake. */
export interface CasesApi {
  listInstructorCases(): Promise<CaseSummary[]>
  listStudentCases(): Promise<StudentCaseSummary[]>
  createCase(input: { name: string; classId: string }): Promise<CaseSummary>
  getInstructorCase(caseId: string): Promise<InstructorCase>
  getStudentCase(caseId: string): Promise<StudentCase>
  setPublished(caseId: string, changes: Partial<Record<Section, boolean>>): Promise<InstructorCase>

  uploadDocuments(caseId: string, files: File[], side: DocSide): Promise<CaseDocument[]>
  setDocumentSide(caseId: string, documentId: string, side: DocSide): Promise<CaseDocument>
  deleteDocument(caseId: string, documentId: string): Promise<void>

  createCharacter(caseId: string, input: CharacterInput): Promise<Character>
  updateCharacter(caseId: string, characterId: string, input: CharacterInput): Promise<void>
  deleteCharacter(caseId: string, characterId: string): Promise<void>
  setCharacterKnows(
    caseId: string,
    characterId: string,
    documentId: string,
    knows: boolean,
  ): Promise<void>

  saveTeams(caseId: string, teams: TeamInput[]): Promise<InstructorCase>
  saveMatchups(caseId: string, matchups: MatchupInput[]): Promise<InstructorCase>
}
