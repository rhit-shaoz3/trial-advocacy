import { vi } from 'vitest'
import type { CasesApi } from '../cases/types'

/** A CasesApi where lists are empty and everything else must be overridden to be used. */
export function fakeCasesApi(overrides: Partial<CasesApi> = {}): CasesApi {
  return {
    listInstructorCases: vi.fn().mockResolvedValue([]),
    listStudentCases: vi.fn().mockResolvedValue([]),
    createCase: vi.fn(),
    getInstructorCase: vi.fn(),
    getStudentCase: vi.fn(),
    setPublished: vi.fn(),
    uploadDocuments: vi.fn().mockResolvedValue([]),
    setDocumentSide: vi.fn(),
    deleteDocument: vi.fn().mockResolvedValue(undefined),
    createCharacter: vi.fn(),
    updateCharacter: vi.fn().mockResolvedValue(undefined),
    deleteCharacter: vi.fn().mockResolvedValue(undefined),
    setCharacterKnows: vi.fn().mockResolvedValue(undefined),
    saveTeams: vi.fn(),
    saveMatchups: vi.fn(),
    ...overrides,
  }
}
