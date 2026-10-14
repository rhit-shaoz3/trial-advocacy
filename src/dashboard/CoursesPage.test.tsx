import { screen, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { celebrate } from '../courses/celebrate'
import type { CourseService } from '../courses/types'
import { roster, trialAd } from '../test/courseFixtures'
import { fakeCourseService } from '../test/fakeCourseService'
import { renderWithProviders } from '../test/renderWithProviders'
import { CoursesPage } from './CoursesPage'

// The confetti needs a real <canvas>, which the test browser doesn't have.
vi.mock('../courses/celebrate', () => ({ celebrate: vi.fn() }))

async function renderPage(service: CourseService, url = '/courses') {
  const { user } = renderWithProviders(<CoursesPage />, { courseService: service, url, path: '/courses' })
  await screen.findByRole('heading', { name: 'Your courses' })
  return { user, service }
}

async function openForm(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: 'Create course' }))
  await user.type(screen.getByLabelText('Course number'), 'LAW 540')
  await user.type(screen.getByLabelText('Course title'), 'Trial Advocacy')
}

describe('creating a course', () => {
  it('creates it, invites the emails, then celebrates and shows the entry code', async () => {
    const service = fakeCourseService({
      createCourse: vi.fn().mockResolvedValue(trialAd),
      addStudents: vi.fn().mockResolvedValue({ added: ['sam@school.edu', 'ana@school.edu'], skipped: [], roster: [] }),
    })
    const { user } = await renderPage(service)
    await openForm(user)
    await user.selectOptions(screen.getByLabelText('Term'), 'Fall')
    await user.clear(screen.getByLabelText('Year'))
    await user.type(screen.getByLabelText('Year'), '2026')
    await user.type(screen.getByLabelText('Invite students by email'), 'Sam@School.edu')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    // Typed but not added: still included on submit.
    await user.type(screen.getByLabelText('Invite students by email'), 'ana@school.edu')
    await user.click(screen.getByRole('button', { name: 'Create course' }))

    expect(service.createCourse).toHaveBeenCalledWith({
      code: 'LAW 540',
      title: 'Trial Advocacy',
      season: 'Fall',
      year: 2026,
    })
    expect(service.addStudents).toHaveBeenCalledWith('c1', ['sam@school.edu', 'ana@school.edu'])
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(
      "LAW 540: Trial Advocacy has been created. Here's the code for students to join:",
    )
    expect(status).toHaveTextContent('K7PQ2M')
    expect(status).toHaveTextContent('Invited 2 students.')
    expect(celebrate).toHaveBeenCalled()
  })

  it('shows the error from the server and keeps the form', async () => {
    const service = fakeCourseService({ createCourse: vi.fn().mockRejectedValue(new Error('Enter a valid year.')) })
    const { user } = await renderPage(service)
    await openForm(user)
    await user.click(screen.getByRole('button', { name: 'Create course' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid year.')
    expect(screen.getByRole('button', { name: 'Create course' })).toBeEnabled()
  })

  it('refuses an invalid email without calling the server', async () => {
    const service = fakeCourseService()
    const { user } = await renderPage(service)
    await openForm(user)
    await user.type(screen.getByLabelText('Invite students by email'), 'not-an-email')
    await user.click(screen.getByRole('button', { name: 'Create course' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Not a valid email address: not-an-email')
    expect(service.createCourse).not.toHaveBeenCalled()
  })

  it('adds the emails found in an uploaded CSV', async () => {
    const { user } = await renderPage(fakeCourseService())
    await openForm(user)
    const csv = new File(['name,email\nSam,sam@school.edu\nAna,ana@school.edu'], 'roster.csv', { type: 'text/csv' })
    await user.upload(screen.getByLabelText(/upload a spreadsheet/), csv)

    expect(await screen.findByText('Added 2 emails from roster.csv.')).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Students to invite' })
    expect(within(list).getByText('sam@school.edu')).toBeInTheDocument()
  })

  it('opens the form straight away when linked with ?new=1', async () => {
    await renderPage(fakeCourseService(), '/courses?new=1')

    expect(screen.getByRole('form', { name: 'New course' })).toBeInTheDocument()
  })
})

describe('a course card', () => {
  const withCourse = (overrides: Partial<CourseService> = {}) =>
    fakeCourseService({
      listTaughtCourses: vi.fn().mockResolvedValue([trialAd]),
      listRoster: vi.fn().mockResolvedValue(roster),
      ...overrides,
    })

  it('shows the entry code, the roster and who is invited', async () => {
    await renderPage(withCourse())

    const card = await screen.findByRole('article', { name: 'LAW 540: Trial Advocacy' })
    expect(within(card).getByText('K7PQ2M')).toBeInTheDocument()
    expect(await within(card).findByText('Students (1)')).toBeInTheDocument()
    expect(within(card).getByText('Ana').closest('li')).toHaveTextContent('Invited')
    expect(within(card).getByText('new@school.edu').closest('li')).toHaveTextContent('No account')
    expect(within(card).getByRole('link', { name: 'Manage course' })).toHaveAttribute('href', '/courses/c1/manage')
  })

  it('admits the selected students in one call', async () => {
    const service = withCourse()
    const { user } = await renderPage(service)

    const admit = await screen.findByRole('button', { name: 'Admit selected' })
    expect(admit).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: 'Select Bo' }))
    await user.click(admit)

    expect(service.decideRequests).toHaveBeenCalledWith('c1', ['u-2'], 'admit')
  })

  it('denies everyone with select all', async () => {
    const service = withCourse()
    const { user } = await renderPage(service)

    await user.click(await screen.findByRole('checkbox', { name: 'Select all' }))
    await user.click(screen.getByRole('button', { name: 'Deny selected' }))

    expect(service.decideRequests).toHaveBeenCalledWith('c1', ['u-2', 'u-3'], 'deny')
  })
})
