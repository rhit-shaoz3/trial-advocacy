import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ClassesApi, StudentInbox } from '../classes/types'
import { fakeClassesApi } from '../test/fakeClassesApi'
import { renderWithProviders, testStudent } from '../test/renderWithProviders'
import { StudentClassesPage } from './StudentClassesPage'

const emptyInbox: StudentInbox = { invitations: [], pendingRequests: [], denials: [] }

async function renderDashboard(api: ClassesApi) {
  const { user } = renderWithProviders(<StudentClassesPage />, {
    classesApi: api,
    user: testStudent,
    url: '/classes',
    path: '/classes',
  })
  await screen.findByRole('heading', { name: 'Classes' })
  return { user, api }
}

describe('student classes page', () => {
  it('lists enrolled classes and ones waiting for approval', async () => {
    await renderDashboard(
      fakeClassesApi({
        listStudentClasses: vi
          .fn()
          .mockResolvedValue([{ id: 'c-1', name: 'Evidence', instructors: ['Ivy'] }]),
        getInbox: vi.fn().mockResolvedValue({
          ...emptyInbox,
          pendingRequests: [{ classId: 'c-2', className: 'Torts' }],
        }),
      }),
    )

    expect(await screen.findByText('Evidence')).toBeInTheDocument()
    expect(screen.getByText(/Instructor: Ivy/)).toBeInTheDocument()
    expect(screen.getByText('Torts').closest('li')).toHaveTextContent(
      'Waiting for instructor approval',
    )
  })

  it('accepts an invitation and refreshes', async () => {
    const api = fakeClassesApi({
      getInbox: vi.fn().mockResolvedValue({
        ...emptyInbox,
        invitations: [{ id: 'inv-1', className: 'Evidence' }],
      }),
    })
    const { user } = await renderDashboard(api)

    expect(await screen.findByText(/You've been invited to join/)).toHaveTextContent(
      "You've been invited to join Evidence.",
    )
    await user.click(screen.getByRole('button', { name: 'Accept' }))

    expect(api.acceptInvitation).toHaveBeenCalledWith('inv-1')
    expect(api.listStudentClasses).toHaveBeenCalledTimes(2)
  })

  it('rejects an invitation', async () => {
    const api = fakeClassesApi({
      getInbox: vi.fn().mockResolvedValue({
        ...emptyInbox,
        invitations: [{ id: 'inv-1', className: 'Evidence' }],
      }),
    })
    const { user } = await renderDashboard(api)
    await user.click(await screen.findByRole('button', { name: 'Reject' }))

    expect(api.rejectInvitation).toHaveBeenCalledWith('inv-1')
  })

  it('shows a denial until it is dismissed', async () => {
    const api = fakeClassesApi({
      getInbox: vi.fn().mockResolvedValue({
        ...emptyInbox,
        denials: [{ classId: 'c-9', className: 'Torts' }],
      }),
    })
    const { user } = await renderDashboard(api)

    expect(await screen.findByText(/was denied/)).toHaveTextContent(
      'Your request to join Torts was denied by the instructor.',
    )
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(api.dismissDenial).toHaveBeenCalledWith('c-9')
  })
})

describe('add class dialog', () => {
  it('shows the error for an unknown code', async () => {
    const message = "Sorry, we can't find a class associated with this code."
    const api = fakeClassesApi({ joinClass: vi.fn().mockRejectedValue(new Error(message)) })
    const { user } = await renderDashboard(api)

    await user.click(screen.getByRole('button', { name: 'Add class' }))
    expect(screen.getByRole('dialog', { name: 'Enter code' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Class code'), 'NOPE999')
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    expect(api.joinClass).toHaveBeenCalledWith('NOPE999')
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })

  it('confirms the request was sent, then closes', async () => {
    const api = fakeClassesApi({
      joinClass: vi.fn().mockResolvedValue({ status: 'requested', className: 'Evidence' }),
    })
    const { user } = await renderDashboard(api)

    await user.click(screen.getByRole('button', { name: 'Add class' }))
    await user.type(screen.getByLabelText('Class code'), 'EVID517')
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    expect(await screen.findByText(/Request sent to/)).toHaveTextContent('Request sent to Evidence')
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
