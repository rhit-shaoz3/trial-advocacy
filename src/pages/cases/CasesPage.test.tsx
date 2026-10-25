import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CourseServiceContext } from '../../courses/CourseServiceContext'
import type { CourseCase, CourseService } from '../../courses/types'
import { fakeCourseService } from '../../test/fakeCourseService'
import { CaseDetailPage } from './CaseDetailPage'
import { CasesPage } from './CasesPage'
import { NewCasePage } from './setup/NewCasePage'

const coaster: CourseCase = {
  id: 'k1',
  title: 'Rivera v. Thrill Park',
  summary: 'A rollercoaster stalls mid-loop.',
  status: 'draft',
  phase: 'introduction',
  instructorNote: '',
  inWorldDate: null,
  disputedIssues: '',
  importantFacts: { plaintiff: ['The lap bar light was red.'], defense: ['The ride passed inspection.'] },
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
          <Route path="courses/:courseId/cases/new" element={<NewCasePage />} />
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

  it('starts a new case with the guided setup', async () => {
    const { user } = renderAt('/courses/c1/cases')

    await user.click(await screen.findByRole('button', { name: 'New case' }))

    expect(await screen.findByRole('form', { name: 'Case details' })).toBeInTheDocument()
    expect(screen.getByLabelText('Case name')).toHaveFocus()
  })

  it('marks cases whose setup is unfinished', async () => {
    renderAt('/courses/c1/cases', { listCases: vi.fn().mockResolvedValue([{ ...coaster, setupCompletedAt: null }]) })

    expect(await screen.findByRole('link', { name: /Rivera v. Thrill Park/ })).toHaveTextContent('Setup unfinished')
  })
})

describe('CaseDetailPage', () => {
  it('switches between the setup tabs, keeping the tab in the URL', async () => {
    const { user, service } = renderAt('/courses/c1/cases/k1?tab=materials', {
      getCase: vi.fn().mockResolvedValue(coaster),
    })

    expect(await screen.findByRole('tab', { name: 'Case file' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('region', { name: 'Case file' })).toBeInTheDocument()
    expect(service.listMaterials).toHaveBeenCalledWith('c1', 'k1')

    await user.click(screen.getByRole('tab', { name: 'Witnesses' }))
    expect(await screen.findByRole('region', { name: 'Witnesses' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Teams & worlds' }))
    expect(await screen.findByRole('region', { name: 'Teams' })).toBeInTheDocument()
  })

  it('shows the launch checklist only while the case is a draft', async () => {
    const { service } = renderAt('/courses/c1/cases/k1', { getCase: vi.fn().mockResolvedValue(coaster) })
    expect(await screen.findByRole('region', { name: 'Launch case worlds' })).toBeInTheDocument()
    expect(service.getLaunchChecks).toHaveBeenCalledWith('c1', 'k1')
  })

  it('saves the note to students along with the case details', async () => {
    const saved = { ...coaster, instructorNote: 'Mind the timeline.' }
    const { user, service } = renderAt('/courses/c1/cases/k1', {
      getCase: vi.fn().mockResolvedValue(coaster),
      updateCase: vi.fn().mockResolvedValue(coaster),
      saveInstructorNote: vi.fn().mockResolvedValue(saved),
    })

    await user.click(await screen.findByRole('button', { name: 'Edit case' }))
    await user.type(screen.getByLabelText(/Note to students/), 'Mind the timeline.')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(service.saveInstructorNote).toHaveBeenCalledWith('c1', 'k1', 'Mind the timeline.')
    expect(await screen.findByText('Mind the timeline.')).toBeInTheDocument()
  })

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
    expect(screen.getByLabelText('Plaintiff fact 1')).toHaveValue('The lap bar light was red.')
    await user.click(screen.getByRole('button', { name: 'Add defense fact' }))
    await user.keyboard('Riders were told to stay seated.')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(updateCase).toHaveBeenCalledWith('c1', 'k1', {
      title: 'Rivera v. Thrill Park LLC',
      summary: 'A rollercoaster stalls mid-loop.',
      status: 'active',
      importantFacts: {
        plaintiff: ['The lap bar light was red.'],
        defense: ['The ride passed inspection.', 'Riders were told to stay seated.'],
      },
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
