import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderWithProviders, testInstructor, testStudent } from '../test/renderWithProviders'
import { AppShell } from './AppShell'

afterEach(() => {
  localStorage.clear()
  document.documentElement.dataset.theme = 'light'
})

describe('app shell', () => {
  it('shows the instructor navigation, the app name and who is logged in', () => {
    renderWithProviders(<AppShell />, { user: testInstructor })

    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Overview', 'Courses', 'Cases'])
    expect(screen.getByText('Getting to Trial')).toBeInTheDocument()
    expect(screen.getByText('Instructor workspace')).toBeInTheDocument()
    expect(screen.getByText('Ivy Brooks')).toBeInTheDocument()
  })

  it('shows the student navigation', () => {
    renderWithProviders(<AppShell />, { user: testStudent })

    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual([
      'Overview',
      'My courses',
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
