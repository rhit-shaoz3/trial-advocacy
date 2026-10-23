import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import type { AuthService, User } from '../auth/types'
import { applyPalette, chooseMode, currentPalette, visitMode } from './theme'
import { ThemeToggle } from './ThemeToggle'

/** Stands in for the computer's light/dark setting; `set` changes it like the OS would. */
function systemSetting(dark: boolean) {
  const listeners = new Set<() => void>()
  const query = {
    get matches() {
      return dark
    },
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  }
  vi.stubGlobal('matchMedia', () => query)
  return {
    set(next: boolean) {
      dark = next
      listeners.forEach((l) => l())
    },
  }
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  document.documentElement.dataset.theme = 'light'
  delete document.documentElement.dataset.palette
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('light and dark mode', () => {
  it('switches for this visit only, kept in sessionStorage', async () => {
    systemSetting(false)
    const user = userEvent.setup()
    render(<ThemeToggle />)

    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(visitMode()).toBe('dark')
    expect(localStorage.getItem('theme')).toBeNull()
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toHaveTextContent('Light mode')
  })

  it("follows the computer's setting until the user toggles", async () => {
    const system = systemSetting(false)
    render(<ThemeToggle />)

    act(() => system.set(true))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument()

    // Once toggled this visit, the computer's changes no longer override it.
    act(() => chooseMode('light'))
    act(() => system.set(true))
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})

describe('colour themes', () => {
  it('applies a theme and remembers it on this device', () => {
    applyPalette('lagoon')
    expect(document.documentElement.dataset.palette).toBe('lagoon')
    expect(currentPalette()).toBe('lagoon')
    expect(localStorage.getItem('palette')).toBe('lagoon')
  })

  it("shows the signed-in user's theme", async () => {
    systemSetting(false)
    const ada: User = { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'student', theme: 'stone', avatarUrl: null, createdAt: '2026-09-01T00:00:00.000Z' }
    const service: AuthService = {
      getCurrentUser: vi.fn().mockResolvedValue(ada),
      signUp: vi.fn(),
      logIn: vi.fn(),
      logOut: vi.fn(),
      updateProfile: vi.fn(),
      uploadAvatar: vi.fn(),
      removeAvatar: vi.fn(),
    }
    render(
      <AuthProvider service={service}>
        <p>App</p>
      </AuthProvider>,
    )
    await screen.findByText('App')
    await vi.waitFor(() => expect(document.documentElement.dataset.palette).toBe('stone'))
  })
})
