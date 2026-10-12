import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { InstructorClass } from '../classes/types'
import { fakeCasesApi } from '../test/fakeCasesApi'
import { fakeClassesApi } from '../test/fakeClassesApi'
import { renderWithProviders } from '../test/renderWithProviders'
import { CasesPage } from './CasesPage'

const evidence: InstructorClass = {
  id: 'class-1',
  name: 'Evidence',
  joinCode: 'EVID517',
  students: [],
  invitations: [],
  pendingRequests: [],
}

describe('cases page', () => {
  it('creates a case for a class and opens it', async () => {
    const casesApi = fakeCasesApi({
      createCase: vi.fn().mockResolvedValue({ id: 'case-9', name: 'Smith v. Jones' }),
    })
    const { user } = renderWithProviders(<CasesPage />, {
      classesApi: fakeClassesApi({ listInstructorClasses: vi.fn().mockResolvedValue([evidence]) }),
      casesApi,
      url: '/cases',
      path: '/cases',
    })
    const newCase = await screen.findByRole('button', { name: 'New case' })
    await vi.waitFor(() => expect(newCase).toBeEnabled())

    await user.click(newCase)
    await user.type(screen.getByLabelText('Case name'), 'Smith v. Jones')
    await user.selectOptions(screen.getByLabelText('Class'), 'Evidence')
    await user.click(screen.getByRole('button', { name: 'Create case' }))

    expect(casesApi.createCase).toHaveBeenCalledWith({ name: 'Smith v. Jones', classId: 'class-1' })
    expect(await screen.findByText('Navigated to /cases/case-9')).toBeInTheDocument()
  })

  it('lists cases with their publish status', async () => {
    renderWithProviders(<CasesPage />, {
      casesApi: fakeCasesApi({
        listInstructorCases: vi.fn().mockResolvedValue([
          {
            id: 'case-1',
            name: 'Smith v. Jones',
            classId: 'class-1',
            className: 'Evidence',
            published: { documents: true, characters: false, teams: false },
          },
        ]),
      }),
      url: '/cases',
      path: '/cases',
    })

    const link = await screen.findByRole('link', { name: /Smith v. Jones/ })
    expect(link).toHaveAttribute('href', '/cases/case-1')
    expect(screen.getByText('Files published')).toBeInTheDocument()
    expect(screen.getByText('Teams draft')).toBeInTheDocument()
  })

  it('asks for a class first when there are none', async () => {
    renderWithProviders(<CasesPage />, { url: '/cases', path: '/cases' })

    expect(await screen.findByText(/Create a class first, then add cases to it/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New case' })).toBeDisabled()
  })
})
