import { screen, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { celebrate } from '../classes/celebrate'
import type { ClassesApi, InstructorClass } from '../classes/types'
import { fakeClassesApi } from '../test/fakeClassesApi'
import { renderWithProviders } from '../test/renderWithProviders'
import { ClassesPage } from './ClassesPage'

vi.mock('../classes/celebrate', () => ({ celebrate: vi.fn() }))

const evidence: InstructorClass = {
  id: 'class-1',
  name: 'Evidence',
  joinCode: 'EVID517',
  students: [{ id: 'u-1', name: 'Sam', email: 'sam@school.edu' }],
  invitations: [
    { id: 'i-1', email: 'ana@school.edu', name: 'Ana', hasAccount: true },
    { id: 'i-2', email: 'new@school.edu', name: null, hasAccount: false },
  ],
  pendingRequests: [
    { id: 'u-2', name: 'Bo', email: 'bo@school.edu' },
    { id: 'u-3', name: 'Cy', email: 'cy@school.edu' },
    { id: 'u-4', name: 'Di', email: 'di@school.edu' },
  ],
}

async function renderDashboard(api: ClassesApi, url = '/classes') {
  const { user } = renderWithProviders(<ClassesPage />, { classesApi: api, url, path: '/classes' })
  await screen.findByRole('heading', { name: 'Your classes' })
  return { user, api }
}

async function openForm(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: 'Create class' }))
  await user.type(screen.getByLabelText('Class name'), 'Evidence')
}

describe('creating a class', () => {
  it('sends the name and emails, then celebrates and shows the code', async () => {
    const api = fakeClassesApi({
      createClass: vi.fn().mockResolvedValue({
        class: { id: 'class-1', name: 'Evidence', joinCode: 'EVID517' },
        invited: 2,
        withAccounts: 1,
      }),
    })
    const { user } = await renderDashboard(api)
    await openForm(user)
    await user.type(screen.getByLabelText('Add students by email'), 'Sam@School.edu')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    // Typed but not added: still included on submit.
    await user.type(screen.getByLabelText('Add students by email'), 'ana@school.edu')
    await user.click(screen.getByRole('button', { name: 'Create class' }))

    expect(api.createClass).toHaveBeenCalledWith({
      name: 'Evidence',
      studentEmails: ['sam@school.edu', 'ana@school.edu'],
    })
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(
      "Evidence has been created. Here's the code for students to join:",
    )
    expect(status).toHaveTextContent('EVID517')
    expect(celebrate).toHaveBeenCalled()
    expect(api.listInstructorClasses).toHaveBeenCalledTimes(2) // initial load + refresh
  })

  it('shows the error from the server and keeps the form', async () => {
    const api = fakeClassesApi({
      createClass: vi.fn().mockRejectedValue(new Error('Something went wrong. Please try again.')),
    })
    const { user } = await renderDashboard(api)
    await openForm(user)
    await user.click(screen.getByRole('button', { name: 'Create class' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again.',
    )
    expect(screen.getByRole('button', { name: 'Create class' })).toBeEnabled()
  })

  it('refuses an invalid email without calling the server', async () => {
    const api = fakeClassesApi()
    const { user } = await renderDashboard(api)
    await openForm(user)
    await user.type(screen.getByLabelText('Add students by email'), 'not-an-email')
    await user.click(screen.getByRole('button', { name: 'Create class' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Not a valid email address: not-an-email')
    expect(api.createClass).not.toHaveBeenCalled()
  })

  it('adds the emails found in an uploaded CSV', async () => {
    const { user } = await renderDashboard(fakeClassesApi())
    await openForm(user)
    const csv = new File(['name,email\nSam,sam@school.edu\nAna,ana@school.edu'], 'roster.csv', {
      type: 'text/csv',
    })
    await user.upload(screen.getByLabelText(/upload a spreadsheet/), csv)

    expect(await screen.findByText('Added 2 emails from roster.csv.')).toBeInTheDocument()
    const chips = screen.getByRole('list', { name: 'Students to invite' })
    expect(within(chips).getByText('sam@school.edu')).toBeInTheDocument()
    expect(within(chips).getByText('ana@school.edu')).toBeInTheDocument()
  })
})

describe('a class card', () => {
  it('shows the code, roster and invitation status', async () => {
    await renderDashboard(fakeClassesApi({ listInstructorClasses: vi.fn().mockResolvedValue([evidence]) }))

    const card = await screen.findByRole('article', { name: 'Evidence' })
    expect(within(card).getByText('EVID517')).toBeInTheDocument()
    expect(within(card).getByText('Students (1)')).toBeInTheDocument()
    const invited = within(card).getByText('new@school.edu').closest('li')!
    expect(invited).toHaveTextContent('No account')
    expect(within(card).getByText('Ana').closest('li')).toHaveTextContent('Invited')
  })

  it('admits the selected students in one call', async () => {
    const api = fakeClassesApi({ listInstructorClasses: vi.fn().mockResolvedValue([evidence]) })
    const { user } = await renderDashboard(api)
    await screen.findByRole('article', { name: 'Evidence' })

    const admit = screen.getByRole('button', { name: 'Admit selected' })
    expect(admit).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: 'Select Bo' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select Di' }))
    await user.click(admit)

    expect(api.decideRequests).toHaveBeenCalledWith('class-1', ['u-2', 'u-4'], 'admit')
  })

  it('denies everyone with select all', async () => {
    const api = fakeClassesApi({ listInstructorClasses: vi.fn().mockResolvedValue([evidence]) })
    const { user } = await renderDashboard(api)
    await screen.findByRole('article', { name: 'Evidence' })

    await user.click(screen.getByRole('checkbox', { name: 'Select all' }))
    await user.click(screen.getByRole('button', { name: 'Deny selected' }))

    expect(api.decideRequests).toHaveBeenCalledWith('class-1', ['u-2', 'u-3', 'u-4'], 'deny')
  })
})

describe('classes page', () => {
  it('opens the create form straight away when linked with ?new=1', async () => {
    await renderDashboard(fakeClassesApi(), '/classes?new=1')

    expect(screen.getByRole('form', { name: 'New class' })).toBeInTheDocument()
  })
})
