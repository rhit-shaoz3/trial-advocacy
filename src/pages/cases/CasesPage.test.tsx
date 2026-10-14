import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CourseServiceContext } from '../../courses/CourseServiceContext'
import type { CourseCase, CourseService } from '../../courses/types'
import { fakeCourseService } from '../../test/fakeCourseService'
import { CaseDetailPage } from './CaseDetailPage'
import { CasesPage } from './CasesPage'

const coaster: CourseCase = {
  id: 'k1',
  title: 'Rivera v. Thrill Park',
  summary: 'A rollercoaster stalls mid-loop.',
  status: 'draft',
  createdAt: '2026-10-01T15:00:00.000Z',
  updatedAt: '2026-10-01T15:00:00.000Z',
}

function renderAt(path: string, overrides: Partial<CourseService> = {}) {
  const service = fakeCourseService(overrides)
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={[path]}>
      <CourseServiceContext.Provider value={service}>
        <Routes>
          <Route path="courses/:courseId/cases" element={<CasesPage />} />
          <Route path="courses/:courseId/cases/:caseId" element={<CaseDetailPage />} />
        </Routes>
      </CourseServiceContext.Provider>
    </MemoryRouter>,
  )
  return { user, service }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CasesPage', () => {
  it('lists the course cases with their status, linking to each', async () => {
    const { service } = renderAt('/courses/c1/cases', {
      listCases: vi.fn().mockResolvedValue([coaster, { ...coaster, id: 'k2', title: 'State v. Hale', status: 'active', summary: '' }]),
    })

    const link = await screen.findByRole('link', { name: /Rivera v. Thrill Park/ })
    expect(service.listCases).toHaveBeenCalledWith('c1')
    expect(link).toHaveAttribute('href', '/courses/c1/cases/k1')
    expect(link).toHaveTextContent('Draft')
    expect(link).toHaveTextContent('A rollercoaster stalls mid-loop.')
    expect(screen.getByRole('link', { name: /State v. Hale/ })).toHaveTextContent('Active')
  })

  it('says when there are no cases yet', async () => {
    renderAt('/courses/c1/cases')

    expect(await screen.findByText(/No cases yet/)).toBeInTheDocument()
  })

  it('creates a draft case and opens it', async () => {
    const createCase = vi.fn().mockResolvedValue(coaster)
    const { user } = renderAt('/courses/c1/cases', {
      createCase,
      getCase: vi.fn().mockResolvedValue(coaster),
    })

    await user.click(await screen.findByRole('button', { name: 'New case' }))
    const form = screen.getByRole('form', { name: 'New case' })
    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Case title'), 'Rivera v. Thrill Park')
    await user.type(screen.getByLabelText(/Summary/), 'A rollercoaster stalls mid-loop.')
    await user.click(screen.getByRole('button', { name: 'Create case' }))

    expect(createCase).toHaveBeenCalledWith('c1', {
      title: 'Rivera v. Thrill Park',
      summary: 'A rollercoaster stalls mid-loop.',
    })
    expect(await screen.findByRole('heading', { name: 'Rivera v. Thrill Park' })).toBeInTheDocument()
    expect(form).not.toBeInTheDocument()
  })

  it('shows server errors in the form', async () => {
    const { user } = renderAt('/courses/c1/cases', {
      createCase: vi.fn().mockRejectedValue(new Error('Case title is required.')),
    })

    await user.click(await screen.findByRole('button', { name: 'New case' }))
    await user.type(screen.getByLabelText('Case title'), ' ')
    await user.click(screen.getByRole('button', { name: 'Create case' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Case title is required.')
  })
})

describe('CaseDetailPage', () => {
  it('shows the case with a place for teams', async () => {
    const { service } = renderAt('/courses/c1/cases/k1', { getCase: vi.fn().mockResolvedValue(coaster) })

    expect(await screen.findByRole('heading', { name: 'Rivera v. Thrill Park' })).toBeInTheDocument()
    expect(service.getCase).toHaveBeenCalledWith('c1', 'k1')
    expect(screen.getByText('Draft')).toBeInTheDocument()
    expect(screen.getByText('A rollercoaster stalls mid-loop.')).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Teams' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Case worlds' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'All cases' })).toHaveAttribute('href', '/courses/c1/cases')
  })

  it('edits the title, summary, and status', async () => {
    const updateCase = vi.fn().mockResolvedValue({ ...coaster, title: 'Rivera v. Thrill Park LLC', status: 'active' })
    const { user } = renderAt('/courses/c1/cases/k1', {
      getCase: vi.fn().mockResolvedValue(coaster),
      updateCase,
    })

    await user.click(await screen.findByRole('button', { name: 'Edit case' }))
    const title = screen.getByLabelText('Case title')
    expect(title).toHaveValue('Rivera v. Thrill Park')
    await user.type(title, ' LLC')
    await user.selectOptions(screen.getByLabelText('Status'), 'Active')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(updateCase).toHaveBeenCalledWith('c1', 'k1', {
      title: 'Rivera v. Thrill Park LLC',
      summary: 'A rollercoaster stalls mid-loop.',
      status: 'active',
    })
    expect(await screen.findByRole('heading', { name: 'Rivera v. Thrill Park LLC' })).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('deletes the case after confirming and returns to all cases', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { user, service } = renderAt('/courses/c1/cases/k1', { getCase: vi.fn().mockResolvedValue(coaster) })

    await user.click(await screen.findByRole('button', { name: 'Edit case' }))
    await user.click(screen.getByRole('button', { name: 'Delete case' }))

    expect(service.deleteCase).toHaveBeenCalledWith('c1', 'k1')
    expect(await screen.findByRole('heading', { name: 'All cases' })).toBeInTheDocument()
  })

  it('does nothing if the delete is not confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user, service } = renderAt('/courses/c1/cases/k1', { getCase: vi.fn().mockResolvedValue(coaster) })

    await user.click(await screen.findByRole('button', { name: 'Edit case' }))
    await user.click(screen.getByRole('button', { name: 'Delete case' }))

    expect(service.deleteCase).not.toHaveBeenCalled()
  })

  it('shows a not-found page for a missing case', async () => {
    renderAt('/courses/c1/cases/nope', { getCase: vi.fn().mockRejectedValue(new Error('Case not found.')) })

    expect(await screen.findByRole('heading', { name: 'Not found' })).toBeInTheDocument()
  })
})
