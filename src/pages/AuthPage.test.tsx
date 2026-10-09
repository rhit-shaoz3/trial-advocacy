import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import App from '../App'
import { AuthProvider } from '../auth/AuthProvider'
import type { AuthService, User } from '../auth/types'
import { CourseServiceContext } from '../courses/CourseServiceContext'
import { fakeCourseService } from '../test/fakeCourseService'

const ada: User = {
  id: 'user-1',
  name: 'Ada Lawyer',
  email: 'ada@example.com',
  role: 'student',
  createdAt: '2026-01-01T00:00:00.000Z',
}

function fakeService(overrides: Partial<AuthService> = {}): AuthService {
  return {
    getCurrentUser: vi.fn().mockResolvedValue(null),
    signUp: vi.fn(async ({ name, email, role }) => ({ ...ada, name, email, role })),
    logIn: vi.fn().mockResolvedValue(ada),
    logOut: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

async function renderApp(service = fakeService()) {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <CourseServiceContext.Provider value={fakeCourseService()}>
        <AuthProvider service={service}>
          <App />
        </AuthProvider>
      </CourseServiceContext.Provider>
    </MemoryRouter>,
  )
  // Wait for the initial "who is logged in?" check to finish.
  await screen.findByRole('heading', { level: 1 })
  return { user, service }
}

async function openSignUp(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: 'Sign up' }))
}

async function fillSignUp(
  user: ReturnType<typeof userEvent.setup>,
  { password = 'correct-horse', confirm = password }: { password?: string; confirm?: string } = {},
) {
  await user.type(screen.getByLabelText('Full name'), 'Ada Lawyer')
  await user.type(screen.getByLabelText('Email'), 'ada@example.com')
  await user.type(screen.getByLabelText('Password'), password)
  await user.type(screen.getByLabelText('Confirm password'), confirm)
}

describe('initial screen', () => {
  it('shows the login form when nobody is logged in', async () => {
    await renderApp()

    expect(screen.getByRole('tab', { name: 'Log in' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument()
  })

  it('goes straight to the home page when a session already exists', async () => {
    await renderApp(fakeService({ getCurrentUser: vi.fn().mockResolvedValue(ada) }))

    expect(screen.getByRole('heading', { name: 'Your courses' })).toBeInTheDocument()
  })

  it('falls back to the login form if the server cannot be reached', async () => {
    await renderApp(fakeService({ getCurrentUser: vi.fn().mockRejectedValue(new Error('down')) }))

    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument()
  })
})

describe('sign up', () => {
  it('shows the sign-up fields with Student selected by default', async () => {
    const { user } = await renderApp()
    await openSignUp(user)

    expect(screen.getByLabelText('Full name')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Student/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Instructor/ })).not.toBeChecked()
  })

  it('creates the account and shows the home page', async () => {
    const { user, service } = await renderApp()
    await openSignUp(user)
    await fillSignUp(user)
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(service.signUp).toHaveBeenCalledWith({
      name: 'Ada Lawyer',
      email: 'ada@example.com',
      password: 'correct-horse',
      role: 'student',
    })
    expect(await screen.findByRole('heading', { name: 'Your courses' })).toBeInTheDocument()
    expect(screen.getByText('Student', { selector: '.navbar-role' })).toBeInTheDocument()
  })

  it('sends the instructor role when Instructor is picked', async () => {
    const { user, service } = await renderApp()
    await openSignUp(user)
    await fillSignUp(user)
    await user.click(screen.getByRole('radio', { name: /Instructor/ }))
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(service.signUp).toHaveBeenCalledWith(expect.objectContaining({ role: 'instructor' }))
    expect(await screen.findByRole('button', { name: 'Create course' })).toBeInTheDocument()
    expect(screen.getByText('Instructor', { selector: '.navbar-role' })).toBeInTheDocument()
  })

  it('blocks mismatched passwords without calling the server', async () => {
    const { user, service } = await renderApp()
    await openSignUp(user)
    await fillSignUp(user, { password: 'correct-horse', confirm: 'correct-horsE' })
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match.')
    expect(service.signUp).not.toHaveBeenCalled()
  })

  it('blocks passwords shorter than 8 characters without calling the server', async () => {
    const { user, service } = await renderApp()
    await openSignUp(user)
    await fillSignUp(user, { password: 'short' })
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Password must be at least 8 characters.')
    expect(service.signUp).not.toHaveBeenCalled()
  })

  it('shows the server error, e.g. a taken email, and stays on the form', async () => {
    const service = fakeService({
      signUp: vi.fn().mockRejectedValue(new Error('An account with that email already exists.')),
    })
    const { user } = await renderApp(service)
    await openSignUp(user)
    await fillSignUp(user)
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An account with that email already exists.',
    )
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled()
  })

  it('disables the button while the request is in flight', async () => {
    let finish!: (u: User) => void
    const service = fakeService({
      signUp: vi.fn(() => new Promise<User>((resolve) => (finish = resolve))),
    })
    const { user } = await renderApp(service)
    await openSignUp(user)
    await fillSignUp(user)
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    const button = screen.getByRole('button', { name: 'Please wait…' })
    expect(button).toBeDisabled()
    await user.click(button)
    expect(service.signUp).toHaveBeenCalledTimes(1)

    finish(ada)
    expect(await screen.findByRole('heading', { name: 'Your courses' })).toBeInTheDocument()
  })
})

describe('log in', () => {
  it('logs in and shows the home page', async () => {
    const { user, service } = await renderApp()
    await user.type(screen.getByLabelText('Email'), 'ada@example.com')
    await user.type(screen.getByLabelText('Password'), 'correct-horse')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(service.logIn).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'correct-horse',
    })
    expect(await screen.findByRole('heading', { name: 'Your courses' })).toBeInTheDocument()
  })

  it('submits with the Enter key', async () => {
    const { user, service } = await renderApp()
    await user.type(screen.getByLabelText('Email'), 'ada@example.com')
    await user.type(screen.getByLabelText('Password'), 'correct-horse{Enter}')

    expect(service.logIn).toHaveBeenCalledTimes(1)
  })

  it('does not submit when fields are empty', async () => {
    const { user, service } = await renderApp()
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(service.logIn).not.toHaveBeenCalled()
  })

  it('shows the server error for bad credentials', async () => {
    const service = fakeService({
      logIn: vi.fn().mockRejectedValue(new Error('Incorrect email or password.')),
    })
    const { user } = await renderApp(service)
    await user.type(screen.getByLabelText('Email'), 'ada@example.com')
    await user.type(screen.getByLabelText('Password'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.')
    expect(screen.queryByRole('heading', { name: 'Your courses' })).not.toBeInTheDocument()
  })

  it('clears the error and password when switching tabs', async () => {
    const service = fakeService({
      logIn: vi.fn().mockRejectedValue(new Error('Incorrect email or password.')),
    })
    const { user } = await renderApp(service)
    await user.type(screen.getByLabelText('Email'), 'ada@example.com')
    await user.type(screen.getByLabelText('Password'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    await screen.findByRole('alert')

    await openSignUp(user)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toHaveValue('')
  })
})

describe('log out', () => {
  it('returns to the login form', async () => {
    const service = fakeService({ getCurrentUser: vi.fn().mockResolvedValue(ada) })
    const { user } = await renderApp(service)
    await user.click(screen.getByRole('button', { name: 'Log out' }))

    expect(service.logOut).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument()
  })
})
