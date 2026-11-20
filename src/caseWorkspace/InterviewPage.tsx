import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ChevronRight, ClipboardList, Clock, Gavel, RotateCcw, Send } from 'lucide-react'
import { Link, useOutletContext, useParams, useSearchParams } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { WitnessAvatar } from '../components/WitnessAvatar'
import { useCourseService } from '../courses/CourseServiceContext'
import type { Interview, InterviewAs, Side } from '../courses/types'
import { ROLE_LABEL } from '../courses/worldLabel'
import type { WorkspaceContext } from '../workspace/useWorkspace'
import './interview.css'
import { DictationTextarea } from '../components/Dictation'
import { Answer, ExhibitPicker, Question, Thinking } from './interview/InterviewParts'
import { clock, withExhibits, type Exhibit } from './interview/exhibits'

/** Matches INTERVIEW_MINUTES on the server: a team's interview lasts an hour from its first question. */
const INTERVIEW_MINUTES = 60
/** When the countdown turns amber and the team is warned. */
const WARNING_MS = 5 * 60 * 1000
const TIME_UP_NOTE = "Time's up. This interview was sent to your instructor for review."
/** In review lite, the new facts stand without the instructor; the team can flag them. */
const TIME_UP_NOTE_LITE = "Time's up. This interview ended, and its new facts are in the case's Reviews tab."

/**
 * A team's interview of an AI witness, as a chat: each question goes to the
 * witness and the answer comes back in the transcript. Partners share one
 * interview, always as their own team's side; the witness treats them as that
 * side's lawyers. The instructor tests the witness as the side in `?side=`
 * (chosen from the Witnesses tab), apart from every team.
 */
