import { useEffect, useRef, useState, type FormEvent } from 'react'
import { errorMessage } from '../api/useLoad'
import { useCourseService } from '../courses/CourseServiceContext'
import type { JoinResult } from '../courses/types'

interface Props {
  onClose(): void
  onJoined(): void
}

/** Modal for entering a course's entry code. The browser's <dialog> dims the page and handles Esc. */
export function JoinCourseDialog({ onClose, onJoined }: Props) {
  const service = useCourseService()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<JoinResult | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      setResult(await service.joinCourse(code))
      onJoined()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  const courseName = result && `${result.course.code}: ${result.course.title}`
  return (
    <dialog ref={dialogRef} className="dialog" onClose={onClose} aria-labelledby="join-heading">
      <h2 id="join-heading">Enter code</h2>

      {result ? (
        <>
          <p role="status">
            {result.status === 'joined' ? (
              <>
                You've joined <strong>{courseName}</strong>.
              </>
            ) : (
              <>
                Request sent to <strong>{courseName}</strong>. You'll see the course here once the
                instructor admits you.
              </>
            )}
          </p>
          <div className="case-actions">
            <button type="button" className="ws-btn ws-btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      ) : (
        <form className="case-form" onSubmit={handleSubmit}>
          <label>
            Course code
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              autoFocus
              required
            />
          </label>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <div className="case-actions">
            <button type="button" className="ws-btn ws-btn-secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="ws-btn ws-btn-primary" disabled={submitting}>
              {submitting ? 'Checking…' : 'Submit'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  )
}
