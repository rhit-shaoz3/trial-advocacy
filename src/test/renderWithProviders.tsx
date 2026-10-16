import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { vi } from 'vitest'
import { AuthContext } from '../auth/AuthContext'
import type { User } from '../auth/types'
import { CourseServiceContext } from '../courses/CourseServiceContext'
import type { CourseService } from '../courses/types'
import { fakeCourseService } from './fakeCourseService'
import { NavigatedTo } from './NavigatedTo'

export const testInstructor: User = {
  id: 'inst-1',
  name: 'Ivy Brooks',
  email: 'ivy@school.edu',
  role: 'instructor',
  createdAt: '2026-01-01T00:00:00.000Z',
}

export const testStudent: User = {
  id: 'stu-1',
  name: 'Maya Chen',
  email: 'maya@school.edu',
  role: 'student',
  createdAt: '2026-01-01T00:00:00.000Z',
}

interface Options {
  /** The logged-in user; defaults to an instructor. */
  user?: User
  courseService?: CourseService
  /** Starting URL, and the route pattern the element is mounted at. */
  url?: string
  path?: string
}

/**
 * Renders a page inside a router with a fake course service. Any page navigated
 * to that isn't `path` renders "Navigated to <url>", so tests can check where a
 * button went.
 */
export function renderWithProviders(ui: ReactNode, options: Options = {}) {
  const {
    user: loggedIn = testInstructor,
    courseService = fakeCourseService(),
    url = '/',
    path = '/',
  } = options
  const auth = {
    user: loggedIn,
    loading: false,
    signUp: vi.fn(),
    logIn: vi.fn(),
    logOut: vi.fn().mockResolvedValue(undefined),
  }
  const user = userEvent.setup()
  render(
    <AuthContext.Provider value={auth}>
      <CourseServiceContext.Provider value={courseService}>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path={path} element={ui} />
            <Route path="*" element={<NavigatedTo />} />
          </Routes>
        </MemoryRouter>
      </CourseServiceContext.Provider>
    </AuthContext.Provider>,
  )
  return { user, courseService, auth }
}
