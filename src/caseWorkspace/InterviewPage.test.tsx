import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../auth/AuthContext'
import type { User } from '../auth/types'
import { CourseServiceContext } from '../courses/CourseServiceContext'
import type { CourseService, Interview } from '../courses/types'
import { fakeCourseService } from '../test/fakeCourseService'
import { InterviewPage } from './InterviewPage'

const empty: Interview = {
  id: 'd1',
  side: 'plaintiff',
  witness: { id: 'w1', name: 'Elena Torres', role: 'Ride operator' },
  turns: [],
  maxTurns: 150,
  endsAt: null,
  canAsk: true,
  notice: null,
}
const turn = (position: number, question: string, answer: string, objection: string | null = null) => ({
  position,
  question,
  answer,
  objection,
  askedBy: 'Ada Lawyer',
  createdAt: '2026-10-15T12:00:00.000Z',
})

const student: User = { id: 'u1', name: 'Ada Lawyer', email: 'ada@example.com', role: 'student', theme: 'navy', avatarUrl: null, createdAt: '2026-09-01T00:00:00.000Z' }
const instructor: User = { id: 'u2', name: 'Prof. Ruiz', email: 'prof@example.com', role: 'instructor', theme: 'navy', avatarUrl: null, createdAt: '2026-09-01T00:00:00.000Z' }

