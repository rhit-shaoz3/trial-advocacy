import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CourseService, StudentInbox } from '../courses/types'
import { fakeCourseService } from '../test/fakeCourseService'
import { renderWithProviders, testStudent } from '../test/renderWithProviders'
import { StudentCoursesPage } from './StudentCoursesPage'

const emptyInbox: StudentInbox = { invitations: [], pendingRequests: [], denials: [] }
const evidence = { courseId: 'c1', courseName: 'LAW 520: Evidence' }

async function renderPage(service: CourseService) {
  const { user } = renderWithProviders(<StudentCoursesPage />, {
    courseService: service,
    user: testStudent,
    url: '/courses',
    path: '/courses',
  })
  await screen.findByRole('heading', { name: 'Courses' })
  return { user, service }
}

describe('student courses page', () => {
  it('lists joined courses and ones waiting for approval', async () => {
    await renderPage(
      fakeCourseService({
        listMyCourses: vi.fn().mockResolvedValue([
          { id: 'c2', code: 'LAW 540', title: 'Trial Advocacy', term: 'Fall 2026', instructorName: 'Ivy Brooks' },
        ]),
        getInbox: vi.fn().mockResolvedValue({ ...emptyInbox, pendingRequests: [evidence] }),
      }),
    )

    expect(await screen.findByRole('link', { name: /LAW 540: Trial Advocacy/ })).toHaveAttribute('href', '/courses/c2')
    expect(screen.getByText('LAW 520: Evidence').closest('li')).toHaveTextContent(
      'Waiting for instructor approval',
    )
  })

  it('accepts an invitation and refreshes', async () => {
    const service = fakeCourseService({
      getInbox: vi.fn().mockResolvedValue({ ...emptyInbox, invitations: [evidence] }),
    })
    const { user } = await renderPage(service)

    expect(await screen.findByText(/You've been invited to join/)).toHaveTextContent(
      "You've been invited to join LAW 520: Evidence.",
    )
    await user.click(screen.getByRole('button', { name: 'Accept' }))

    expect(service.answerInvitation).toHaveBeenCalledWith('c1', true)
    expect(service.listMyCourses).toHaveBeenCalledTimes(2)
  })

  it('rejects an invitation', async () => {
    const service = fakeCourseService({
      getInbox: vi.fn().mockResolvedValue({ ...emptyInbox, invitations: [evidence] }),
    })
    const { user } = await renderPage(service)
    await user.click(await screen.findByRole('button', { name: 'Reject' }))

    expect(service.answerInvitation).toHaveBeenCalledWith('c1', false)
  })

  it('shows a denial until it is dismissed', async () => {
    const service = fakeCourseService({
      getInbox: vi.fn().mockResolvedValue({ ...emptyInbox, denials: [evidence] }),
    })
    const { user } = await renderPage(service)

    expect(await screen.findByText(/was denied/)).toHaveTextContent(
      'Your request to join LAW 520: Evidence was denied by the instructor.',
    )
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(service.dismissDenial).toHaveBeenCalledWith('c1')
  })
})

describe('add course dialog', () => {
  it('shows the error for an unknown code', async () => {
    const message = "Sorry, we can't find a course with that code."
    const service = fakeCourseService({ joinCourse: vi.fn().mockRejectedValue(new Error(message)) })
    const { user } = await renderPage(service)

    await user.click(screen.getByRole('button', { name: 'Add course' }))
    expect(screen.getByRole('dialog', { name: 'Enter code' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Course code'), 'NOPE00')
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    expect(service.joinCourse).toHaveBeenCalledWith('NOPE00')
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })

  it('confirms the request was sent, then closes', async () => {
    const service = fakeCourseService({
      joinCourse: vi.fn().mockResolvedValue({
        course: { id: 'c1', code: 'LAW 520', title: 'Evidence', term: 'Fall 2026', instructorName: null },
        status: 'requested',
      }),
    })
    const { user } = await renderPage(service)

    await user.click(screen.getByRole('button', { name: 'Add course' }))
    await user.type(screen.getByLabelText('Course code'), 'K7PQ2M')
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    expect(await screen.findByText(/Request sent to/)).toHaveTextContent('Request sent to LAW 520: Evidence')
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
