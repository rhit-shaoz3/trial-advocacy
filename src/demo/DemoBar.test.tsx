import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '../auth/AuthContext'
import type { User } from '../auth/types'
import { DemoBar } from './DemoBar'

const instructor: User = {
  id: 'u1',
  name: 'Demo Instructor',
  email: 'demo@demo.com',
  role: 'instructor',
  theme: 'navy',
  avatarUrl: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  demo: { as: 'instructor', courseId: 'c1', caseId: 'k1' },
}

function Where() {
  return <p data-testid="path">{useLocation().pathname}</p>
}

function renderBar(user: User, overrides: Partial<AuthContextValue> = {}) {
  const auth = {
    user,
    loading: false,
    signUp: vi.fn(),
    logIn: vi.fn(),
    logOut: vi.fn(),
    updateProfile: vi.fn(),
    uploadAvatar: vi.fn(),
    removeAvatar: vi.fn(),
    markTourSeen: vi.fn(),
    switchDemo: vi.fn(),
    resetDemo: vi.fn(),
    ...overrides,
  }
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={['/courses/c1/review']}>
        <DemoBar />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
  return { auth, events: userEvent.setup() }
}

afterEach(() => {
  vi.restoreAllMocks()
  document.documentElement.style.fontSize = ''
})

describe('DemoBar', () => {
  it('switches to the student and opens the demo case', async () => {
    const switchDemo = vi.fn().mockResolvedValue({ ...instructor, role: 'student', demo: { ...instructor.demo, as: 'student' } })
    const { events } = renderBar(instructor, { switchDemo })
    expect(screen.getByRole('button', { name: 'Instructor' })).toHaveAttribute('aria-pressed', 'true')

    await events.click(screen.getByRole('button', { name: 'Student' }))
    expect(switchDemo).toHaveBeenCalledWith('student')
    expect(screen.getByTestId('path')).toHaveTextContent('/courses/c1/cases/k1')
  })

  it('resets the demo after asking, and loads its new case afresh', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    const resetDemo = vi.fn().mockResolvedValue({ ...instructor, demo: { ...instructor.demo, caseId: 'k2' } })
    const { events } = renderBar(instructor, { resetDemo })
    await events.click(screen.getByRole('button', { name: 'Reset demo' }))
    expect(resetDemo).toHaveBeenCalled()
    expect(assign).toHaveBeenCalledWith('/courses/c1/cases/k2')
    vi.unstubAllGlobals()
  })

  it('makes the app bigger for a projector', async () => {
    const { events } = renderBar(instructor)
    expect(document.documentElement.style.fontSize).toBe('125%')
    await events.selectOptions(screen.getByLabelText('Size'), '150')
    expect(document.documentElement.style.fontSize).toBe('150%')
  })

  it("isn't there outside a demo session", () => {
    renderBar({ ...instructor, demo: null })
    expect(screen.queryByRole('region', { name: 'Demo' })).not.toBeInTheDocument()
    expect(document.documentElement.style.fontSize).toBe('')
  })
})
