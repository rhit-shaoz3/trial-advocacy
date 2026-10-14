import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { trialAd } from '../test/courseFixtures'
import { fakeCasesApi } from '../test/fakeCasesApi'
import { fakeCourseService } from '../test/fakeCourseService'
import { renderWithProviders } from '../test/renderWithProviders'
import { AllCasesPage } from './AllCasesPage'

const at = { url: '/cases', path: '/cases' }

describe('all cases page', () => {
  it('creates a case in a chosen course and opens it', async () => {
    const casesApi = fakeCasesApi({ createCase: vi.fn().mockResolvedValue({ id: 'case-9' }) })
    const { user } = renderWithProviders(<AllCasesPage />, {
      casesApi,
      courseService: fakeCourseService({ listTaughtCourses: vi.fn().mockResolvedValue([trialAd]) }),
      ...at,
    })
    const newCase = await screen.findByRole('button', { name: 'New case' })
    await vi.waitFor(() => expect(newCase).toBeEnabled())

    await user.click(newCase)
    await user.type(screen.getByLabelText('Case name'), 'Smith v. Jones')
    await user.selectOptions(screen.getByLabelText('Course'), 'LAW 540: Trial Advocacy (Fall 2026)')
    await user.click(screen.getByRole('button', { name: 'Create case' }))

    expect(casesApi.createCase).toHaveBeenCalledWith('c1', 'Smith v. Jones')
    expect(await screen.findByText('Navigated to /courses/c1/cases/case-9')).toBeInTheDocument()
  })

  it('lists cases across courses with their publish status', async () => {
    renderWithProviders(<AllCasesPage />, {
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
      ...at,
    })

    expect(await screen.findByRole('link', { name: /Smith v. Jones/ })).toHaveAttribute('href', '/courses/c1/cases/k1')
    expect(screen.getByText('Files published')).toBeInTheDocument()
    expect(screen.getByText('Teams draft')).toBeInTheDocument()
  })

  it('asks for a course first when there are none', async () => {
    renderWithProviders(<AllCasesPage />, at)

    expect(await screen.findByText(/Create a course first, then add cases to it/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New case' })).toBeDisabled()
  })
})
