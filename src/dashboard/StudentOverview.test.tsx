import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { fakeCasesApi } from '../test/fakeCasesApi'
import { fakeCourseService } from '../test/fakeCourseService'
import { renderWithProviders, testStudent } from '../test/renderWithProviders'
import { StudentOverview } from './StudentOverview'

describe('student overview', () => {
  it('greets the student, links to released cases and shows invitations', async () => {
    renderWithProviders(<StudentOverview />, {
      user: testStudent,
      casesApi: fakeCasesApi({
        listAllCases: vi.fn().mockResolvedValue([
          {
            id: 'k1',
            name: 'Smith v. Jones',
            courseId: 'c1',
            courseName: 'LAW 540: Trial Advocacy',
            published: { documents: true, characters: false, teams: false },
          },
        ]),
      }),
      courseService: fakeCourseService({
        getInbox: vi.fn().mockResolvedValue({
          invitations: [{ courseId: 'c2', courseName: 'LAW 520: Evidence' }],
          pendingRequests: [],
          denials: [],
        }),
      }),
    })

    expect(await screen.findByRole('heading', { name: 'Welcome, Maya.' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /Smith v. Jones/ })).toHaveAttribute(
      'href',
      '/courses/c1/cases/k1',
    )
    expect(await screen.findByText(/You've been invited to join/)).toHaveTextContent('LAW 520: Evidence')
  })

  it('says when nothing has been released yet', async () => {
    renderWithProviders(<StudentOverview />, { user: testStudent })

    expect(await screen.findByText('Nothing assigned yet.')).toBeInTheDocument()
  })
})
