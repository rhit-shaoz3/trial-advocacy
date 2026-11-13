import { useEffect, useState } from 'react'
import { BookOpen, Download } from 'lucide-react'
import { useCourseService } from '../../../courses/CourseServiceContext'
import { worldLabel } from '../../../courses/worldLabel'
import type { CourtBinder } from '../../../courses/types'

const exhibitCount = (n: number) => `${n} ${n === 1 ? 'exhibit' : 'exhibits'} for trial`

/**
 * What goes to court: a binder for each case world, once its joint exhibit
 * list is final. It holds only what the two teams agreed on: the complaint,
 * the joint list, the exhibits in label order with their stickers, and the
 * rulings on them.
 */
export function CourtBinders({ courseId, caseId }: { courseId: string; caseId: string }) {
  const service = useCourseService()
  const [binders, setBinders] = useState<CourtBinder[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    service
      .listCourtBinders(courseId, caseId)
      .then((b) => !cancelled && setBinders(b))
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [service, courseId, caseId])

  return (
    <section className="course-section tp-section" aria-labelledby="binders-heading">
      <div className="section-header">
        <div>
          <span className="ws-eyebrow">For the trial</span>
          <h2 id="binders-heading">Court binders</h2>
        </div>
      </div>
      <p className="muted">
        One PDF for each case world, of what its two teams agreed on: the complaint, the joint exhibit list, each exhibit for
        trial in order with its label (Plaintiff’s Exhibit 1, 2, …; Defendant’s Exhibit A, B, …), and your rulings on the
        exhibits. A binder is ready once its world’s joint exhibit list is final.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!binders ? (
        !error && <p className="muted">Loading…</p>
      ) : binders.length === 0 ? (
        <p className="muted">This case has no case worlds yet.</p>
      ) : (
        <ul className="tp-list">
          {binders.map((b) => (
            <li key={b.matchupId} className="tp-row">
              <span className="ws-icon-tile ws-icon-tile-sm ws-tone-blue" aria-hidden="true">
                <BookOpen />
              </span>
              <div className="tp-row-text">
                <strong>
                  World {worldLabel(b.worldNumber)} · Team {b.teams.plaintiff} v. Team {b.teams.defense}
                </strong>
                {b.finalizedAt ? (
                  <small>{exhibitCount(b.exhibits)}</small>
                ) : (
                  <small className="tp-warning">The joint exhibit list isn’t final yet.</small>
                )}
              </div>
              {b.finalizedAt && (
                <a
                  className="btn-secondary tp-download"
                  href={service.courtBinderUrl(courseId, caseId, b.matchupId)}
                  download
                  aria-label={`Download World ${worldLabel(b.worldNumber)}’s court binder`}
                >
                  <Download aria-hidden="true" /> PDF
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
