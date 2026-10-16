import { useEffect, useState } from 'react'
import { Circle, CircleCheck, Rocket } from 'lucide-react'
import { useCourseService } from '../../../courses/CourseServiceContext'
import type { CourseCase, LaunchCheck } from '../../../courses/types'

/**
 * Shown on a draft case: what still has to happen before the case worlds can
 * launch, and the button that launches them all (making the case active).
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
      onLaunched(await service.launchCase(courseId, caseId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setLaunching(false)
    }
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
