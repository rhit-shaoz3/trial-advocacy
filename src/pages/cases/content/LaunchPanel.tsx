import { useEffect, useRef, useState } from 'react'
import { Circle, CircleCheck, Rocket } from 'lucide-react'
import { useCourseService } from '../../../courses/CourseServiceContext'
import type { CourseCase, LaunchCheck } from '../../../courses/types'
import { CALM_LIFTOFF_MS, LIFTOFF_MS, reducedMotion } from './liftoff'

/**
 * Shown on a draft case: what still has to happen before the case worlds can
 * launch, and the button that launches them all (making the case active). On
 * launch a rocket lifts off, then `onLaunched` swaps in the phase panel.
 */
export function LaunchPanel({
  courseId,
  caseId,
  refreshKey,
  onLaunched,
}: {
  courseId: string
  caseId: string
  /** Change it to re-check (after teams, worlds, or materials change). */
  refreshKey: number
  onLaunched(launched: CourseCase): void
}) {
  const service = useCourseService()
  const [checks, setChecks] = useState<LaunchCheck[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [launching, setLaunching] = useState(false)
  /** The launched case, while the rocket lifts off. */
  const [launched, setLaunched] = useState<CourseCase | null>(null)
  const onLaunchedRef = useRef(onLaunched)
  useEffect(() => {
    onLaunchedRef.current = onLaunched
  })

  useEffect(() => {
    if (!launched) return
    const timer = setTimeout(() => onLaunchedRef.current(launched), reducedMotion() ? CALM_LIFTOFF_MS : LIFTOFF_MS)
    return () => clearTimeout(timer)
  }, [launched])

  useEffect(() => {
    let cancelled = false
    service
      .getLaunchChecks(courseId, caseId)
      .then((c) => !cancelled && setChecks(c))
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [service, courseId, caseId, refreshKey])

  const ready = checks !== null && checks.every((c) => c.ok)

  async function handleLaunch() {
    const confirmed = window.confirm(
      'Launch every case world now? The case becomes active and each student sees their team, ' +
        'role, opponents, and the material for their side.',
    )
    if (!confirmed) return
    setError(null)
    setLaunching(true)
    try {
      setLaunched(await service.launchCase(courseId, caseId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setLaunching(false)
    }
  }

  if (launched) {
    return (
      <section className="launch-panel launch-liftoff" aria-labelledby="launch-heading">
        <div className="liftoff-stage" aria-hidden="true">
          <span className="liftoff-smoke">
            <span />
            <span />
            <span />
            <span />
          </span>
          <span className="liftoff-rocket">
            <Rocket className="liftoff-ship" />
            <span className="liftoff-flame" />
          </span>
          <span className="liftoff-sparkles">
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </span>
        </div>
        <div className="liftoff-text">
          <h2 id="launch-heading">Liftoff!</h2>
          <p role="status">Every case world is live. Students can now see their team, role, opponents and material.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="launch-panel" aria-labelledby="launch-heading">
      <div>
        <h2 id="launch-heading">Launch case worlds</h2>
        <p className="muted">
          Students can&rsquo;t see this case until it launches. You can keep adding material afterwards.
        </p>
        {checks && (
          <ul className="launch-checks" aria-label="Launch checklist">
            {checks.map((c) => (
              <li key={c.key} className={c.ok ? 'launch-ok' : undefined}>
                {c.ok ? <CircleCheck aria-label="Done" /> : <Circle aria-label="To do" />}
                {c.message}
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <button type="button" className="btn-primary launch-button" onClick={handleLaunch} disabled={!ready || launching}>
        <Rocket aria-hidden="true" />
        {launching ? 'Launching…' : 'Launch case worlds'}
      </button>
    </section>
  )
}
