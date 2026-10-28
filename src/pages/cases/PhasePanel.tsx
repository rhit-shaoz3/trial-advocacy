import { useState, type ReactElement } from 'react'
import { ArrowLeft, ArrowRight, FolderOpen, ListChecks, Send, Share2, Users, TriangleAlert } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { useCourseService } from '../../courses/CourseServiceContext'
import { casePhases, investigatorOf, type CasePhase, type CourseCase, type ExchangeOverview } from '../../courses/types'
import { PHASE_LABEL, phaseText } from './casePhase'

/**
 * The case's phase, shared by all of its worlds: the steps with the current
 * one marked, and buttons to move forward or back. Hidden until the case
 * worlds launch (a draft's phase means nothing yet), and read-only once the
 * case is closed. Moving into information exchange shares the initial
 * disclosures, so it asks in a dialog that lists what changes.
 */
export function PhasePanel({
  courseId,
  courseCase,
  onChanged,
}: {
  courseId: string
  courseCase: CourseCase
  onChanged(updated: CourseCase): void
}) {
  const service = useCourseService()
  const [error, setError] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)
  /** What moving to information exchange will share, while its dialog is open. */
  const [sharing, setSharing] = useState<ExchangeOverview | null>(null)
  const phases = casePhases(investigatorOf(courseCase).enabled, courseCase.exchangeReady ?? false)
  const current = phases.indexOf(courseCase.phase)
  const previous: CasePhase | undefined = phases[current - 1]
  const next: CasePhase | undefined = phases[current + 1]
  const closed = courseCase.status === 'closed'

  if (courseCase.status === 'draft') return null

  async function move(phase: CasePhase) {
    setError(null)
    setMoving(true)
    try {
      onChanged(await service.setCasePhase(courseId, courseCase.id, phase))
      setSharing(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setMoving(false)
    }
  }

  async function moveTo(phase: CasePhase) {
    if (phase === 'information_exchange' && courseCase.phase === 'introduction') {
      setError(null)
      try {
        setSharing(await service.getExchangeOverview(courseId, courseCase.id))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.')
      }
      return
    }
    if (window.confirm(phaseText(phase).confirm)) await move(phase)
  }

  return (
    <section className="phase-panel" aria-labelledby="phase-heading">
      <div className="phase-panel-body">
        <h2 id="phase-heading">Case phase</h2>
        <ol className="phase-steps" aria-label="Phases">
          {phases.map((phase, i) => (
            <li
              key={phase}
              className={i < current ? 'phase-done' : i === current ? 'phase-current' : undefined}
              aria-current={i === current ? 'step' : undefined}
            >
              <span className="phase-step-number" aria-hidden="true">
                {i + 1}
              </span>
              {PHASE_LABEL[phase]}
            </li>
          ))}
        </ol>
        <p className="muted">
          {phaseText(courseCase.phase).hint} Every case world is in the same phase.
          {closed && ' The case is closed, so its phase can no longer change.'}
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {!closed && (
        <div className="phase-actions">
          {previous && (
            <button type="button" className="link-button" onClick={() => moveTo(previous)} disabled={moving}>
              <ArrowLeft aria-hidden="true" /> Back to {PHASE_LABEL[previous]}
            </button>
          )}
          {next && (
            <button type="button" className="btn-primary" onClick={() => moveTo(next)} disabled={moving}>
              Move to {PHASE_LABEL[next]} <ArrowRight aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      {sharing && (
        <ExchangePhaseDialog
          overview={sharing}
          moving={moving}
          error={error}
          onConfirm={() => move('information_exchange')}
          onClose={() => setSharing(null)}
        />
      )}
    </section>
  )
}

const list = (names: string[]) => (names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`)
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** What moving to information exchange changes for every team, before the instructor confirms. */
function ExchangePhaseDialog({
  overview: { disclosed, submissions },
  moving,
  error,
  onConfirm,
  onClose,
}: {
  overview: ExchangeOverview
  moving: boolean
  error: string | null
  onConfirm(): void
  onClose(): void
}) {
  const missing = submissions.total - submissions.submitted
  const changes = [
    disclosed.materials.length > 0 && {
      icon: <FolderOpen />,
      title: `${count(disclosed.materials.length, 'case file becomes', 'case files become')} visible to everyone`,
      detail: `${list(disclosed.materials)}. They were for one side only.`,
    },
    disclosed.witnesses.length > 0 && {
      icon: <Users />,
      title: `${count(disclosed.witnesses.length, 'witness appears', 'witnesses appear')} on both sides`,
      detail: `${list(disclosed.witnesses)}, with their roles and pictures. Teams still can't interview the other side's witnesses.`,
    },
    {
      icon: <ListChecks />,
      title: 'Initial disclosure forms close',
      detail: 'Each student sees how their picks compare with yours.',
    },
    { icon: <Send />, title: 'Requests open', detail: 'Teams can serve subpoenas, and send interrogatories and requests for admission.' },
  ].filter((c): c is { icon: ReactElement; title: string; detail: string } => Boolean(c))

  return (
    <Modal
      eyebrow="Every case world"
      title="Move to information exchange?"
      icon={<Share2 />}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={moving}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={onConfirm} disabled={moving}>
            {moving ? 'Moving…' : 'Move to information exchange'}
          </button>
        </>
      }
    >
      <p className="muted">Here&rsquo;s what changes for every team:</p>
      <ul className="phase-changes">
        {changes.map((c) => (
          <li key={c.title}>
            <span className="phase-change-icon" aria-hidden="true">
              {c.icon}
            </span>
            <span>
              <strong>{c.title}</strong>
              <small>{c.detail}</small>
            </span>
          </li>
        ))}
      </ul>
      {missing > 0 && (
        <p className="phase-warning">
          <TriangleAlert aria-hidden="true" />
          {count(missing, "student hasn't", "students haven't")} submitted their initial disclosures. Their forms close
          too, and they&rsquo;ll see your picks.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}
