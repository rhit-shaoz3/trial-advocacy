import { vi } from 'vitest'
import type { ClassesApi } from '../classes/types'

/** A ClassesApi where every call succeeds with empty data unless overridden. */
export function fakeClassesApi(overrides: Partial<ClassesApi> = {}): ClassesApi {
  return {
    listInstructorClasses: vi.fn().mockResolvedValue([]),
    createClass: vi.fn(),
    decideRequests: vi.fn().mockResolvedValue(undefined),
    listStudentClasses: vi.fn().mockResolvedValue([]),
    getInbox: vi.fn().mockResolvedValue({ invitations: [], pendingRequests: [], denials: [] }),
    joinClass: vi.fn(),
    acceptInvitation: vi.fn().mockResolvedValue(undefined),
    rejectInvitation: vi.fn().mockResolvedValue(undefined),
    dismissDenial: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}
