import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { fakeCasesApi } from '../test/fakeCasesApi'
import { fakeClassesApi } from '../test/fakeClassesApi'
import { renderWithProviders, testStudent } from '../test/renderWithProviders'
import { StudentOverview } from './StudentOverview'

describe('student overview', () => {
  it('greets the student and links to released cases', async () => {
    renderWithProviders(<StudentOverview />, {
      user: testStudent,
      casesApi: fakeCasesApi({
        listStudentCases: vi
          .fn()
          .mockResolvedValue([{ id: 'case-1', name: 'Smith v. Jones', className: 'Evidence' }]),
      }),
      classesApi: fakeClassesApi({
        getInbox: vi.fn().mockResolvedValue({
          invitations: [{ id: 'inv-1', className: 'Torts' }],
          pendingRequests: [],
          denials: [],
        }),
      }),
    })

    expect(await screen.findByRole('heading', { name: 'Welcome, Maya.' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /Smith v. Jones/ })).toHaveAttribute(
      'href',
      '/cases/case-1',
    )
    expect(await screen.findByText(/You've been invited to join/)).toHaveTextContent('Torts')
  })

  it('says when nothing has been released yet', async () => {
    renderWithProviders(<StudentOverview />, { user: testStudent })

    expect(await screen.findByText('Nothing assigned yet.')).toBeInTheDocument()
  })
})
