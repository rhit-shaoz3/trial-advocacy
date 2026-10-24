import { useState } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useCourseService } from '../../courses/CourseServiceContext'
import { casePhases, investigatorOf, type CasePhase, type CourseCase } from '../../courses/types'
import { PHASE_LABEL, phaseText } from './casePhase'

/**
 * The case's phase, shared by all of its worlds: the three steps with the
 * current one marked, and buttons to move forward or back. Hidden until the
 * case worlds launch (a draft's phase means nothing yet), and read-only once
 * the case is closed.
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
  // Without a background investigator there's no investigate phase.
  const investigator = investigatorOf(courseCase).enabled
  const phases = casePhases(investigator)
  const current = phases.indexOf(courseCase.phase)
  const previous: CasePhase | undefined = phases[current - 1]
  const next: CasePhase | undefined = phases[current + 1]
  const closed = courseCase.status === 'closed'

  if (courseCase.status === 'draft') return null

  async function moveTo(phase: CasePhase) {
    if (!window.confirm(phaseText(phase, investigator).confirm)) return
    setError(null)
    setMoving(true)
    try {
      onChanged(await service.setCasePhase(courseId, courseCase.id, phase))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setMoving(false)
    }
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
          {phaseText(courseCase.phase, investigator).hint} Every case world is in the same phase.
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
    </section>
  )
}
