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
    ...overrides,
  }
}
