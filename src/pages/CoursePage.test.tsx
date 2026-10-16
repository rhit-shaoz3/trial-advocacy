import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CourseServiceContext } from '../courses/CourseServiceContext'
import type { CourseService, RosterEntry, TaughtCourse } from '../courses/types'
import { fakeCourseService } from '../test/fakeCourseService'
import { CoursePage } from './CoursePage'

const course: TaughtCourse = {
  id: 'c1',
  code: 'LAW 540',
  title: 'Trial Advocacy',
  term: 'Fall 2026',
  instructorName: 'Prof. Ruiz',
  season: 'Fall',
  year: 2026,
  entryCode: 'K7PQ2M',
  studentCount: 2,
}

const ada: RosterEntry = { email: 'ada@example.com', name: 'Ada Lawyer', joined: true }
const pending: RosterEntry = { email: 'new@example.com', name: null, joined: false }

function renderPage(overrides: Partial<CourseService> = {}) {
  const service = fakeCourseService({ getCourse: vi.fn().mockResolvedValue(course), ...overrides })
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={['/courses/c1']}>
      <CourseServiceContext.Provider value={service}>
        <Routes>
          <Route path="courses/:courseId" element={<CoursePage />} />
          <Route index element={<p>Dashboard</p>} />
        </Routes>
      </CourseServiceContext.Provider>
    </MemoryRouter>,
  )
  return { user, service }
}

