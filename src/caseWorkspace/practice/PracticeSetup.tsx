import { useEffect, useState, type FormEvent } from 'react'
import { ChevronRight, Lightbulb, Play } from 'lucide-react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router'
import { DictationTextarea } from '../../components/Dictation'
import { WitnessAvatar } from '../../components/WitnessAvatar'
import { useCourseService } from '../../courses/CourseServiceContext'
import { DEFAULT_PRACTICE, type CaseWorkspace, type Cooperation, type PracticeOverview, type PracticeType } from '../../courses/types'
import type { WorkspaceContext } from '../../workspace/useWorkspace'
import { COOPERATION_LABEL, PRACTICE_INTRO, PRACTICE_TYPE_HINT, PRACTICE_TYPE_LABEL, practiceTypesFor } from './practiceLabels'
import '../interview.css'
import './practice.css'

/**
 * Setting up a practice session with a witness: where it's set (the settings
 * the witness offers), what the student wants to practice, and, if they like,
 * how the witness behaves. Earlier sessions with the witness are listed to
 * pick up again.
 */
export function PracticeSetup() {
  const { courseId = '', caseId = '', witnessId = '' } = useParams()
  const service = useCourseService()
  const navigate = useNavigate()
  const search = useOutletContext<WorkspaceContext | undefined>()?.search ?? ''
  const [workspace, setWorkspace] = useState<CaseWorkspace | null>(null)
  const [overview, setOverview] = useState<PracticeOverview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [type, setType] = useState<PracticeType | ''>('')
  const [goal, setGoal] = useState('')
  const [cooperation, setCooperation] = useState<Cooperation>('regular')
  const [toneNotes, setToneNotes] = useState('')
  const [priorTestimony, setPriorTestimony] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([service.getMyCaseWorkspace(courseId, caseId), service.listPractice(courseId, caseId)])
      .then(([w, o]) => {
        if (cancelled) return
        setWorkspace(w)
        setOverview(o)
      })
      .catch((err: Error) => !cancelled && setLoadError(err.message))
    return () => {
      cancelled = true
    }
  }, [service, courseId, caseId])

  const casePath = `/courses/${courseId}/cases/${caseId}`
  const witness = workspace?.witnesses.find((w) => w.id === witnessId)
  const types = witness && workspace ? practiceTypesFor(witness.side, workspace.side) : []
  const chosen = type || types[0]
  const practice = workspace?.practice ?? DEFAULT_PRACTICE
  const left = overview ? Math.max(0, overview.limit.max - overview.limit.used) : 0
  const earlier = overview?.sessions.filter((s) => s.witnessId === witnessId) ?? []

  async function start(e: FormEvent) {
    e.preventDefault()
    if (!chosen || !goal.trim()) return
    setError(null)
    setStarting(true)
    try {
      const session = await service.startPractice(courseId, caseId, {
        witnessId,
        type: chosen,
        goal: goal.trim(),
        cooperation,
        toneNotes: toneNotes.trim(),
        ...((chosen === 'cross' || chosen === 'redirect') && { priorTestimony: priorTestimony.trim() }),
      })
      navigate(`${casePath}/practice/${session.id}${search}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setStarting(false)
    }
  }

  return (
    <main className="ws-page iv-page pr-page">
      <nav className="cw-breadcrumb" aria-label="Breadcrumb">
        <Link to={`${casePath}${search}`}>Case</Link>
        <ChevronRight aria-hidden="true" />
        <span aria-current="page">{witness ? `Practice with ${witness.name}` : 'Practice'}</span>
      </nav>
      {loadError ? (
        <>
          <h1 className="ws-title">Practice isn’t available</h1>
          <p className="ws-subtle">{loadError}</p>
        </>
      ) : !workspace || !overview ? (
        <p className="ws-subtle">Loading…</p>
      ) : !witness || !witness.canInterview || !practice.enabled ? (
        <>
          <h1 className="ws-title">Practice isn’t available</h1>
          <p className="ws-subtle">
            {!practice.enabled
              ? 'Your instructor hasn’t turned on practice for this case.'
              : witness
                ? `You can’t practice with ${witness.name} right now.`
                : 'Witness not found.'}
          </p>
        </>
      ) : (
        <section className="iv pr" aria-label={`Practice with ${witness.name}`}>
          <header className="iv-header">
            <div className="iv-portrait">
              <WitnessAvatar src={witness.avatarUrl} size="xl" />
              <div>
                <span className="ws-eyebrow">Practice · Doesn’t count toward your interviews</span>
                <h1>{witness.name}</h1>
                {witness.role && <p className="iv-role">{witness.role}</p>}
                <p className="iv-limit">
                  {overview.limit.used} of {overview.limit.max} practice {overview.limit.max === 1 ? 'session' : 'sessions'} used in this case · {left}{' '}
                  left
                </p>
              </div>
            </div>
          </header>

          <form className="pr-setup" onSubmit={start}>
            <p className="pr-intro">
              <Lightbulb aria-hidden="true" />
              <span>{PRACTICE_INTRO}</span>
            </p>

            <div className="pr-field">
              <label className="pr-field-label" htmlFor="pr-type">
                Setting
              </label>
              <select id="pr-type" value={chosen} onChange={(e) => setType(e.target.value as PracticeType)} aria-describedby="pr-type-hint">
                {types.map((t) => (
                  <option key={t} value={t}>
                    {PRACTICE_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
              <span id="pr-type-hint" className="field-hint">
                {PRACTICE_TYPE_HINT[chosen]}
              </span>
            </div>

            <div className="pr-field">
              <label className="pr-field-label" htmlFor="pr-goal">
                What do you want to practice?
              </label>
              <DictationTextarea
                id="pr-goal"
                aria-describedby="pr-goal-hint"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={3}
                maxLength={2000}
                required
                placeholder="The fact you want to get out of the witness, or the part of the examination you want to work on."
              />
              <span id="pr-goal-hint" className="field-hint">
                The coach uses this to tell you when a question won’t get you there.
              </span>
            </div>

            {(chosen === 'cross' || chosen === 'redirect') && (
              <div className="pr-field">
                <label className="pr-field-label" htmlFor="pr-prior">
                  What the earlier examination covered (optional)
                </label>
                <textarea
                  id="pr-prior"
                  aria-describedby="pr-prior-hint"
                  value={priorTestimony}
                  onChange={(e) => setPriorTestimony(e.target.value)}
                  rows={3}
                  maxLength={4000}
                />
                <span id="pr-prior-hint" className="field-hint">
                  {chosen === 'cross' ? 'Cross' : 'Redirect'} starts partway through the trial. Left blank, the witness assumes the
                  earlier testimony matched their own statements.
                </span>
              </div>
            )}

            <details>
              <summary>The witness’s demeanor (optional)</summary>
              <div className="pr-field">
                <label className="pr-field-label" htmlFor="pr-cooperation">
                  Cooperation
                </label>
                <select
                  id="pr-cooperation"
                  aria-describedby="pr-cooperation-hint"
                  value={cooperation}
                  onChange={(e) => setCooperation(e.target.value as Cooperation)}
                >
                  {(Object.keys(COOPERATION_LABEL) as Cooperation[]).map((c) => (
                    <option key={c} value={c}>
                      {COOPERATION_LABEL[c]}
                    </option>
                  ))}
                </select>
                <span id="pr-cooperation-hint" className="field-hint">
                  This changes the witness’s attitude, never the truth.
                </span>
              </div>
              <div className="pr-field">
                <label className="pr-field-label" htmlFor="pr-tone">
                  Tone
                </label>
                <input
                  id="pr-tone"
                  value={toneNotes}
                  onChange={(e) => setToneNotes(e.target.value)}
                  maxLength={500}
                  placeholder="For example: nervous, talks too much, defensive about the timeline"
                />
              </div>
            </details>

            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="pr-setup-actions">
              <button type="submit" className="btn-primary iv-send" disabled={starting || !goal.trim() || left === 0}>
                <Play aria-hidden="true" />
                Start practice
              </button>
              {left === 0 && <span className="ws-subtle">You’ve used your practice sessions in this case.</span>}
            </div>
          </form>

          {earlier.length > 0 && (
            <section aria-labelledby="pr-earlier-title">
              <h2 id="pr-earlier-title" className="cw-section-title">
                Your earlier practice with {witness.name}
              </h2>
              <ul className="pr-earlier">
                {earlier.map((s) => (
                  <li key={s.id}>
                    <Link to={`${casePath}/practice/${s.id}${search}`}>{PRACTICE_TYPE_LABEL[s.type]}</Link>
                    <span className="ws-subtle">
                      {s.goal.length > 80 ? `${s.goal.slice(0, 80)}…` : s.goal} · {s.turns} {s.turns === 1 ? 'turn' : 'turns'}
                      {s.endedAt ? ' · ended' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </section>
      )}
    </main>
  )
}
