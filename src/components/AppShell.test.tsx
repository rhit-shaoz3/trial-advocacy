import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BriefcaseBusiness, CalendarDays, LayoutDashboard } from 'lucide-react'
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '../auth/AuthContext'
import type { User } from '../auth/types'
import { AppShell, type ShellNavItem } from './AppShell'

vi.mock('../tour/TourButton', () => ({ TourButton: () => null }))

const nav: ShellNavItem[] = [
  { to: '/courses/c1', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/courses/c1/cases', label: 'Cases', icon: BriefcaseBusiness },
  { to: '/courses/c1/calendar', label: 'Calendar', icon: CalendarDays },
]

function Where() {
  const { pathname, search } = useLocation()
  return <output aria-label="Address">{pathname + search}</output>
}

function renderShell(user: Pick<User, 'id' | 'name' | 'role'>, at = '/courses/c1/cases') {
  const auth = { user: { avatarUrl: null, ...user } as User, logOut: vi.fn() } as unknown as AuthContextValue
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[at]}>
        <Routes>
          <Route
            path="*"
            element={
              <AppShell subtitle="Course" navLabel="Course" navHeading="Workspace" nav={nav}>
                <Where />
                <Link to="/courses/c1/cases/k1?tab=final-steps">Open the case</Link>
              </AppShell>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

const ada = { id: 'u1', name: 'Ada Lawyer', role: 'student' as const }
const address = () => screen.getByRole('status', { name: 'Address' }).textContent

afterEach(() => sessionStorage.clear())

describe('AppShell’s section links', () => {
  it('go back to where the user left a section', async () => {
    const user = userEvent.setup()
    renderShell(ada)
    await user.click(screen.getByRole('link', { name: 'Open the case' }))
    await user.click(screen.getByRole('link', { name: 'Calendar' }))
    expect(address()).toBe('/courses/c1/calendar')

    expect(screen.getByRole('link', { name: 'Cases' })).toHaveAttribute('href', '/courses/c1/cases/k1?tab=final-steps')
    await user.click(screen.getByRole('link', { name: 'Cases' }))
    expect(address()).toBe('/courses/c1/cases/k1?tab=final-steps')
  })

  it('go to the section’s start from inside it', async () => {
    const user = userEvent.setup()
    renderShell(ada)
    await user.click(screen.getByRole('link', { name: 'Open the case' }))
    expect(screen.getByRole('link', { name: 'Cases' })).toHaveAttribute('href', '/courses/c1/cases')
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/courses/c1')
  })

  it('remember each user’s places on their own', async () => {
    const user = userEvent.setup()
    const { unmount } = renderShell(ada)
    await user.click(screen.getByRole('link', { name: 'Open the case' }))
    unmount()

    renderShell({ id: 'u2', name: 'Cy Counsel', role: 'student' }, '/courses/c1/calendar')
    expect(screen.getByRole('link', { name: 'Cases' })).toHaveAttribute('href', '/courses/c1/cases')
  })
})