const rosterSection = () => screen.getByRole('region', { name: /Students/ })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CoursePage header', () => {
  it('shows the course and its entry code, which can be copied', async () => {
    const { user, service } = renderPage()

    expect(await screen.findByRole('heading', { name: 'LAW 540: Trial Advocacy' })).toBeInTheDocument()
    expect(service.getCourse).toHaveBeenCalledWith('c1')
    expect(screen.getByText(/Fall 2026/)).toBeInTheDocument()
    expect(screen.getByText('K7PQ2M')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(await navigator.clipboard.readText()).toBe('K7PQ2M')
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('shows a not-found page for a course the instructor does not teach', async () => {
    renderPage({ getCourse: vi.fn().mockRejectedValue(new Error('Course not found.')) })

    expect(await screen.findByRole('heading', { name: 'Not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to your courses' })).toBeInTheDocument()
  })
})

describe('editing and deleting', () => {
  it('edits the course details, starting from the current values', async () => {
    const updateCourse = vi.fn().mockResolvedValue({
      ...course,
      code: 'LAW 541',
      title: 'Advanced Trial Advocacy',
      term: 'Winter 2027',
      season: 'Winter',
      year: 2027,
    })
    const { user } = renderPage({ updateCourse })

    await user.click(await screen.findByRole('button', { name: 'Edit course' }))
    expect(screen.getByLabelText('Course number')).toHaveValue('LAW 540')
    expect(screen.getByLabelText('Course title')).toHaveValue('Trial Advocacy')
    expect(screen.getByLabelText('Term')).toHaveValue('Fall')
    expect(screen.getByLabelText('Year')).toHaveValue(2026)

    await user.clear(screen.getByLabelText('Course number'))
    await user.type(screen.getByLabelText('Course number'), 'LAW 541')
    await user.clear(screen.getByLabelText('Course title'))
    await user.type(screen.getByLabelText('Course title'), 'Advanced Trial Advocacy')
    await user.selectOptions(screen.getByLabelText('Term'), 'Winter')
    await user.clear(screen.getByLabelText('Year'))
    await user.type(screen.getByLabelText('Year'), '2027')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(updateCourse).toHaveBeenCalledWith('c1', {
      code: 'LAW 541',
      title: 'Advanced Trial Advocacy',
      season: 'Winter',
      year: 2027,
    })
    expect(
      await screen.findByRole('heading', { name: 'LAW 541: Advanced Trial Advocacy' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Winter 2027/)).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Edit course' })).not.toBeInTheDocument()
  })

  it('keeps the form open with the error if saving fails, and cancel restores the header', async () => {
    const { user } = renderPage({
      updateCourse: vi.fn().mockRejectedValue(new Error('Course title is required.')),
    })

    await user.click(await screen.findByRole('button', { name: 'Edit course' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Course title is required.')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('heading', { name: 'LAW 540: Trial Advocacy' })).toBeInTheDocument()
  })

  it('deletes the course after confirming and goes back to the dashboard', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { user, service } = renderPage()

    await user.click(await screen.findByRole('button', { name: 'Edit course' }))
    await user.click(screen.getByRole('button', { name: 'Delete course' }))

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Delete LAW 540: Trial Advocacy?'))
    expect(service.deleteCourse).toHaveBeenCalledWith('c1')
    expect(await screen.findByText('Dashboard')).toBeInTheDocument()
  })

  it('does nothing if the instructor cancels the delete', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user, service } = renderPage()

    await user.click(await screen.findByRole('button', { name: 'Edit course' }))
    await user.click(screen.getByRole('button', { name: 'Delete course' }))

    expect(service.deleteCourse).not.toHaveBeenCalled()
    expect(screen.getByRole('form', { name: 'Edit course' })).toBeInTheDocument()
  })

  it('shows the error if deleting fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { user } = renderPage({
      deleteCourse: vi.fn().mockRejectedValue(new Error('Something went wrong. Please try again.')),
    })

    await user.click(await screen.findByRole('button', { name: 'Edit course' }))
    await user.click(screen.getByRole('button', { name: 'Delete course' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.')
    expect(screen.getByRole('button', { name: 'Delete course' })).toBeEnabled()
  })
})

describe('roster', () => {
  it('lists joined and pending students', async () => {
    renderPage({ listRoster: vi.fn().mockResolvedValue([ada, pending]) })

    expect(await screen.findByRole('heading', { name: 'Students (2)' })).toBeInTheDocument()
    const rows = within(rosterSection()).getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('Ada Lawyerada@example.comJoined')
    expect(rows[1]).toHaveTextContent('new@example.comPending sign-up')
  })

  it('adds pasted emails and reports what was skipped', async () => {
    const addStudents = vi.fn().mockResolvedValue({
      added: ['new@example.com'],
      skipped: [{ email: 'ada@example.com', reason: 'Already on the roster.' }],
      roster: [ada, pending],
    })
    const { user } = renderPage({ listRoster: vi.fn().mockResolvedValue([ada]), addStudents })
    await screen.findByRole('heading', { name: 'Students (1)' })

    await user.type(
      screen.getByLabelText('Add students by email'),
      'new@example.com, ada@example.com{Enter}',
    )
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(addStudents).toHaveBeenCalledWith('c1', ['new@example.com', 'ada@example.com'])
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Added 1 student. Skipped 1:')
    expect(status).toHaveTextContent('ada@example.com: Already on the roster.')
    expect(screen.getByRole('heading', { name: 'Students (2)' })).toBeInTheDocument()
    expect(screen.getByLabelText('Add students by email')).toHaveValue('')
  })

  it('removes a student after confirming', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { user, service } = renderPage({ listRoster: vi.fn().mockResolvedValue([ada, pending]) })

    await user.click(await screen.findByRole('button', { name: 'Remove ada@example.com' }))

    expect(window.confirm).toHaveBeenCalledWith('Remove Ada Lawyer (ada@example.com) from this course?')
    expect(service.removeStudent).toHaveBeenCalledWith('c1', 'ada@example.com')
    expect(await screen.findByRole('heading', { name: 'Students (1)' })).toBeInTheDocument()
  })

  it('keeps the student if the instructor cancels', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user, service } = renderPage({ listRoster: vi.fn().mockResolvedValue([ada]) })

    await user.click(await screen.findByRole('button', { name: 'Remove ada@example.com' }))

    expect(service.removeStudent).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Students (1)' })).toBeInTheDocument()
  })
})
