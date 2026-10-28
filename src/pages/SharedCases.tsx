import { useEffect, useState } from 'react'
import { Inbox } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Modal } from '../components/Modal'
import { useCourseService } from '../courses/CourseServiceContext'
import type { CourseCase, SharedCase, TaughtCourse } from '../courses/types'
import './cases/copyCase.css'

/**
 * Cases other instructors shared with this one, on their home page: decline
 * one and it's gone; accept it into one of their classes and it's copied
 * there, opening on its teams and worlds.
 */
export function SharedCases({ courses }: { courses: TaughtCourse[] | null }) {
  const service = useCourseService()
  const navigate = useNavigate()
  const [shares, setShares] = useState<SharedCase[]>([])
  const [accepting, setAccepting] = useState<SharedCase | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    service
      .listSharedCases()
      .then((list) => !cancelled && setShares(list))
      .catch(() => {}) // the notices are extra; the page works without them
    return () => {
      cancelled = true
    }
  }, [service])

  async function decline(share: SharedCase) {
    setError(null)
    try {
      await service.declineSharedCase(share.id)
      setShares((prev) => prev.filter((s) => s.id !== share.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  if (shares.length === 0) return null
  return (
    <section className="shared-cases" aria-label="Cases shared with you">
      {shares.map((s) => (
        <div key={s.id} className="shared-case" role="status">
          <Inbox aria-hidden="true" />
          <p>
            <strong>
              {s.fromName || s.fromEmail || 'An instructor'} shared <em>{s.caseTitle}</em> with you.
            </strong>{' '}
            {s.summary}
          </p>
          <div className="shared-case-actions">
            <button type="button" className="btn-secondary" onClick={() => decline(s)}>
              Decline
            </button>
            <button type="button" className="btn-primary" onClick={() => setAccepting(s)}>
              Accept
            </button>
          </div>
        </div>
      ))}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {accepting && (
        <AcceptDialog
          share={accepting}
          courses={courses}
          onClose={() => setAccepting(null)}
          onAccepted={(courseId, copy) => navigate(`/courses/${courseId}/cases/${copy.id}`, { state: { courseCase: copy } })}
        />
      )}
    </section>
  )
}

function AcceptDialog({
  share,
  courses,
  onClose,
  onAccepted,
}: {
  share: SharedCase
  courses: TaughtCourse[] | null
  onClose(): void
  onAccepted(courseId: string, copy: CourseCase): void
}) {
  const service = useCourseService()
  const [courseId, setCourseId] = useState(courses?.[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const none = courses !== null && courses.length === 0

  async function accept() {
    setBusy(true)
    setError(null)
    try {
      const result = await service.acceptSharedCase(share.id, courseId)
      onAccepted(result.courseId, result.case)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  return (
    <Modal
      eyebrow="Shared with you"
      title={`Add ${share.caseTitle}`}
      icon={<Inbox />}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={accept} disabled={busy || !courseId}>
            {busy ? 'Adding…' : 'Add to class'}
          </button>
        </>
      }
    >
      <div className="copy-form">
        {none ? (
          <p>Create a class first, then come back to add this case to it.</p>
        ) : (
          <label>
            Which class is this case for?
            <select value={courseId} onChange={(e) => setCourseId(e.target.value)} disabled={!courses}>
              {(courses ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.title} ({c.term})
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="muted">
          You get your own copy: the details, important facts, witnesses, case files (for instructors only, except the
          starting file){share.includeTasks ? ', tasks' : ''}, and the information exchange setup. Next you&rsquo;ll put
          the class&rsquo;s students into teams and worlds.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
