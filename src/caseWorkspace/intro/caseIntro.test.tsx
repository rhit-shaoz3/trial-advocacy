import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CaseWorkspace, StudentExchange, WorkspaceWitness } from '../../courses/types'
import { CaseIntroStage } from './CaseIntroStage'
import { introKey, pickIntro } from './caseIntro'

const witness = (over: Partial<WorkspaceWitness>): WorkspaceWitness => ({
  id: 'w1',
  name: 'Tom Becker',
  role: 'Ride operator',
  description: '',
  audience: 'all',
  side: 'defense',
  canInterview: true,
  ...over,
})

const workspace = (over: Partial<CaseWorkspace> = {}, phase: CaseWorkspace['case']['phase'] = 'introduction'): CaseWorkspace => ({
  case: { id: 'k1', title: 'Rivera v. Thrill Park', summary: 'A harness opened.', status: 'active', phase, instructorNote: '' },
  team: { number: 1, members: [] },
  world: null,
  side: 'plaintiff',
  materials: [],
  witnesses: [],
  investigatorAvailable: true,
  tasks: [],
  preview: false,
  ...over,
})

const exchange = (parts: Partial<Pick<StudentExchange, 'interrogatories' | 'rfas' | 'subpoenas'>>) =>
  ({ interrogatories: null, rfas: null, subpoenas: null, ...parts }) as StudentExchange
const on = {} as StudentExchange['interrogatories']

describe('pickIntro', () => {
  it('welcomes the team with the launch, once per entry into a phase', () => {
    expect(pickIntro(workspace(), null)).toEqual({ kind: 'launch' })
    expect(introKey('k1', 'introduction', null)).toBe('intro:k1:introduction:start')
    // Each time the case enters a phase is a new welcome.
    const first = introKey('k1', 'deposition', '2026-11-01T10:00:00.000Z')
    const again = introKey('k1', 'deposition', '2026-11-03T09:30:00.000Z')
    expect(first).toMatch(/^intro:k1:deposition:\d+$/)
    expect(again).not.toBe(first)
  })

  it('names only the exchange parts the case includes, and has nothing when none are on', () => {
    expect(pickIntro(workspace({}, 'information_exchange'), exchange({ interrogatories: on, subpoenas: {} as StudentExchange['subpoenas'] }))).toEqual({
      kind: 'information_exchange',
      parts: ['interrogatories', 'subpoenas'],
    })
    expect(pickIntro(workspace({}, 'information_exchange'), exchange({}))).toBeNull()
    expect(pickIntro(workspace({}, 'information_exchange'), null)).toBeNull()
  })

  it('introduces the investigator only when the case has one', () => {
    expect(pickIntro(workspace({ investigator: { name: 'Nora Vance', avatarUrl: '/n.png' } }, 'investigate'), null)).toEqual({
      kind: 'investigate',
      investigator: { name: 'Nora Vance', avatarUrl: '/n.png' },
    })
    // Older cases have the default investigator.
    expect(pickIntro(workspace({}, 'investigate'), null)).toMatchObject({ investigator: { name: 'John Hastings' } })
    expect(pickIntro(workspace({ investigator: null }, 'investigate'), null)).toBeNull()
    expect(pickIntro(workspace({ investigatorAvailable: false }, 'investigate'), null)).toBeNull()
  })

  it('lists the other side’s witnesses the team can depose, and has nothing without them', () => {
    const witnesses = [
      witness({}),
      witness({ id: 'w2', name: 'Elena Ramirez', side: 'plaintiff' }),
      witness({ id: 'w3', name: 'Dana Cole', canInterview: false }),
    ]
    expect(pickIntro(workspace({ witnesses }, 'deposition'), null)).toEqual({
      kind: 'deposition',
      witnesses: [{ id: 'w1', name: 'Tom Becker', role: 'Ride operator', avatarUrl: null }],
    })
    expect(pickIntro(workspace({ witnesses: witnesses.slice(1) }, 'deposition'), null)).toBeNull()
  })

  it('opens final steps only when the exhibit list is on', () => {
    expect(pickIntro(workspace({}, 'final_steps'), null)).toEqual({ kind: 'final_steps', judging: true })
    expect(pickIntro(workspace({ exhibitJudicialReview: false }, 'final_steps'), null)).toEqual({ kind: 'final_steps', judging: false })
    expect(pickIntro(workspace({ exhibitListEnabled: false }, 'final_steps'), null)).toBeNull()
  })
})

describe('CaseIntroStage', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('plays its scene, then lands on the card, whose button goes to the phase’s tab', async () => {
    vi.useFakeTimers()
    const onEnter = vi.fn()
    render(<CaseIntroStage intro={{ kind: 'information_exchange', parts: ['interrogatories', 'rfas'] }} caseTitle="Rivera" email={null} onEnter={onEnter} />)
    const card = screen.getByRole('heading', { name: 'Information exchange', hidden: true }).closest('section')!
    expect(card).toHaveAttribute('aria-hidden', 'true')
    act(() => {
      vi.advanceTimersByTime(1800)
    })
    expect(card).toHaveAttribute('aria-hidden', 'false')
    expect(within(card).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Interrogatories: written questions the other side has to answer under oath.',
      'Requests for admission: statements the other side has to admit or deny.',
    ])
    vi.useRealTimers()
    await userEvent.setup().click(within(card).getByRole('button', { name: 'Try it' }))
    expect(onEnter).toHaveBeenCalledWith('exchange')
  })

  it('goes straight to the card with reduced motion, and Escape goes on too', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} }))
    const onEnter = vi.fn()
    render(
      <CaseIntroStage
        intro={{ kind: 'deposition', witnesses: [{ id: 'w1', name: 'Tom Becker', role: 'Ride operator', avatarUrl: null }] }}
        caseTitle="Rivera"
        email={null}
        onEnter={onEnter}
      />,
    )
    const card = screen.getByRole('heading', { name: 'Deposition' }).closest('section')!
    expect(card).toHaveTextContent('Tom BeckerRide operator')
    fireEvent(card.closest('dialog')!, new Event('close'))
    expect(onEnter).toHaveBeenCalledWith('witnesses')
  })

  it('opens the case with the welcome email, then dives into the overview', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} }))
    const onEnter = vi.fn()
    render(<CaseIntroStage intro={{ kind: 'launch' }} caseTitle="Rivera v. Thrill Park" email={<p>Welcome aboard.</p>} onEnter={onEnter} />)
    expect(screen.getByRole('heading', { name: 'Rivera v. Thrill Park' }).closest('section')).toHaveTextContent('Your case is open')
    expect(screen.getByText('Welcome aboard.')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dive in' }))
    expect(onEnter).toHaveBeenCalledWith('overview')
  })
})
