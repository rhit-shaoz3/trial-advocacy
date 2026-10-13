import { useState, type FormEvent, type ReactNode } from 'react'
import { SEASONS, type NewCourseInput, type Season } from '../../courses/types'

/** Best guess at the term an instructor is setting up now (quarter system). */
function currentTerm(now = new Date()): { season: Season; year: number } {
  const month = now.getMonth() // 0 = January
  const season = month >= 8 ? 'Fall' : month >= 5 ? 'Summer' : month >= 2 ? 'Spring' : 'Winter'
  return { season, year: now.getFullYear() }
}

/** The course number/title/term form, used to create a course and to edit one. */
export function CourseForm({
  initial,
  label,
  submitLabel,
  submittingLabel,
  onSubmit,
  onCancel,
  children,
}: {
  /** Omit to start blank, on the current term. */
  initial?: NewCourseInput
  /** Accessible name for the form, e.g. "Create course". */
  label: string
  submitLabel: string
  submittingLabel: string
  /** Throw to show the error in the form. */
  onSubmit(input: NewCourseInput): Promise<void>
  onCancel(): void
  /** Extra controls after Save/Cancel (the edit form's Delete button). */
  children?: ReactNode
}) {
  const [code, setCode] = useState(initial?.code ?? '')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [season, setSeason] = useState<Season>(() => initial?.season ?? currentTerm().season)
  const [year, setYear] = useState(() => String(initial?.year ?? currentTerm().year))
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await onSubmit({ code, title, season, year: Number(year) })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setSubmitting(false)
    }
  }

  return (
    <form className="panel-form" onSubmit={handleSubmit} aria-label={label}>
      <label>
        Course number
        <input
          type="text"
          className="course-code-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="LAW 540"
          maxLength={20}
          required
          autoFocus
        />
      </label>
      <label>
        Course title
        <input
          type="text"
          className="course-title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Trial Advocacy"
          maxLength={120}
          required
        />
      </label>
      <label>
        Term
        <select value={season} onChange={(e) => setSeason(e.target.value as Season)}>
          {SEASONS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <label>
        Year
        <input
          type="number"
          className="year-input"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          min={2000}
          max={2100}
          required
        />
      </label>
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