export function InterviewPage() {
  const { courseId = '', caseId = '', witnessId = '' } = useParams()
  const [params] = useSearchParams()
  const { user } = useAuth()
  const service = useCourseService()
  const workspace = useOutletContext<WorkspaceContext | undefined>()
  const isInstructor = user?.role === 'instructor'
  const side: Side = params.get('side') === 'defense' ? 'defense' : 'plaintiff'
  const as: InterviewAs = isInstructor ? side : 'team'

  const [interview, setInterview] = useState<Interview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  /** Case files to show the witness with the next question. */
  const [shown, setShown] = useState<Exhibit[]>([])
  /** The question waiting for the witness's answer. */
  const [asking, setAsking] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)
  /** Shown after the team ends an interview and it goes to the instructor. */
  const [sentNote, setSentNote] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(() => Date.now())
  /** When the page last asked the server to end a timed-out interview (so it doesn't ask every second). */
  const lastTimeUpFetch = useRef(0)

  const casePath = `/courses/${courseId}/cases/${caseId}`
  const backPath = isInstructor ? `${casePath}?tab=witnesses` : `${casePath}${workspace?.search ?? ''}`

  useEffect(() => {
    let cancelled = false
    setInterview(null)
    setLoadError(null)
    service
      .getInterview(courseId, caseId, witnessId, as)
      .then((d) => !cancelled && setInterview(d))
      .catch((err: Error) => !cancelled && setLoadError(err.message))
    return () => {
      cancelled = true
    }
  }, [service, courseId, caseId, witnessId, as])

  // The countdown: ticks each second while a team's interview has a deadline.
  const endsAt = interview?.endsAt ? new Date(interview.endsAt).getTime() : null
  useEffect(() => {
    if (endsAt === null) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [endsAt])
  const remaining = endsAt === null ? null : Math.max(0, endsAt - now)

  // At 0:00 the server ends the interview and sends it for review; fetching
  // it again picks up the fresh one. Retried every few seconds in case the
  // server's clock is a moment behind.
  useEffect(() => {
    if (remaining !== 0 || Date.now() - lastTimeUpFetch.current < 5000) return
    lastTimeUpFetch.current = Date.now()
    service
      .getInterview(courseId, caseId, witnessId, as)
      .then((fresh) => {
        if (fresh.endsAt === interview?.endsAt) return // not ended yet; try again shortly
        setInterview(fresh)
        setSentNote(fresh.reviewLite ? TIME_UP_NOTE_LITE : TIME_UP_NOTE)
      })
      .catch(() => {}) // the next tick tries again
  }, [remaining, now, service, courseId, caseId, witnessId, as, interview?.endsAt])

  const turns = interview?.turns.length ?? 0
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [turns, asking])

  async function ask(e?: FormEvent) {
    e?.preventDefault()
    const text = question.trim()
    if (!text || asking) return
    setError(null)
    setSentNote(null)
    const showing = shown
    setAsking(withExhibits(text, showing))
    setQuestion('')
    setShown([])
    try {
      setInterview(await service.askWitness(courseId, caseId, witnessId, as, text, showing.map((e) => e.id)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setQuestion(text)
      setShown(showing)
      // A partner may have asked meanwhile; show the transcript as it is now.
      service.getInterview(courseId, caseId, witnessId, as).then(setInterview, () => {})
    } finally {
      setAsking(null)
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void ask()
    }
  }

  async function startOver() {
    const who = isInstructor ? 'this test interview' : 'the interview for your whole team'
    const limit = interview?.limit
    const last = limit && limit.used >= limit.max ? ` It still counts as one of ${limitOwner(limit)} ${limit.max}, so there won't be another.` : ''
    if (!window.confirm(`Start over? This clears ${who}.${last}`)) return
    setError(null)
    setRestarting(true)
    try {
      setInterview(await service.restartInterview(courseId, caseId, witnessId, as))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setRestarting(false)
    }
  }

  /** Ends the team's interview and sends the new facts the witness added to the instructor. */
  async function endForReview() {
    const lite = interview?.reviewLite
    const ask = lite
      ? "End this interview? Its new facts go to the case's Reviews tab."
      : 'End this interview and send it to your instructor for review?'
    if (!window.confirm(ask)) return
    setError(null)
    setRestarting(true)
    try {
      const { interview: fresh, sentForReview } = await service.endInterview(courseId, caseId, witnessId)
      setInterview(fresh)
      setSentNote(
        !sentForReview
          ? 'The interview ended. It had no questions, so nothing was sent for review.'
          : lite
            ? "Interview ended. Its new facts are in the case's Reviews tab, where you can flag any you think are wrong."
            : "Sent for review. You'll see your instructor's rulings in the case's Reviews tab.",
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setRestarting(false)
    }
  }

  const witness = interview?.witness
  const canAsk = Boolean(interview?.canAsk) && !asking && !restarting

  return (
    <main className="ws-page iv-page">
      <nav className="cw-breadcrumb" aria-label="Breadcrumb">
        <Link to={backPath}>{isInstructor ? 'Witnesses' : 'Case'}</Link>
        <ChevronRight aria-hidden="true" />
        <span aria-current="page">{witness ? `Interview of ${witness.name}` : 'Interview'}</span>
      </nav>

      {loadError ? (
        <>
          <h1 className="ws-title">{loadError === 'Witness not found.' ? 'Witness not found' : 'Something went wrong'}</h1>
          <p className="ws-subtle">Could not open this interview. {loadError}</p>
        </>
      ) : !interview ? (
        <p className="ws-subtle">Loading interview…</p>
      ) : (
        <section className="iv" aria-label={`Interview of ${witness!.name}`}>
          <header className="iv-header">
            <div className="iv-portrait">
              <WitnessAvatar src={witness!.avatarUrl} size="xl" />
              <div>
                <span className="ws-eyebrow">
                  {isInstructor ? 'Test interview' : 'Witness interview'} · As {ROLE_LABEL[interview.side].toLowerCase()}&rsquo;s counsel
                </span>
                <h1>{witness!.name}</h1>
                {witness!.role && <p className="iv-role">{witness!.role}</p>}
                {interview.limit && <p className="iv-limit">{limitLine(interview.limit)}</p>}
              </div>
            </div>
            <div className="iv-header-actions">
              {!isInstructor && (
                <button
                  type="button"
                  className="btn-primary iv-restart"
                  onClick={endForReview}
                  disabled={restarting || Boolean(asking) || interview.turns.length === 0}
                >
                  <Gavel aria-hidden="true" />
                  End interview
                </button>
              )}
              <button
                type="button"
                className="btn-secondary iv-restart"
                onClick={startOver}
                disabled={restarting || Boolean(asking) || interview.turns.length === 0}
              >
                <RotateCcw aria-hidden="true" />
                Start over
              </button>
            </div>
          </header>

          {remaining !== null && (
            <div className={`iv-timer${remaining <= WARNING_MS ? ' iv-timer-warning' : ''}`}>
              <Clock aria-hidden="true" />
              <span aria-live="off">{clock(remaining)} left</span>
            </div>
          )}
          {remaining !== null && remaining > 0 && remaining <= WARNING_MS && (
            <p className="iv-notice iv-warning" role="alert">
              Less than 5 minutes left. The interview ends automatically and{' '}
              {interview.reviewLite ? 'its new facts go to the case’s Reviews tab.' : 'is sent to your instructor for review.'}
            </p>
          )}

          {sentNote && (
            <p className="iv-notice" role="status">
              {sentNote}
            </p>
          )}

          {!isInstructor && interview.teamTasks && interview.teamTasks.length > 0 && (
            <details className="iv-plan" open>
              <summary>
                <ClipboardList aria-hidden="true" />
                Your team&rsquo;s plan for {witness!.name}
              </summary>
              <ul>
                {interview.teamTasks.map((t) => (
                  <li key={t.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={Boolean(t.completedAt)}
                        onChange={async (e) => {
                          try {
                            await service.setTaskDone(courseId, caseId, t.id, e.target.checked)
                            setInterview(await service.getInterview(courseId, caseId, witnessId, as))
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'Something went wrong.')
                          }
                        }}
                      />
                      <span>{t.title}</span>
                    </label>
                    {t.completedBy && <small>Done · {t.completedBy}</small>}
                  </li>
                ))}
              </ul>
              <p className="iv-plan-note">From your case planner. Tick each off as you cover it; your partner sees them too.</p>
            </details>
          )}

          <ol className="iv-transcript" aria-label="Transcript">
            {interview.turns.length === 0 && !asking && (
              <li className="iv-empty">
                {isInstructor
                  ? `Ask a question to see how the witness answers ${ROLE_LABEL[interview.side].toLowerCase()}’s counsel. Test interviews are kept apart from the teams’ interviews.`
                  : `Ask your first question to start the interview. Your partner sees the same conversation. Each interview lasts up to ${INTERVIEW_MINUTES / 60} hour from your first question, then ends and ${interview.reviewLite ? 'its new facts go to the case’s Reviews tab' : 'goes to your instructor for review'}; a timer will appear in the corner.`}
              </li>
            )}
            {interview.turns.map((t) => (
              <li key={t.position} className="iv-turn">
                <Question text={t.question} name={t.askedBy} avatarUrl={t.askedByAvatarUrl} you={t.askedBy === user?.name} />
                {t.objection && (
                  <p className="iv-objection">
                    <Gavel aria-hidden="true" />
                    <span>{t.objection}</span>
                  </p>
                )}
                <Answer name={witness!.name} avatarUrl={witness!.avatarUrl}>
                  <p>{t.answer}</p>
                </Answer>
              </li>
            ))}
            {asking && (
              <li className="iv-turn" aria-busy="true">
                <Question text={asking} name={user?.name ?? null} avatarUrl={user?.avatarUrl} you />
                <Answer name={witness!.name} avatarUrl={witness!.avatarUrl} thinking>
                  <Thinking label={`${witness!.name} is answering…`} />
                </Answer>
              </li>
            )}
          </ol>
          <div ref={endRef} />

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {interview.notice ? (
            <p className="iv-notice" role="status">
              {interview.notice}
            </p>
          ) : (
            <form className="iv-composer" onSubmit={ask}>
              {(interview.exhibits?.length ?? 0) > 0 && (
                <ExhibitPicker
                  exhibits={interview.exhibits!}
                  shown={shown}
                  disabled={!canAsk}
                  onShow={(e) => setShown((prev) => [...prev, e])}
                  onRemove={(id) => setShown((prev) => prev.filter((e) => e.id !== id))}
                />
              )}
              <label className="iv-sr" htmlFor="iv-question">
                Your question
              </label>
              <DictationTextarea
                id="iv-question"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Ask ${witness!.name} a question…`}
                maxLength={2000}
                rows={2}
                disabled={!canAsk}
              />
              <button type="submit" className="btn-primary iv-send" disabled={!canAsk || !question.trim()}>
                <Send aria-hidden="true" />
                Ask
              </button>
              <small className="iv-hint">
                Enter to ask, Shift+Enter for a new line · {interview.turns.length} of {interview.maxTurns} questions
              </small>
            </form>
          )}
        </section>
      )}
    </main>
  )
}

/** "your team's" or "your", for the limit's owner. */
const limitOwner = (limit: NonNullable<Interview['limit']>) => (limit.per === 'student' ? 'your' : "your team's")

/** "Interview 1 of 2 for your team", counting this one once it has a question. */
function limitLine(limit: NonNullable<Interview['limit']>) {
  const who = limit.per === 'student' ? 'for you' : 'for your team'
  const left = Math.max(0, limit.max - limit.used)
  return `${limit.used} of ${limit.max} ${limit.max === 1 ? 'interview' : 'interviews'} used ${who} · ${left} left`
}
