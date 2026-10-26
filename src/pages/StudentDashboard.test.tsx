import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { CourseServiceContext } from '../courses/CourseServiceContext'
import type { Course, CourseService } from '../courses/types'
import { fakeCourseService } from '../test/fakeCourseService'
import { StudentDashboard } from './StudentDashboard'

const trial: Course = {
  id: 'c1',
  code: 'LAW 540',
  title: 'Trial Advocacy',
  term: 'Fall 2026',
  instructorName: 'Prof. Ruiz',
}
const pretrial: Course = { ...trial, id: 'c2', code: 'LAW 612', title: 'Pretrial Litigation' }
const evidence: Course = {
  id: 'c3',
  code: 'LAW 520',
  title: 'Evidence',
  term: 'Spring 2026',
  instructorName: null,
}

function renderDashboard(service: CourseService) {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <CourseServiceContext.Provider value={service}>
        <StudentDashboard />
      </CourseServiceContext.Provider>
    </MemoryRouter>,
  )
  return { user, service }
}

describe('StudentDashboard', () => {
  it('groups courses by term in the order the server returns them', async () => {
    renderDashboard(
      fakeCourseService({ listMyCourses: vi.fn().mockResolvedValue([trial, pretrial, evidence]) }),
    )

    const terms = await screen.findAllByRole('region')
    expect(terms.map((t) => within(t).getByRole('heading').textContent)).toEqual([
      'Fall 2026',
      'Spring 2026',
    ])
    expect(within(terms[0]).getAllByRole('listitem')).toHaveLength(2)
    expect(within(terms[0]).getByText('Trial Advocacy')).toBeInTheDocument()
    expect(within(terms[0]).getAllByText('Prof. Ruiz')).toHaveLength(2)
    expect(within(terms[1]).getByText('LAW 520')).toBeInTheDocument()
    expect(within(terms[1]).getByRole('link', { name: /LAW 520/ })).toHaveAttribute('href', '/courses/c3')
  })

  it('explains what to do when there are no courses', async () => {
    renderDashboard(fakeCourseService())

    expect(await screen.findByText("You aren't enrolled in any courses yet.")).toBeInTheDocument()
  })

  it('shows an error if the courses cannot be loaded', async () => {
    renderDashboard(
      fakeCourseService({ listMyCourses: vi.fn().mockRejectedValue(new Error('Please log in.')) }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your courses.')
  })

  it('joins a course with an entry code and shows it', async () => {
    const listMyCourses = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([trial])
    const { user, service } = renderDashboard(
      fakeCourseService({ listMyCourses, joinCourse: vi.fn().mockResolvedValue(trial) }),
    )
    await screen.findByText("You aren't enrolled in any courses yet.")

    await user.click(screen.getByRole('button', { name: 'Enroll in course' }))
    await user.type(screen.getByLabelText('Course entry code'), 'trial1{Enter}')

    expect(service.joinCourse).toHaveBeenCalledWith('trial1')
    expect(await screen.findByText('Trial Advocacy')).toBeInTheDocument()
    expect(screen.queryByLabelText('Course entry code')).not.toBeInTheDocument()
  })

  it('keeps the form open and shows the error for a bad code', async () => {
    const { user } = renderDashboard(
      fakeCourseService({
        joinCourse: vi.fn().mockRejectedValue(new Error('No course matches that entry code.')),
      }),
    )

    await user.click(screen.getByRole('button', { name: 'Enroll in course' }))
    await user.type(screen.getByLabelText('Course entry code'), 'NOPE00')
    await user.click(screen.getByRole('button', { name: 'Join' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No course matches that entry code.')
    expect(screen.getByRole('button', { name: 'Join' })).toBeEnabled()
  })

  it('closes the form on cancel', async () => {
    const { user } = renderDashboard(fakeCourseService())

    await user.click(screen.getByRole('button', { name: 'Enroll in course' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByLabelText('Course entry code')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enroll in course' })).toBeInTheDocument()
  })
})
