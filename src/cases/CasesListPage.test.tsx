import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { fakeCasesApi } from '../test/fakeCasesApi'
import { renderWithProviders, testStudent } from '../test/renderWithProviders'
import { CasesListPage } from './CasesListPage'
import type { CaseListItem } from './types'

const smith: CaseListItem = {
  id: 'case-1',
  name: 'Smith v. Jones',
  courseId: 'course-1',
  courseName: 'LAW 540: Trial Advocacy',
  published: { documents: true, characters: false, teams: false },
}

const at = { url: '/courses/course-1/cases', path: '/courses/:courseId/cases' }

describe('cases list', () => {
  it('lets the instructor create a case and opens it', async () => {
    const casesApi = fakeCasesApi({ createCase: vi.fn().mockResolvedValue({ ...smith, id: 'case-9' }) })
    const { user } = renderWithProviders(<CasesListPage />, { casesApi, ...at })

    expect(await screen.findByText('No cases yet.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'New case' }))
    await user.type(screen.getByLabelText('Case name'), 'Smith v. Jones')
    await user.click(screen.getByRole('button', { name: 'Create case' }))

    expect(casesApi.createCase).toHaveBeenCalledWith('course-1', 'Smith v. Jones')
    expect(await screen.findByText('Navigated to /courses/course-1/cases/case-9')).toBeInTheDocument()
  })

  it('shows each case’s publish status to the instructor', async () => {
    renderWithProviders(<CasesListPage />, {
      casesApi: fakeCasesApi({ listCourseCases: vi.fn().mockResolvedValue([smith]) }),
      ...at,
    })

    expect(await screen.findByRole('link', { name: /Smith v. Jones/ })).toHaveAttribute(
      'href',
      '/courses/course-1/cases/case-1',
    )
    expect(screen.getByText('Files published')).toBeInTheDocument()
    expect(screen.getByText('Teams draft')).toBeInTheDocument()
  })

  it('shows students their released cases, without setup controls', async () => {
    renderWithProviders(<CasesListPage />, {
      user: testStudent,
      casesApi: fakeCasesApi({ listCourseCases: vi.fn().mockResolvedValue([smith]) }),
      ...at,
    })

    expect(await screen.findByRole('heading', { name: 'My cases' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /Smith v. Jones/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New case' })).not.toBeInTheDocument()
    expect(screen.queryByText('Files published')).not.toBeInTheDocument()
  })
})
