import { useState, type FormEvent, type ReactNode } from 'react'
import {
  COURSE_CASE_STATUSES,
  type CaseInput,
  type CourseCase,
  type CourseCaseStatus,
} from '../../courses/types'
import { STATUS_HINT, STATUS_LABEL } from './caseStatus'

/**
 * The case title/summary form. Creating starts a draft; editing (when
 * `initial` is given) also lets the instructor change the status.
 */
export function CaseForm({
  initial,
  label,
  submitLabel,
  submittingLabel,
  onSubmit,
  onCancel,
  children,
}: {
  initial?: CourseCase
  /** Accessible name for the form, e.g. "New case". */
  label: string
  submitLabel: string
  submittingLabel: string
  /** Throw to show the error in the form. `note` is the note to students (edit form only). */
  onSubmit(input: CaseInput, note: string): Promise<void>
  onCancel(): void
  /** Extra controls after Save/Cancel (the edit form's Delete button). */
  children?: ReactNode
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [summary, setSummary] = useState(initial?.summary ?? '')
  const [status, setStatus] = useState<CourseCaseStatus>(initial?.status ?? 'draft')
  const [note, setNote] = useState(initial?.instructorNote ?? '')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await onSubmit(initial ? { title, summary, status } : { title, summary }, note)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setSubmitting(false)
    }
  }

  return (
    <form className="panel-form case-form" onSubmit={handleSubmit} aria-label={label}>
      <label className="case-title-field">
        Case title
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Rivera v. Thrill Park"
          maxLength={120}
          required
          autoFocus
        />
      </label>
      {initial && (
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as CourseCaseStatus)}>
            {COURSE_CASE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="case-summary-field">
        Summary (optional)
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="A rollercoaster stalls mid-loop and a rider is injured during the evacuation."
          maxLength={2000}
          rows={3}
        />
      </label>
      {initial && (
        <label className="case-summary-field">
          Note to students (optional)
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Focus on what the inspection log reveals about notice."
            maxLength={2000}
            rows={2}
          />
        </label>
      )}
      <p className="muted case-form-hint">
        {initial
          ? STATUS_HINT[status]
          : 'New cases start as drafts, which students cannot see. Pair students into teams next.'}
      </p>
      <div className="panel-form-actions">
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? submittingLabel : submitLabel}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {children}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}
