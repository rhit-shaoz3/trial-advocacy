import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderWithProviders, testInstructor, testStudent } from '../test/renderWithProviders'
import { AppShell } from './AppShell'

afterEach(() => {
  localStorage.clear()
  document.documentElement.dataset.theme = 'light'
})

describe('app shell', () => {
  it('shows the instructor navigation and who is logged in', () => {
    renderWithProviders(<AppShell />, { user: testInstructor })

    const nav = screen.getByRole('navigation')
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual([
      'Overview',
      'Classes',
      'Cases',
    ])
    expect(screen.getByText('Getting to Trial')).toBeInTheDocument()
    expect(screen.getByText('Instructor workspace')).toBeInTheDocument()
    expect(screen.getByText('Dr. Ivy Brooks')).toBeInTheDocument()
    expect(screen.getByText('IB')).toBeInTheDocument()
  })

  it('shows the student navigation', () => {
    renderWithProviders(<AppShell />, { user: testStudent })

    const nav = screen.getByRole('navigation')
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual([
      'Overview',
      'My classes',
      'My cases',
    ])
  })

  it('logs out', async () => {
    const { user, auth } = renderWithProviders(<AppShell />)
    await user.click(screen.getByRole('button', { name: 'Log out' }))

    expect(auth.logOut).toHaveBeenCalled()
  })

  it('switches between light and dark mode and remembers the choice', async () => {
    document.documentElement.dataset.theme = 'light'
    const { user } = renderWithProviders(<AppShell />)

    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('theme')).toBe('dark')

    await user.click(screen.getByRole('button', { name: 'Switch to light mode' }))
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('theme')).toBe('light')
  })
})
