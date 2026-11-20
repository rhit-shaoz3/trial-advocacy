import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { BookOpen, ChevronRight, Clock, CornerDownLeft, Flag, Pencil, RotateCcw, Send } from 'lucide-react'
import { Link, useOutletContext, useParams } from 'react-router'
import { useAuth } from '../../auth/useAuth'
import { DictationTextarea } from '../../components/Dictation'
import { WitnessAvatar } from '../../components/WitnessAvatar'
import { useCourseService } from '../../courses/CourseServiceContext'
import type { PracticeSession, PracticeTurnKind } from '../../courses/types'
import type { WorkspaceContext } from '../../workspace/useWorkspace'
import { Answer, ExhibitPicker, Question, Thinking } from '../interview/InterviewParts'
import { clock, splitExhibits, withExhibits, type Exhibit } from '../interview/exhibits'
import { PracticeTranscript } from './PracticeTranscript'
import { COOPERATION_LABEL, PRACTICE_TYPE_LABEL, isTrialExam } from './practiceLabels'
import '../interview.css'
import './practice.css'

/** When the countdown turns amber. */
const WARNING_MS = 5 * 60 * 1000

/**
 * A practice session: the student's questions, the witness's answers, and
 * the coach's notes beside them. On direct and redirect a leading question is
 * held, and the composer offers to edit it or ask it as written; at trial an
 * objection waits for the student's response, or a new question withdraws
 * the one objected to. Only the student sees it, and it changes nothing in
 * the case.
 */
