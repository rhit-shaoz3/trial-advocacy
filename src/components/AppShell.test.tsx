import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LayoutDashboard } from 'lucide-react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../auth/AuthContext'
import { testInstructor } from '../test/renderWithProviders'
import { AppShell } from './AppShell'

afterEach(() => {
  localStorage.clear()
  document.documentElement.dataset.theme = 'light'
})

function renderShell() {
  render(
    <AuthContext.Provider
      value={{ user: testInstructor, loading: false, signUp: vi.fn(), logIn: vi.fn(), logOut: vi.fn() }}
    >
      <MemoryRouter>
        <AppShell
          subtitle="Pretrial simulator"
          navLabel="Main"
          navHeading="Menu"
          nav={[{ to: '/', label: 'Courses', icon: LayoutDashboard, end: true }]}
        >
          <p>Page</p>
        </AppShell>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
  return userEvent.setup()
}

describe('app shell', () => {
  it('shows the app name', () => {
    renderShell()

    expect(screen.getByText('Getting to Trial')).toBeInTheDocument()
  })

  it('switches between light and dark mode and remembers the choice', async () => {
    document.documentElement.dataset.theme = 'light'
    const user = renderShell()

    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('theme')).toBe('dark')

    await user.click(screen.getByRole('button', { name: 'Switch to light mode' }))
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('theme')).toBe('light')
  })
})
