import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useClassesApi } from '../classes/ClassesApiContext'
import type { JoinResult } from '../classes/types'
import { errorMessage } from './errorMessage'

interface Props {
  onClose(): void
  onJoined(): void
}

/** Modal for entering a class code. The browser's <dialog> dims the page and handles Esc. */
export function JoinClassDialog({ onClose, onJoined }: Props) {
  const api = useClassesApi()
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
      setResult(await api.joinClass(code))
      onJoined()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <dialog ref={dialogRef} className="dialog" onClose={onClose} aria-labelledby="join-heading">
      <h2 id="join-heading">Enter code</h2>

      {result ? (
        <>
          <p role="status">
            {result.status === 'enrolled' ? (
              <>
                You've joined <strong>{result.className}</strong>.
              </>
            ) : (
              <>
                Request sent to <strong>{result.className}</strong>. You'll see the class here
                once the instructor admits you.
              </>
            )}
          </p>
          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      ) : (
        <form className="form" onSubmit={handleSubmit}>
          <label>
            Class code
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

          <div className="actions">
            <button type="button" className="btn" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Checking…' : 'Submit'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  )
}
