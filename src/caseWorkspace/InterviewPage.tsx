import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ChevronRight, RotateCcw, Send } from 'lucide-react'
import { Link, useOutletContext, useParams, useSearchParams } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { useCourseService } from '../courses/CourseServiceContext'
import type { Interview, InterviewAs, Side } from '../courses/types'
import { ROLE_LABEL } from '../courses/worldLabel'
import type { WorkspaceContext } from '../workspace/useWorkspace'
import './interview.css'

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
  /** The question waiting for the witness's answer. */
  const [asking, setAsking] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

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

  const turns = interview?.turns.length ?? 0
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [turns, asking])

  async function ask(e?: FormEvent) {
    e?.preventDefault()
    const text = question.trim()
    if (!text || asking) return
    setError(null)
    setAsking(text)
    setQuestion('')
    try {
      setInterview(await service.askWitness(courseId, caseId, witnessId, as, text))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setQuestion(text)
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
    if (!window.confirm(`Start over? This clears ${who}.`)) return
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
            <div>
              <span className="ws-eyebrow">
                {isInstructor ? 'Test interview' : 'Witness interview'} · As {ROLE_LABEL[interview.side].toLowerCase()}&rsquo;s counsel
              </span>
              <h1>{witness!.name}</h1>
              {witness!.role && <p className="iv-role">{witness!.role}</p>}
            </div>
            <div className="iv-header-actions">
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

          <ol className="iv-transcript" aria-label="Transcript">
            {interview.turns.length === 0 && !asking && (
              <li className="iv-empty">
                {isInstructor
                  ? `Ask a question to see how the witness answers ${ROLE_LABEL[interview.side].toLowerCase()}’s counsel. Test interviews are kept apart from the teams’ interviews.`
                  : 'Ask your first question to start the interview. Your partner sees the same conversation.'}
              </li>
            )}
            {interview.turns.map((t) => (
              <li key={t.position} className="iv-turn">
                <div className="iv-q">
                  <span className="iv-label">Q.</span>
                  <p>{t.question}</p>
                  {t.askedBy && <small>{t.askedBy}</small>}
                </div>
                {t.objection && <p className="iv-objection">{t.objection}</p>}
                <div className="iv-a">
                  <span className="iv-label">A.</span>
                  <p>{t.answer}</p>
                </div>
              </li>
            ))}
            {asking && (
              <li className="iv-turn" aria-busy="true">
                <div className="iv-q">
                  <span className="iv-label">Q.</span>
                  <p>{asking}</p>
                </div>
                <div className="iv-a iv-thinking" role="status">
                  <span className="iv-label">A.</span>
                  <p>{witness!.name} is answering…</p>
                </div>
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
              <label className="iv-sr" htmlFor="iv-question">
                Your question
              </label>
              <textarea
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
