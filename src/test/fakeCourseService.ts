import { vi } from 'vitest'
import type { CourseService } from '../courses/types'

/** A CourseService whose methods are all mocks; by default every list is empty. */
export function fakeCourseService(overrides: Partial<CourseService> = {}): CourseService {
  return {
    listMyCourses: vi.fn().mockResolvedValue([]),
    joinCourse: vi.fn(),
    getCourseHome: vi.fn(),
    listTaughtCourses: vi.fn().mockResolvedValue([]),
    createCourse: vi.fn(),
    getCourse: vi.fn(),
    updateCourse: vi.fn(),
    deleteCourse: vi.fn().mockResolvedValue(undefined),
    listRoster: vi.fn().mockResolvedValue([]),
    addStudents: vi.fn(),
    removeStudent: vi.fn().mockResolvedValue(undefined),
    listFactPatterns: vi.fn().mockResolvedValue([]),
    uploadFactPattern: vi.fn(),
    deleteFactPattern: vi.fn().mockResolvedValue(undefined),
    factPatternDownloadUrl: (courseId, id) => `/download/${courseId}/${id}`,
    listCases: vi.fn().mockResolvedValue([]),
    createCase: vi.fn(),
    getCase: vi.fn(),
    updateCase: vi.fn(),
    deleteCase: vi.fn().mockResolvedValue(undefined),
    listTeams: vi.fn().mockResolvedValue({ teams: [], unpaired: [] }),
    createTeam: vi.fn(),
    autoPair: vi.fn(),
    clearTeams: vi.fn(),
    deleteTeam: vi.fn(),
    addTeamMember: vi.fn(),
    removeTeamMember: vi.fn(),
    listMyCases: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}
