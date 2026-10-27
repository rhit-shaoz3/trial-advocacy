import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CourseServiceContext } from '../../../courses/CourseServiceContext'
import type { CaseWorkspace, CourseCase, CourseService, SetupStep } from '../../../courses/types'
import { fakeCourseService } from '../../../test/fakeCourseService'
import { CaseDetailPage } from '../CaseDetailPage'
import { NewCasePage } from './NewCasePage'

// Confetti draws on a canvas, which jsdom doesn't have.
vi.mock('canvas-confetti', () => ({ default: Object.assign(vi.fn(), { reset: vi.fn() }) }))

const draft: CourseCase = {
  id: 'k1',
  title: 'Rivera v. Thrill Park',
  summary: 'A rollercoaster stalls mid-loop.',
  status: 'draft',
  phase: 'introduction',
  instructorNote: '',
  inWorldDate: null,
  disputedIssues: '',
  importantFacts: { plaintiff: [], defense: [] },
  setupStep: 'details',
  setupCompletedAt: null,
  createdAt: '2026-10-01T15:00:00.000Z',
  updatedAt: '2026-10-01T15:00:00.000Z',
}

/** A service whose setup calls behave like the server's: the furthest step is kept. */
function setupService(overrides: Partial<CourseService> = {}) {
  let current = { ...draft }
  const keep = (c: CourseCase) => (current = c)
  return fakeCourseService({
    createCase: vi.fn(async (_course, input) => keep({ ...current, title: input.title, summary: input.summary })),
    getCase: vi.fn(async () => current),
    updateCase: vi.fn(async (_course, _id, input) =>
      keep({ ...current, ...input, importantFacts: input.importantFacts ?? current.importantFacts }),
    ),
    reachSetupStep: vi.fn(async (_course, _id, step: SetupStep) => keep({ ...current, setupStep: step })),
    completeSetup: vi.fn(async () => keep({ ...current, setupCompletedAt: '2026-10-02T15:00:00.000Z' })),
    previewWorkspace: vi.fn(() => new Promise<CaseWorkspace>(() => {})),
    ...overrides,
  })
}

function renderAt(path: string, service: CourseService) {
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={[path]}>
      <CourseServiceContext.Provider value={service}>
        <Routes>
          <Route path="courses/:courseId/cases/new" element={<NewCasePage />} />
          <Route path="courses/:courseId/cases/:caseId" element={<CaseDetailPage />} />
        </Routes>
      </CourseServiceContext.Provider>
    </MemoryRouter>,
  )
  return user
}

