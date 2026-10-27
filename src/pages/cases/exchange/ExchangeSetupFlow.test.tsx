import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CourseServiceContext } from '../../../courses/CourseServiceContext'
import type { CourseCase, CourseService, ExchangeSettings } from '../../../courses/types'
import { fakeCourseService } from '../../../test/fakeCourseService'
import { ExchangeSetupFlow } from './ExchangeSetupFlow'

const courseCase: CourseCase = {
  id: 'k1',
  title: 'Ramirez v. Thrillville',
  summary: '',
  status: 'draft',
  phase: 'introduction',
  instructorNote: '',
  inWorldDate: null,
  disputedIssues: '',
  importantFacts: { plaintiff: [], defense: [] },
  createdAt: '2026-10-01T15:00:00.000Z',
  updatedAt: '2026-10-01T15:00:00.000Z',
}

const settings: ExchangeSettings = {
  setupCompletedAt: null,
  disclosures: { enabled: true, materialIds: [], witnessIds: [] },
  subpoenas: { enabled: true, limit: 3, days: 14 },
  interrogatories: { enabled: true, limit: 25, days: 30 },
  rfas: { enabled: true, limit: 25, days: 30 },
  firms: { plaintiff: { firm: '', partner: '' }, defense: { firm: '', partner: '' } },
}

function renderFlow(overrides: Partial<CourseService> = {}) {
  const service = fakeCourseService({
    getExchange: vi.fn().mockResolvedValue({
      settings,
      options: [
        { kind: 'witness', id: 'w1', side: 'plaintiff', name: 'Elena Ramirez', detail: 'Plaintiff', avatarUrl: null },
        { kind: 'material', id: 'm1', side: 'defense', name: 'Incident report.pdf', detail: '', avatarUrl: null },
      ],
    }),
    saveExchangeSettings: vi.fn().mockResolvedValue(settings),
    saveDisclosures: vi.fn().mockResolvedValue(settings),
    completeExchangeSetup: vi.fn().mockResolvedValue({ settings, case: { ...courseCase, exchangeReady: true } }),
    ...overrides,
  })
  const onCaseChange = vi.fn()
  const onExit = vi.fn()
  const user = userEvent.setup()
  render(
    <CourseServiceContext.Provider value={service}>
      <ExchangeSetupFlow courseId="c1" courseCase={courseCase} onCaseChange={onCaseChange} onExit={onExit} />
    </CourseServiceContext.Provider>,
  )
  return { user, service, onCaseChange, onExit }
}

describe('ExchangeSetupFlow', () => {
  it('saves the initial disclosures and each step’s settings, then finishes', async () => {
    const { user, service, onCaseChange, onExit } = renderFlow()

    await user.click(await screen.findByRole('checkbox', { name: /Elena Ramirez/ }))
    await user.click(screen.getByRole('checkbox', { name: /Incident report/ }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(service.saveDisclosures).toHaveBeenCalledWith('c1', 'k1', { materialIds: ['m1'], witnessIds: ['w1'] })

    // Subpoenas: turned off with the small Include switch.
    expect(await screen.findByRole('heading', { level: 2, name: 'Subpoenas' })).toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: 'Include subpoenas' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(service.saveExchangeSettings).toHaveBeenLastCalledWith('c1', 'k1', expect.objectContaining({ subpoenas: { enabled: false, limit: 3, days: 14 } }))

    // Interrogatories: a lower limit.
    await screen.findByRole('heading', { level: 2, name: 'Interrogatories' })
    await user.click(screen.getByRole('button', { name: 'Fewer questions' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(service.saveExchangeSettings).toHaveBeenLastCalledWith('c1', 'k1', expect.objectContaining({ interrogatories: { enabled: true, limit: 24, days: 30 } }))
    // No reminders of the federal rules for the instructor.
    expect(screen.queryByText(/FRCP/)).not.toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: 'Next' })) // requests for admission
    await user.type((await screen.findAllByRole('textbox', { name: 'Senior partner' }))[0], 'Margaret Hale')
    // The preview signs the email as Senior Partner.
    expect(screen.getByRole('article', { name: 'Email from Margaret Hale' })).toHaveTextContent('Senior Partner')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByRole('list', { name: 'Your choices' })).toHaveTextContent('Subpoenas')
    expect(screen.getByText('Teams won’t see this.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Finish setup' }))
    expect(service.completeExchangeSetup).toHaveBeenCalledWith('c1', 'k1')
    expect(onCaseChange).toHaveBeenCalledWith(expect.objectContaining({ exchangeReady: true }))
    expect(onExit).toHaveBeenCalled()
  })

  it('saves and leaves partway through', async () => {
    const { user, service, onExit } = renderFlow()
    await user.click(await screen.findByRole('button', { name: 'Save and finish later' }))
    expect(service.saveExchangeSettings).toHaveBeenCalled()
    expect(onExit).toHaveBeenCalled()
    expect(service.completeExchangeSetup).not.toHaveBeenCalled()
  })
})
