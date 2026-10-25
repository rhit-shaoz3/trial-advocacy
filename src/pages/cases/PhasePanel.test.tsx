import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CourseServiceContext } from '../../courses/CourseServiceContext'
import type { CourseCase, CourseService } from '../../courses/types'
import { fakeCourseService } from '../../test/fakeCourseService'
import { PhasePanel } from './PhasePanel'

const coaster: CourseCase = {
  id: 'k1',
  title: 'Rivera v. Thrill Park',
  summary: '',
  status: 'active',
  phase: 'introduction',
  instructorNote: '',
  inWorldDate: null,
  disputedIssues: '',
  importantFacts: { plaintiff: ['The light was red.'], defense: ['It passed inspection.'] },
  createdAt: '2026-10-01T15:00:00.000Z',
  updatedAt: '2026-10-01T15:00:00.000Z',
}

function renderPanel(courseCase: CourseCase, overrides: Partial<CourseService> = {}) {
  const service = fakeCourseService(overrides)
  const onChanged = vi.fn()
  const user = userEvent.setup()
  render(
    <CourseServiceContext.Provider value={service}>
      <PhasePanel courseId="c1" courseCase={courseCase} onChanged={onChanged} />
    </CourseServiceContext.Provider>,
  )
  return { user, service, onChanged }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PhasePanel', () => {
  it('marks the current phase and moves to the next after confirming', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const moved = { ...coaster, phase: 'investigate' as const }
    const { user, service, onChanged } = renderPanel(coaster, { setCasePhase: vi.fn().mockResolvedValue(moved) })

    const steps = screen.getByRole('list', { name: 'Phases' })
    expect(within(steps).getByText('Introduction').closest('li')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText(/Teams have the case and their side's witnesses/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Back to/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Move to Investigate' }))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('investigate phase'))
    expect(service.setCasePhase).toHaveBeenCalledWith('c1', 'k1', 'investigate')
    expect(onChanged).toHaveBeenCalledWith(moved)
  })

  it('warns that deposition reveals every witness, and can step back', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user, service } = renderPanel({ ...coaster, phase: 'investigate' })

    await user.click(screen.getByRole('button', { name: 'Move to Deposition' }))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('reveals every witness to both sides'))
    expect(service.setCasePhase).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Back to Introduction' }))
    expect(service.setCasePhase).toHaveBeenCalledWith('c1', 'k1', 'introduction')
  })

  it('shows errors, and is read-only once the case is closed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { user } = renderPanel({ ...coaster, phase: 'deposition' }, {
      setCasePhase: vi.fn().mockRejectedValue(new Error('This case is closed, so its phase can no longer change.')),
    })
    expect(screen.queryByRole('button', { name: /Move to/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to Investigate' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This case is closed')
  })

  it('has no buttons on a closed case', () => {
    renderPanel({ ...coaster, status: 'closed', phase: 'investigate' })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText(/its phase can no longer change/)).toBeInTheDocument()
  })

  it('stays hidden until the case worlds launch', () => {
    renderPanel({ ...coaster, status: 'draft' })
    expect(screen.queryByRole('heading', { name: 'Case phase' })).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Phases' })).not.toBeInTheDocument()
  })

  it('asks in a dialog before sharing the initial disclosures', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    const moved = { ...coaster, exchangeReady: true, phase: 'information_exchange' as const }
    const { user, service, onChanged } = renderPanel(
      { ...coaster, exchangeReady: true },
      {
        setCasePhase: vi.fn().mockResolvedValue(moved),
        getExchangeOverview: vi.fn().mockResolvedValue({
          submissions: { submitted: 3, total: 4, byWorld: [] },
          activity: {},
          disclosed: { materials: ['Medical records', 'Incident report'], witnesses: ['Tom Becker'] },
        }),
      },
    )
    expect(within(screen.getByRole('list', { name: 'Phases' })).getAllByRole('listitem')).toHaveLength(4)

    await user.click(screen.getByRole('button', { name: 'Move to Information exchange' }))
    const dialog = await screen.findByRole('dialog', { name: 'Move to information exchange?' })
    expect(dialog).toHaveTextContent('2 case files become visible to everyone')
    expect(dialog).toHaveTextContent('Medical records and Incident report')
    expect(dialog).toHaveTextContent('1 witness appears on both sides')
    expect(dialog).toHaveTextContent("1 student hasn't submitted their initial disclosures")
    expect(confirm).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Move to information exchange' }))
    expect(service.setCasePhase).toHaveBeenCalledWith('c1', 'k1', 'information_exchange')
    expect(onChanged).toHaveBeenCalledWith(moved)
  })

  it('goes straight from introduction to deposition without an investigator', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { user, service } = renderPanel({ ...coaster, investigator: { enabled: false, name: 'John Hastings', instructions: '' } })

    const steps = within(screen.getByRole('list', { name: 'Phases' })).getAllByRole('listitem')
    expect(steps.map((s) => s.textContent)).toEqual(['1Introduction', '2Deposition'])
    expect(screen.getByText(/initial disclosures\. Every case world/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Move to Deposition/ }))
    expect(service.setCasePhase).toHaveBeenCalledWith('c1', 'k1', 'deposition')
  })
})

