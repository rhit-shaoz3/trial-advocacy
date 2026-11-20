import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../../auth/AuthContext'
import type { User } from '../../auth/types'
import { CourseServiceContext } from '../../courses/CourseServiceContext'
import type { CaseWorkspace, CourseService, PracticeBlocks, PracticeSession, PracticeTurn } from '../../courses/types'
import { fakeCourseService } from '../../test/fakeCourseService'
import { PracticePage } from './PracticePage'
import { PracticeSetup } from './PracticeSetup'

const student: User = { id: 'u1', name: 'Ada Lawyer', email: 'ada@example.com', role: 'student', theme: 'navy', avatarUrl: null, createdAt: '2026-09-01T00:00:00.000Z' }

function renderAt(url: string, overrides: Partial<CourseService>) {
  const service = fakeCourseService(overrides)
  const user = userEvent.setup()
  render(
    <AuthContext.Provider value={{ user: student, loading: false, signUp: vi.fn(), logIn: vi.fn(), logOut: vi.fn(), updateProfile: vi.fn(), uploadAvatar: vi.fn(), removeAvatar: vi.fn(), markTourSeen: vi.fn() }}>
      <MemoryRouter initialEntries={[url]}>
        <CourseServiceContext.Provider value={service}>
          <Routes>
            <Route path="courses/:courseId/cases/:caseId/witnesses/:witnessId/practice" element={<PracticeSetup />} />
            <Route path="courses/:courseId/cases/:caseId/practice/:sessionId" element={<PracticePage />} />
          </Routes>
        </CourseServiceContext.Provider>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
  return { user, service }
}

const witness = (over: Partial<CaseWorkspace['witnesses'][number]>) => ({
  id: 'w1',
  name: 'Dr. Lin',
  role: 'ER doctor',
  description: '',
  side: 'plaintiff' as const,
  canInterview: true,
  locked: false,
  disclosed: false,
  client: false,
  avatarUrl: null,
  ...over,
})

const workspace = {
  case: { id: 'k1', title: 'Rivera v. Thrill Park', status: 'active' },
  side: 'plaintiff',
  witnesses: [witness({}), witness({ id: 'w2', name: 'Elena Torres', side: 'defense' })],
  practice: { enabled: true, limit: 5 },
} as unknown as CaseWorkspace

const blocks = (over: Partial<PracticeBlocks> = {}): PracticeBlocks => ({
  coach: [],
  hold: false,
  objection: null,
  awaitResponse: false,
  ruling: null,
  counsel: null,
  witness: null,
  ...over,
})

const turn = (position: number, over: Partial<PracticeTurn>): PracticeTurn => ({
  position,
  kind: 'question',
  text: '',
  blocks: blocks(),
  createdAt: '2026-11-20T12:00:00Z',
  ...over,
})

const session = (over: Partial<PracticeSession> = {}): PracticeSession => ({
  id: 's1',
  witness: { id: 'w1', name: 'Dr. Lin', role: 'ER doctor', avatarUrl: null },
  side: 'plaintiff',
  type: 'direct',
  goal: 'Get the timeline of the night.',
  cooperation: 'regular',
  toneNotes: '',
  priorTestimony: '',
  opposingCounsel: 'Mr. Grant',
  turns: [],
  pending: null,
  maxTurns: 100,
  endsAt: null,
  endedAt: null,
  canAsk: true,
  notice: null,
  limit: { max: 5, used: 1 },
  createdAt: '2026-11-20T12:00:00Z',
  ...over,
})

describe('setting up practice', () => {
  it('offers the witness’s own settings, needs a goal, and starts the session', async () => {
    const startPractice = vi.fn().mockResolvedValue(session({ type: 'redirect' }))
    const { user } = renderAt('/courses/c1/cases/k1/witnesses/w1/practice', {
      getPractice: vi.fn().mockResolvedValue(session({ type: 'redirect' })),
      getMyCaseWorkspace: vi.fn().mockResolvedValue(workspace),
      listPractice: vi.fn().mockResolvedValue({
        limit: { max: 5, used: 2 },
        sessions: [{ id: 's0', witnessId: 'w1', witnessName: 'Dr. Lin', type: 'interview', goal: 'Her shift.', turns: 4, createdAt: '2026-11-19T12:00:00Z', endedAt: '2026-11-19T12:30:00Z' }],
      }),
      startPractice,
    })
    expect(await screen.findByText(/Practice isn’t about getting through the whole conversation/)).toBeInTheDocument()
    expect(screen.getByText('2 of 5 practice sessions used in this case · 3 left')).toBeInTheDocument()
    // Earlier sessions with the witness, to open again.
    expect(screen.getByRole('link', { name: 'Interview' })).toHaveAttribute('href', '/courses/c1/cases/k1/practice/s0')
    const setting = screen.getByLabelText('Setting')
    expect(within(setting).getAllByRole('option').map((o) => o.textContent)).toEqual(['Interview', 'Direct examination', 'Redirect examination'])
    const start = screen.getByRole('button', { name: 'Start practice' })
    expect(start).toBeDisabled()
    // Only cross and redirect ask what came before.
    expect(screen.queryByLabelText(/What the earlier examination covered/)).not.toBeInTheDocument()
    await user.selectOptions(setting, 'redirect')
    await user.type(screen.getByLabelText(/What the earlier examination covered/), 'Cross said she was tired.')
    await user.type(screen.getByLabelText('What do you want to practice?'), 'Repair the fatigue point.')
    await user.click(screen.getByText('The witness’s demeanor (optional)'))
    await user.selectOptions(screen.getByLabelText('Cooperation'), 'hostile')
    await user.click(start)
    expect(startPractice).toHaveBeenCalledWith('c1', 'k1', {
      witnessId: 'w1',
      type: 'redirect',
      goal: 'Repair the fatigue point.',
      cooperation: 'hostile',
      toneNotes: '',
      priorTestimony: 'Cross said she was tired.',
    })
    expect(await screen.findByText(/Practice · Redirect examination/)).toBeInTheDocument()
  })

  it('offers deposition and cross for the other side’s witness', async () => {
    renderAt('/courses/c1/cases/k1/witnesses/w2/practice', {
      getMyCaseWorkspace: vi.fn().mockResolvedValue(workspace),
      listPractice: vi.fn().mockResolvedValue({ limit: { max: 5, used: 0 }, sessions: [] }),
    })
    const setting = await screen.findByLabelText('Setting')
    expect(within(setting).getAllByRole('option').map((o) => o.textContent)).toEqual(['Deposition', 'Cross-examination'])
  })
})

describe('a practice session', () => {
  it('shows the coach’s notes beside the question, with the words they quote marked', async () => {
    const noted = session({
      turns: [
        turn(0, {
          text: 'What did you see when you walked in?',
          blocks: blocks({ coach: [{ kind: 'good', quote: 'What did you see', text: 'Open, so the jury hears it from her.' }], witness: 'A child on a gurney.' }),
        }),
      ],
    })
    const { user } = renderAt('/courses/c1/cases/k1/practice/s1', { getPractice: vi.fn().mockResolvedValue(noted) })
    const notes = await screen.findByRole('complementary', { name: 'Coach’s notes' })
    expect(notes).toHaveTextContent('Good question')
    expect(notes).toHaveTextContent('Open, so the jury hears it from her.')
    const mark = screen.getByText('What did you see', { selector: 'mark' })
    expect(mark).toHaveClass('pr-mark-good')
    const note = within(notes).getByText('Open, so the jury hears it from her.').closest('.pr-note')!
    await user.hover(note)
    expect(mark).toHaveClass('pr-active')
    expect(screen.getByText('A child on a gurney.')).toBeInTheDocument()
    expect(screen.getByText(/Practice · Direct examination · Doesn’t count toward your interviews/)).toBeInTheDocument()
    expect(screen.getByText('Get the timeline of the night.')).toBeInTheDocument()
  })

  it('lets the student edit a held question or ask it as written, then answer the objection', async () => {
    const held = session({
      pending: 'hold',
      turns: [turn(0, { text: 'You saw the bar open, didn’t you?', blocks: blocks({ hold: true, coach: [{ kind: 'leading', quote: 'didn’t you', text: 'That suggests the answer.' }] }) })],
    })
    const objected = session({
      pending: 'objection',
      turns: [
        ...held.turns,
        turn(1, { kind: 'as_written', text: 'You saw the bar open, didn’t you?', blocks: blocks({ objection: { by: 'Mr. Grant', text: 'Objection, leading.' }, awaitResponse: true }) }),
      ],
    })
    const ruled = session({
      turns: [
        ...objected.turns,
        turn(2, { kind: 'objection_response', text: 'It’s preliminary.', blocks: blocks({ ruling: { result: 'sustained', text: 'Sustained.' } }) }),
      ],
    })
    const takePracticeTurn = vi.fn().mockResolvedValueOnce(objected).mockResolvedValueOnce(ruled)
    const { user } = renderAt('/courses/c1/cases/k1/practice/s1', { getPractice: vi.fn().mockResolvedValue(held), takePracticeTurn })

    expect(await screen.findByText('Held, not asked')).toBeInTheDocument()
    expect(screen.getByText('Edit your question, or ask it as written')).toBeInTheDocument()
    expect(screen.getByLabelText('Your edited question')).toHaveValue('You saw the bar open, didn’t you?')
    await user.click(screen.getByRole('button', { name: 'Ask as written' }))
    expect(takePracticeTurn).toHaveBeenCalledWith('c1', 'k1', 's1', { kind: 'as_written', text: 'You saw the bar open, didn’t you?', exhibitIds: [] })

    expect(await screen.findByText('Objection, leading.')).toBeInTheDocument()
    expect(screen.getByText('Mr. Grant:')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Your response to the objection'), 'It’s preliminary.{Enter}')
    expect(takePracticeTurn).toHaveBeenLastCalledWith('c1', 'k1', 's1', { kind: 'objection_response', text: 'It’s preliminary.', exhibitIds: [] })
    expect(await screen.findByText('Sustained.')).toBeInTheDocument()
    expect(screen.getByText('Your response to the objection', { selector: '.iv-tag' })).toBeInTheDocument()
    expect(screen.getByLabelText('Your question')).toHaveValue('')
  })

  it('withdraws an objected question by asking a new one', async () => {
    const objected = session({
      pending: 'objection',
      turns: [turn(0, { text: 'What did the nurse say?', blocks: blocks({ objection: { by: 'Mr. Grant', text: 'Objection, hearsay.' }, awaitResponse: true }) })],
    })
    const takePracticeTurn = vi.fn().mockResolvedValue(session({ turns: objected.turns }))
    const { user } = renderAt('/courses/c1/cases/k1/practice/s1', { getPractice: vi.fn().mockResolvedValue(objected), takePracticeTurn })
    await user.click(await screen.findByRole('button', { name: 'Withdraw and ask another' }))
    await user.type(screen.getByLabelText('Your question'), 'What did you do next?{Enter}')
    expect(takePracticeTurn).toHaveBeenCalledWith('c1', 'k1', 's1', { kind: 'question', text: 'What did you do next?', exhibitIds: [] })
  })

  it('points to the learning library once it has ended', async () => {
    renderAt('/courses/c1/cases/k1/practice/s1', {
      getPractice: vi.fn().mockResolvedValue(session({ endedAt: '2026-11-20T13:00:00Z', canAsk: false, notice: 'This practice session has ended. It’s in your learning library.' })),
    })
    expect(await screen.findByRole('link', { name: /Open your learning library/ })).toHaveAttribute('href', '/courses/c1/library')
    expect(screen.queryByRole('button', { name: 'End practice' })).not.toBeInTheDocument()
  })
})
