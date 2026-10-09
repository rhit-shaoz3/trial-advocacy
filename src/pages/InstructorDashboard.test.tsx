import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CourseServiceContext } from '../courses/CourseServiceContext'
import type { CourseService, TaughtCourse } from '../courses/types'
import { fakeCourseService } from '../test/fakeCourseService'
import { InstructorDashboard } from './InstructorDashboard'

const trial: TaughtCourse = {
  id: 'c1',
  code: 'LAW 540',
  title: 'Trial Advocacy',
  term: 'Fall 2026',
  instructorName: 'Prof. Ruiz',
  season: 'Fall',
  year: 2026,
  entryCode: 'K7PQ2M',
  studentCount: 1,
}

function CourseStub() {
  return <p>Course page for {useParams().courseId}</p>
}

function renderDashboard(service: CourseService) {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <CourseServiceContext.Provider value={service}>
        <Routes>
          <Route index element={<InstructorDashboard />} />
          <Route path="courses/:courseId" element={<CourseStub />} />
        </Routes>
      </CourseServiceContext.Provider>
    </MemoryRouter>,
  )
  return { user, service }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-09T12:00:00'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('InstructorDashboard', () => {
  it('lists taught courses as links to their pages, with student counts', async () => {
    const { user } = renderDashboard(
      fakeCourseService({
        listTaughtCourses: vi.fn().mockResolvedValue([trial, { ...trial, id: 'c2', studentCount: 3 }]),
      }),
    )

    expect(await screen.findByText('1 student')).toBeInTheDocument()
    expect(screen.getByText('3 students')).toBeInTheDocument()

    await user.click(screen.getAllByRole('link', { name: /LAW 540/ })[0])
    expect(screen.getByText('Course page for c1')).toBeInTheDocument()
  })

  it('explains what to do when there are no courses', async () => {
    renderDashboard(fakeCourseService())

    expect(await screen.findByText("You haven't created any courses yet.")).toBeInTheDocument()
  })

  it('creates a course, defaulting to the current term, and opens it', async () => {
    const { user, service } = renderDashboard(
      fakeCourseService({ createCourse: vi.fn().mockResolvedValue({ ...trial, id: 'new-1' }) }),
    )

    await user.click(screen.getByRole('button', { name: 'Create course' }))
    expect(screen.getByLabelText('Term')).toHaveValue('Fall')
    expect(screen.getByLabelText('Year')).toHaveValue(2026)

    await user.type(screen.getByLabelText('Course number'), 'LAW 540')
    await user.type(screen.getByLabelText('Course title'), 'Trial Advocacy')
    await user.selectOptions(screen.getByLabelText('Term'), 'Winter')
    await user.clear(screen.getByLabelText('Year'))
    await user.type(screen.getByLabelText('Year'), '2027')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(service.createCourse).toHaveBeenCalledWith({
      code: 'LAW 540',
      title: 'Trial Advocacy',
      season: 'Winter',
      year: 2027,
    })
    expect(await screen.findByText('Course page for new-1')).toBeInTheDocument()
  })

  it('shows the server error and keeps the form', async () => {
    const { user } = renderDashboard(
      fakeCourseService({ createCourse: vi.fn().mockRejectedValue(new Error('Enter a valid year.')) }),
    )

    await user.click(screen.getByRole('button', { name: 'Create course' }))
    await user.type(screen.getByLabelText('Course number'), 'LAW 540')
    await user.type(screen.getByLabelText('Course title'), 'Trial Advocacy')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid year.')
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled()
  })
})
