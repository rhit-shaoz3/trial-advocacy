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
  phase: 'subpoena',
  instructorNote: '',
  inWorldDate: null,
  disputedIssues: '',
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
    expect(within(steps).getByText('Subpoena').closest('li')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText(/Teams see only their own side's witnesses/)).toBeInTheDocument()
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
    await user.click(screen.getByRole('button', { name: 'Back to Subpoena' }))
    expect(service.setCasePhase).toHaveBeenCalledWith('c1', 'k1', 'subpoena')
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
})