const stepButtons = () =>
  within(screen.getByRole('navigation', { name: 'Setup steps' }))
    .getAllByRole('button')
    .map((b) => b.textContent)

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the guided case setup', () => {
  it('needs a name and description, then creates the case and moves on to its facts', async () => {
    const service = setupService()
    const user = renderAt('/courses/c1/cases/new', service)

    const next = screen.getByRole('button', { name: 'Next' })
    expect(next).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Skip for now' })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Case name'), 'Rivera v. Thrill Park')
    expect(next).toBeDisabled()
    await user.type(screen.getByLabelText('Description'), 'A rollercoaster stalls mid-loop.')
    await user.click(next)

    expect(service.createCase).toHaveBeenCalledWith('c1', { title: 'Rivera v. Thrill Park', summary: 'A rollercoaster stalls mid-loop.' })
    expect(service.reachSetupStep).toHaveBeenCalledWith('c1', 'k1', 'facts')
    // The setup carries on at the case's own address, replacing the new-case page.
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Important facts' })).toBeInTheDocument())
    // Only the steps reached so far show in the top bar.
    expect(stepButtons()).toEqual(['Details', '2Important facts'])
    expect(screen.queryByRole('tab', { name: 'Student view' })).not.toBeInTheDocument()
  })

  it('saves the important facts with Next, and leaves them with Skip for now', async () => {
    const service = setupService()
    const user = renderAt('/courses/c1/cases/new', service)
    await user.type(screen.getByLabelText('Case name'), 'Rivera v. Thrill Park')
    await user.type(screen.getByLabelText('Description'), 'A rollercoaster stalls mid-loop.')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    await user.type(await screen.findByLabelText('Plaintiff fact 1'), 'The lap bar light was red.')
    await user.type(screen.getByLabelText('Defense fact 1'), 'It passed inspection.')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(service.updateCase).toHaveBeenCalledWith('c1', 'k1', expect.objectContaining({
      importantFacts: { plaintiff: ['The lap bar light was red.'], defense: ['It passed inspection.'] },
    }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Case file' })).toBeInTheDocument()

    // Back to the facts from the top bar, then skip past them: nothing more is saved.
    await user.click(screen.getByRole('button', { name: 'Important facts' }))
    expect(screen.getByLabelText('Plaintiff fact 1')).toHaveValue('The lap bar light was red.')
    await user.click(screen.getByRole('button', { name: 'Skip for now' }))
    expect(service.updateCase).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('heading', { level: 2, name: 'Case file' })).toBeInTheDocument()
    expect(stepButtons()).toEqual(['Details', 'Important facts', '3Case file'])
  })

  it('resumes an unfinished case at the furthest step reached', async () => {
    const service = setupService({ getCase: vi.fn().mockResolvedValue({ ...draft, setupStep: 'worlds' }) })
    renderAt('/courses/c1/cases/k1', service)

    expect(await screen.findByRole('heading', { level: 2, name: 'Case worlds' })).toBeInTheDocument()
    expect(stepButtons()).toEqual(['Details', 'Important facts', 'Case file', 'Teams', '5Case worlds'])
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Case worlds' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Teams' })).not.toBeInTheDocument()
  })

  it('finishes with congratulations, then opens the information exchange setup', async () => {
    const service = setupService({
      getCase: vi.fn().mockResolvedValue({ ...draft, setupStep: 'tasks' }),
      getExchange: vi.fn().mockResolvedValue({
        settings: {
          setupCompletedAt: null,
          disclosures: { enabled: true, materialIds: [], witnessIds: [] },
          subpoenas: { enabled: true, limit: 3, days: 14 },
          interrogatories: { enabled: true, limit: 25, days: 30 },
          rfas: { enabled: true, limit: 25, days: 30 },
          firms: { plaintiff: { firm: '', partner: '' }, defense: { firm: '', partner: '' } },
        },
        options: [],
      }),
    })
    const user = renderAt('/courses/c1/cases/k1', service)

    expect(await screen.findByRole('heading', { level: 2, name: 'Tasks' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Finish' }))

    expect(service.completeSetup).toHaveBeenCalledWith('c1', 'k1')
    expect(await screen.findByRole('heading', { name: 'Congratulations, you created a new case: Rivera v. Thrill Park!' })).toBeInTheDocument()
    expect(screen.getByText(/open the Student view tab on the case page/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Set up information exchange' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Set up information exchange' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Initial disclosures' })).toBeInTheDocument()
  })

  it('goes to the case from the congratulations', async () => {
    const service = setupService({ getCase: vi.fn().mockResolvedValue({ ...draft, setupStep: 'tasks' }) })
    const user = renderAt('/courses/c1/cases/k1', service)

    await user.click(await screen.findByRole('button', { name: 'Skip for now' }))
    await user.click(await screen.findByRole('button', { name: 'Go to the case' }))

    expect(await screen.findByRole('tab', { name: 'Teams & worlds' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('region', { name: 'Launch case worlds' })).toBeInTheDocument()
  })

  it('shows the error and stays on the step when saving fails', async () => {
    const service = setupService({ createCase: vi.fn().mockRejectedValue(new Error('Add a short description of the case.')) })
    const user = renderAt('/courses/c1/cases/new', service)

    await user.type(screen.getByLabelText('Case name'), 'Rivera')
    await user.type(screen.getByLabelText('Description'), 'x')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Add a short description of the case.')
    expect(screen.getByRole('heading', { level: 2, name: 'Details' })).toBeInTheDocument()
  })

  it('asks whether the case has a background investigator, before the tasks', async () => {
    const service = setupService({ getCase: vi.fn().mockResolvedValue({ ...draft, setupStep: 'investigator' }) })
    const user = renderAt('/courses/c1/cases/k1', service)

    expect(await screen.findByRole('region', { name: 'Background investigator' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Use a background investigator' })).toBeChecked()
    expect(stepButtons().at(-1)).toBe('7Investigator')
    await user.click(screen.getByRole('button', { name: 'Skip for now' }))
    expect(service.reachSetupStep).toHaveBeenCalledWith('c1', 'k1', 'tasks')
  })
})

