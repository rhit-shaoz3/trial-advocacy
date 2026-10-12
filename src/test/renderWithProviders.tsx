import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { vi } from 'vitest'
import { AuthContext } from '../auth/AuthContext'
import type { User } from '../auth/types'
import { CasesApiContext } from '../cases/CasesApiContext'
import type { CasesApi } from '../cases/types'
import { ClassesApiContext } from '../classes/ClassesApiContext'
import type { ClassesApi } from '../classes/types'
import { fakeCasesApi } from './fakeCasesApi'
import { fakeClassesApi } from './fakeClassesApi'
import { NavigatedTo } from './NavigatedTo'

export const testInstructor: User = {
  id: 'inst-1',
  name: 'Dr. Ivy Brooks',
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
  classesApi?: ClassesApi
  casesApi?: CasesApi
  /** Starting URL, and the route pattern the element is mounted at. */
  url?: string
  path?: string
}

/**
 * Renders `ui` inside a router with fake APIs. Any page navigated to that isn't
 * `path` renders "Navigated to <url>", so tests can check where a button went.
 */
export function renderWithProviders(ui: ReactNode, options: Options = {}) {
  const {
    user: loggedIn = testInstructor,
    classesApi = fakeClassesApi(),
    casesApi = fakeCasesApi(),
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
      <ClassesApiContext.Provider value={classesApi}>
        <CasesApiContext.Provider value={casesApi}>
          <MemoryRouter initialEntries={[url]}>
            <Routes>
              <Route path={path} element={ui} />
              <Route path="*" element={<NavigatedTo />} />
            </Routes>
          </MemoryRouter>
        </CasesApiContext.Provider>
      </ClassesApiContext.Provider>
    </AuthContext.Provider>,
  )
  return { user, classesApi, casesApi, auth }
}