function renderPage(overrides: Partial<CourseService>, user: User = student, url = '/courses/c1/cases/k1/witnesses/w1') {
  const service = fakeCourseService(overrides)
  const events = userEvent.setup()
  render(
    <AuthContext.Provider value={{ user, loading: false, signUp: vi.fn(), logIn: vi.fn(), logOut: vi.fn(), updateProfile: vi.fn(), uploadAvatar: vi.fn(), removeAvatar: vi.fn() }}>
      <MemoryRouter initialEntries={[url]}>
        <CourseServiceContext.Provider value={service}>
          <Routes>
            <Route path="courses/:courseId/cases/:caseId/witnesses/:witnessId" element={<InterviewPage />} />
          </Routes>
        </CourseServiceContext.Provider>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
  return { user: events, service }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('InterviewPage', () => {
  it("asks the team's interview questions and shows the answers", async () => {
    const answered = { ...empty, turns: [turn(0, 'Where were you?', 'At the booth.')] }
    const askWitness = vi.fn().mockResolvedValue(answered)
    const { user, service } = renderPage({ getInterview: vi.fn().mockResolvedValue(empty), askWitness })

    expect(await screen.findByRole('heading', { level: 1, name: 'Elena Torres' })).toBeInTheDocument()
    expect(service.getInterview).toHaveBeenCalledWith('c1', 'k1', 'w1', 'team')
    expect(screen.getByText(/Witness interview · As plaintiff’s counsel/)).toBeInTheDocument()
    expect(screen.getByText(/Ask your first question to start the interview/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Case' })).toHaveAttribute('href', '/courses/c1/cases/k1')

    await user.type(screen.getByLabelText('Your question'), 'Where were you?{Enter}')
    expect(askWitness).toHaveBeenCalledWith('c1', 'k1', 'w1', 'team', 'Where were you?')
    const transcript = screen.getByRole('list', { name: 'Transcript' })
    expect(await screen.findByText('At the booth.')).toBeInTheDocument()
    expect(transcript).toHaveTextContent('Q.Where were you?Ada LawyerA.At the booth.')
    expect(screen.getByLabelText('Your question')).toHaveValue('')
  })

  it('shows objections and keeps the question when asking fails', async () => {
    const withObjection = { ...empty, turns: [turn(0, 'You were careless?', 'No.', 'Ms. Park: Objection, form.')] }
    const askWitness = vi.fn().mockRejectedValue(new Error('The witness could not answer just now.'))
    const { user } = renderPage({ getInterview: vi.fn().mockResolvedValue(withObjection), askWitness })

    expect(await screen.findByText('Ms. Park: Objection, form.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Your question'), 'And then?')
    await user.click(screen.getByRole('button', { name: 'Ask' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The witness could not answer just now.')
    expect(screen.getByLabelText('Your question')).toHaveValue('And then?')
  })

  it('starts over after confirming', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const started = { ...empty, turns: [turn(0, 'Where were you?', 'At the booth.')] }
    const restartInterview = vi.fn().mockResolvedValue({ ...empty, id: 'd2' })
    const { user } = renderPage({ getInterview: vi.fn().mockResolvedValue(started), restartInterview })

    await user.click(await screen.findByRole('button', { name: 'Start over' }))
    expect(restartInterview).toHaveBeenCalledWith('c1', 'k1', 'w1', 'team')
    expect(await screen.findByText(/Ask your first question to start the interview/)).toBeInTheDocument()
  })

  it('explains when the witness cannot be interviewed', async () => {
    renderPage({
      getInterview: vi.fn().mockResolvedValue({ ...empty, canAsk: false, notice: "Elena Torres isn't available for interviews yet." }),
    })
    expect(await screen.findByRole('status')).toHaveTextContent("isn't available for interviews yet")
    expect(screen.queryByLabelText('Your question')).not.toBeInTheDocument()
  })

  it("tests the witness as the side the instructor chose, with no way to switch", async () => {
    const getInterview = vi.fn().mockImplementation(async (_c, _k, _w, as) => ({ ...empty, side: as }))
    renderPage({ getInterview }, instructor, '/courses/c1/cases/k1/witnesses/w1?side=defense')

    expect(await screen.findByText(/Test interview · As defendant’s counsel/)).toBeInTheDocument()
    expect(getInterview).toHaveBeenCalledWith('c1', 'k1', 'w1', 'defense')
    expect(screen.getByRole('link', { name: 'Witnesses' })).toHaveAttribute('href', '/courses/c1/cases/k1?tab=witnesses')
    expect(screen.queryByRole('button', { name: 'Plaintiff' })).not.toBeInTheDocument()
  })

  it("never lets a student pick a side, even with ?side= in the address", async () => {
    const getInterview = vi.fn().mockResolvedValue(empty)
    renderPage({ getInterview }, student, '/courses/c1/cases/k1/witnesses/w1?side=defense')

    expect(await screen.findByText(/As plaintiff’s counsel/)).toBeInTheDocument()
    expect(getInterview).toHaveBeenCalledWith('c1', 'k1', 'w1', 'team')
    expect(screen.queryByRole('button', { name: 'Defendant' })).not.toBeInTheDocument()
  })
})

describe('InterviewPage: ending for review', () => {
  it('ends the team interview after confirming and says it went for review', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const asked = { ...empty, turns: [turn(0, 'Where were you?', 'On break.')] }
    const endInterview = vi.fn().mockResolvedValue({ interview: empty, sentForReview: true })
    const { user } = renderPage({ getInterview: vi.fn().mockResolvedValue(asked), endInterview })

    await user.click(await screen.findByRole('button', { name: 'End interview' }))

    expect(window.confirm).toHaveBeenCalledWith('End this interview and send it to your instructor for review?')
    expect(endInterview).toHaveBeenCalledWith('c1', 'k1', 'w1')
    expect(await screen.findByRole('status')).toHaveTextContent('Sent for review.')
    expect(screen.queryByText('On break.')).not.toBeInTheDocument()
  })

  it('does nothing if the team cancels', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const asked = { ...empty, turns: [turn(0, 'Where were you?', 'On break.')] }
    const { user, service } = renderPage({ getInterview: vi.fn().mockResolvedValue(asked) })
    await user.click(await screen.findByRole('button', { name: 'End interview' }))
    expect(service.endInterview).not.toHaveBeenCalled()
  })

  it('is off before any question', async () => {
    renderPage({ getInterview: vi.fn().mockResolvedValue(empty) })
    expect(await screen.findByRole('button', { name: 'End interview' })).toBeDisabled()
  })

  it("isn't shown on the instructor's test interview", async () => {
    renderPage({ getInterview: vi.fn().mockResolvedValue(empty) }, instructor, '/courses/c1/cases/k1/witnesses/w1?side=defense')
    await screen.findByRole('heading', { level: 1, name: 'Elena Torres' })
    expect(screen.queryByRole('button', { name: 'End interview' })).not.toBeInTheDocument()
  })
})

describe('InterviewPage: the one-hour limit', () => {
  const start = new Date('2026-10-21T15:00:00.000Z')
  const minutes = (n: number) => n * 60 * 1000
  const running = (left: number) => ({
    ...empty,
    turns: [turn(0, 'Where were you?', 'On break.')],
    endsAt: new Date(start.getTime() + left).toISOString(),
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('tells the team about the limit before the first question', async () => {
    renderPage({ getInterview: vi.fn().mockResolvedValue(empty) })
    expect(await screen.findByText(/Each interview lasts up to 1 hour from your first question/)).toBeInTheDocument()
    expect(screen.queryByText(/left$/)).not.toBeInTheDocument()
  })

  it('counts down, warns at 5 minutes, and opens a fresh interview at 0:00', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(start)
    const getInterview = vi.fn().mockResolvedValueOnce(running(minutes(6))).mockResolvedValue(empty)
    renderPage({ getInterview })

    expect(await screen.findByText('6:00 left')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(minutes(1))
    })
    expect(screen.getByText('5:00 left').closest('.iv-timer')).toHaveClass('iv-timer-warning')
    expect(screen.getByRole('alert')).toHaveTextContent('5 minutes left.')

    await act(async () => {
      vi.advanceTimersByTime(minutes(5))
    })
    expect(getInterview).toHaveBeenCalledTimes(2)
    expect(await screen.findByText("Time's up. This interview was sent to your instructor for review.")).toBeInTheDocument()
    expect(screen.queryByText(/left$/)).not.toBeInTheDocument()
    expect(screen.queryByText('On break.')).not.toBeInTheDocument()
  })

  it('shows no timer on the instructor test interview', async () => {
    renderPage({ getInterview: vi.fn().mockResolvedValue({ ...empty, turns: [turn(0, 'Hi?', 'Hello.')] }) }, instructor, '/courses/c1/cases/k1/witnesses/w1?side=plaintiff')
    await screen.findByText('Hello.')
    expect(screen.queryByText(/left$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Each interview lasts up to/)).not.toBeInTheDocument()
  })
})