export function PracticePage() {
  const { courseId = '', caseId = '', sessionId = '' } = useParams()
  const { user } = useAuth()
  const service = useCourseService()
  const search = useOutletContext<WorkspaceContext | undefined>()?.search ?? ''
  const [session, setSession] = useState<PracticeSession | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [shown, setShown] = useState<Exhibit[]>([])
  /** The turn waiting for its reply. */
  const [asking, setAsking] = useState<{ kind: PracticeTurnKind; text: string } | null>(null)
  /** The student chose to drop the question objected to and ask another. */
  const [withdrawing, setWithdrawing] = useState(false)
  const [ending, setEnding] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const endRef = useRef<HTMLDivElement>(null)
  const casePath = `/courses/${courseId}/cases/${caseId}`

  /** Shows the session; a held question comes back to the composer, to edit. */
  const show = (s: PracticeSession) => {
    setSession(s)
    if (s.pending === 'hold') setText(splitExhibits(s.turns.at(-1)!.text).rest)
  }

  useEffect(() => {
    let cancelled = false
    service
      .getPractice(courseId, caseId, sessionId)
      .then((s) => {
        if (cancelled) return
        setSession(s)
        if (s.pending === 'hold') setText(splitExhibits(s.turns.at(-1)!.text).rest)
      })
      .catch((err: Error) => !cancelled && setLoadError(err.message))
    return () => {
      cancelled = true
    }
  }, [service, courseId, caseId, sessionId])

  const turns = session?.turns.length ?? 0
  const held = session?.pending === 'hold' ? session.turns.at(-1)!.text : null
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [turns, asking])

  const endsAt = session?.endsAt && !session.endedAt ? new Date(session.endsAt).getTime() : null
  useEffect(() => {
    if (endsAt === null) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [endsAt])
  const remaining = endsAt === null ? null : Math.max(0, endsAt - now)
  // At 0:00 the server ends the session; reading it again shows that.
  useEffect(() => {
    if (remaining === 0) service.getPractice(courseId, caseId, sessionId).then(setSession, () => {})
  }, [remaining, service, courseId, caseId, sessionId])

  const mode = session?.pending === 'hold' ? 'hold' : session?.pending === 'objection' && !withdrawing ? 'objection' : 'question'

  async function send(kind: PracticeTurnKind) {
    const typed = text.trim()
    if (asking || (kind !== 'as_written' && !typed)) return
    setError(null)
    const showing = kind === 'objection_response' ? [] : shown
    const asked = kind === 'as_written' ? held! : kind === 'objection_response' ? typed : withExhibits(typed, showing)
    setAsking({ kind, text: asked })
    setText('')
    setShown([])
    try {
      setWithdrawing(false)
      show(await service.takePracticeTurn(courseId, caseId, sessionId, { kind, text: typed, exhibitIds: showing.map((e) => e.id) }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setText(typed)
      setShown(showing)
      service.getPractice(courseId, caseId, sessionId).then(setSession, () => {})
    } finally {
      setAsking(null)
    }
  }

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    void send(mode === 'hold' ? 'edited' : mode === 'objection' ? 'objection_response' : 'question')
  }
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  async function end() {
    if (!window.confirm('End this practice session? It stays in your learning library.')) return
    setEnding(true)
    setError(null)
    try {
      setSession(await service.endPractice(courseId, caseId, sessionId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setEnding(false)
    }
  }

  const witness = session?.witness
  const canAsk = Boolean(session?.canAsk) && !asking && !ending
  const you = { name: user?.name ?? null, avatarUrl: user?.avatarUrl }

  return (
    <main className="ws-page iv-page pr-page">
      <nav className="cw-breadcrumb" aria-label="Breadcrumb">
        <Link to={`${casePath}${search}`}>Case</Link>
        <ChevronRight aria-hidden="true" />
        <span aria-current="page">{witness ? `Practice with ${witness.name}` : 'Practice'}</span>
      </nav>

      {loadError ? (
        <>
          <h1 className="ws-title">Practice session not found</h1>
          <p className="ws-subtle">{loadError}</p>
        </>
      ) : !session || !witness ? (
        <p className="ws-subtle">Loading practice…</p>
      ) : (
        <section className="iv pr" aria-label={`Practice with ${witness.name}`}>
          <header className="iv-header">
            <div className="iv-portrait">
              <WitnessAvatar src={witness.avatarUrl} size="xl" />
              <div>
                <span className="ws-eyebrow">Practice · {PRACTICE_TYPE_LABEL[session.type]} · Doesn’t count toward your interviews</span>
                <h1>{witness.name}</h1>
                {witness.role && <p className="iv-role">{witness.role}</p>}
                <p className="iv-limit">
                  {session.limit.used} of {session.limit.max} practice {session.limit.max === 1 ? 'session' : 'sessions'} used in this case
                </p>
              </div>
            </div>
            <div className="iv-header-actions">
              {/* In the header, not floating over the transcript, where it would cover the coach's notes. */}
              {remaining !== null && (
                <div className={`iv-timer pr-timer${remaining <= WARNING_MS ? ' iv-timer-warning' : ''}`}>
                  <Clock aria-hidden="true" />
                  <span aria-live="off">{clock(remaining)} left</span>
                </div>
              )}
              {!session.endedAt && (
                <button type="button" className="btn-secondary iv-restart" onClick={end} disabled={ending || Boolean(asking) || turns === 0}>
                  <Flag aria-hidden="true" />
                  End practice
                </button>
              )}
              <Link to={`${casePath}/witnesses/${witness.id}/practice${search}`} className="btn-secondary iv-restart">
                <RotateCcw aria-hidden="true" />
                New session
              </Link>
            </div>
          </header>

          <div className="pr-goal">
            <strong>You’re practicing</strong>
            <p>{session.goal}</p>
            <small>
              Witness: {COOPERATION_LABEL[session.cooperation].toLowerCase()}
              {session.toneNotes ? ` · ${session.toneNotes}` : ''}
              {isTrialExam(session.type) && session.opposingCounsel ? ` · Opposing counsel: ${session.opposingCounsel}` : ''}
            </small>
          </div>

          <PracticeTranscript session={session} you={you}>
            {turns === 0 && !asking && (
              <li className="iv-empty">
                Ask your first question. The coach’s notes appear beside your questions
                {isTrialExam(session.type) ? '; opposing counsel objects when a real lawyer would, and the judge rules' : ''}. Only you
                see this session, and nothing in it reaches the case.
              </li>
            )}
            {asking && (
              <li className="pr-turn" aria-busy="true">
                <div className="pr-q">
                  <Question text={asking.text} name={you.name} avatarUrl={you.avatarUrl} you />
                </div>
                <div className="pr-rest">
                  <Answer name={witness.name} avatarUrl={witness.avatarUrl} thinking>
                    <Thinking label={asking.kind === 'objection_response' ? 'The judge is ruling…' : `${witness.name} is answering…`} />
                  </Answer>
                </div>
              </li>
            )}
          </PracticeTranscript>
          <div ref={endRef} />

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {session.notice ? (
            <div className="iv-notice" role="status">
              <p>{session.notice}</p>
              {session.endedAt && (
                <p>
                  <Link to={`/courses/${courseId}/library${search}`}>
                    <BookOpen aria-hidden="true" className="pr-inline-icon" /> Open your learning library
                  </Link>
                </p>
              )}
            </div>
          ) : (
            <form className="iv-composer" onSubmit={submit}>
              {mode === 'hold' && (
                <span className="pr-composer-label" id="pr-composer-label">
                  Edit your question, or ask it as written
                </span>
              )}
              {mode === 'objection' && (
                <span className="pr-composer-label" id="pr-composer-label">
                  Your response to the objection
                </span>
              )}
              {mode !== 'objection' && (session.exhibits?.length ?? 0) > 0 && (
                <ExhibitPicker
                  exhibits={session.exhibits!}
                  shown={shown}
                  disabled={!canAsk}
                  onShow={(e) => setShown((prev) => [...prev, e])}
                  onRemove={(id) => setShown((prev) => prev.filter((e) => e.id !== id))}
                />
              )}
              <label className="iv-sr" htmlFor="pr-text">
                {mode === 'objection' ? 'Your response to the objection' : mode === 'hold' ? 'Your edited question' : 'Your question'}
              </label>
              <DictationTextarea
                id="pr-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={mode === 'objection' ? 'Tell the judge why the question is proper…' : `Ask ${witness.name} a question…`}
                maxLength={2000}
                rows={2}
                disabled={!canAsk}
              />
              <div className="pr-composer-actions">
                <button type="submit" className="btn-primary iv-send" disabled={!canAsk || !text.trim()}>
                  {mode === 'hold' ? <Pencil aria-hidden="true" /> : <Send aria-hidden="true" />}
                  {mode === 'hold' ? 'Ask edited question' : mode === 'objection' ? 'Respond' : 'Ask'}
                </button>
                {mode === 'hold' && (
                  <button type="button" className="btn-secondary" disabled={!canAsk} onClick={() => void send('as_written')}>
                    <CornerDownLeft aria-hidden="true" />
                    Ask as written
                  </button>
                )}
                {mode === 'objection' && (
                  <button type="button" className="btn-secondary" disabled={!canAsk} onClick={() => setWithdrawing(true)}>
                    <RotateCcw aria-hidden="true" />
                    Withdraw and ask another
                  </button>
                )}
              </div>
              <small className="iv-hint">
                Enter to send, Shift+Enter for a new line · {turns} of {session.maxTurns} turns
              </small>
            </form>
          )}
        </section>
      )}
    </main>
  )
}
