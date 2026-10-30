import { useState, type FormEvent, type ReactNode } from 'react'
import {
  COURSE_CASE_STATUSES,
  type CaseInput,
  type CourseCase,
  type CourseCaseStatus,
} from '../../courses/types'
import { STATUS_HINT, STATUS_LABEL } from './caseStatus'
import { ImportantFactsField } from './ImportantFactsField'
import { cleanFacts, missingSide, SIDE_FACT_LABEL, toRows } from './factRows'
import { titleParties } from '../../courses/worldLabel'
import { DictationTextarea } from '../../components/Dictation'
import { SuggestedNote } from '../../components/SuggestedNote'
import { useCaseSuggestions, useSuggestedField } from './content/caseSuggestions'

/**
 * The case title/summary form, with the most important facts for each side.
 * Creating starts a draft; editing (when `initial` is given) also lets the
 * instructor change the status.
 */
export function CaseForm({
  courseId = '',
  initial,
  label,
  submitLabel,
  submittingLabel,
  onSubmit,
  onCancel,
  children,
}: {
  /** The course, for the AI's suggested note to students (edit form only). */
  courseId?: string
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
  // Unnamed parties start from an "X v. Y" title.
  const [plaintiffName, setPlaintiffName] = useState(initial?.parties?.plaintiff || titleParties(initial?.title).plaintiff)
  const [defendantName, setDefendantName] = useState(initial?.parties?.defendant || titleParties(initial?.title).defendant)
  const [status, setStatus] = useState<CourseCaseStatus>(initial?.status ?? 'draft')
  const suggestions = useCaseSuggestions(courseId, initial?.id ?? '')
  const noteField = useSuggestedField(initial?.instructorNote ?? '', suggestions?.instructorNote)
  const note = noteField.value
  const [plaintiffFacts, setPlaintiffFacts] = useState(() => toRows(initial?.importantFacts.plaintiff ?? []))
  const [defenseFacts, setDefenseFacts] = useState(() => toRows(initial?.importantFacts.defense ?? []))
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const importantFacts = { plaintiff: cleanFacts(plaintiffFacts), defense: cleanFacts(defenseFacts) }
    // A launched case's AI witnesses keep to these, so it can't lose a side's; a draft can add them later.
    const missing = status !== 'draft' ? missingSide(importantFacts) : null
    if (missing) {
      setError(`List at least one important fact for the ${SIDE_FACT_LABEL[missing]}.`)
      return
    }
    setSubmitting(true)
    try {
      await onSubmit(
        initial
          ? { title, summary, status, importantFacts, plaintiffName, defendantName }
          : { title, summary, importantFacts, plaintiffName, defendantName },
        note,
      )
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
      <PartyFields
        plaintiff={plaintiffName}
        defendant={defendantName}
        onPlaintiff={setPlaintiffName}
        onDefendant={setDefendantName}
      />
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
        <DictationTextarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="A rollercoaster stalls mid-loop and a rider is injured during the evacuation."
          maxLength={2000}
          rows={3}
        />
      </label>
      <div className="case-facts">
        <p className="muted case-form-hint">
          List the most important facts for each side, at least one each. The AI witnesses never
          contradict them, and students don&rsquo;t see them.
        </p>
        <ImportantFactsField side="plaintiff" rows={plaintiffFacts} onChange={setPlaintiffFacts} />
        <ImportantFactsField side="defense" rows={defenseFacts} onChange={setDefenseFacts} />
      </div>
      {initial && (
        <label className="case-summary-field">
          Note to students (optional)
          <DictationTextarea
            value={note}
            onChange={(e) => noteField.setValue(e.target.value)}
            placeholder="What students should focus on in this case"
            maxLength={2000}
            rows={2}
          />
          {noteField.suggested && <SuggestedNote />}
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

/** The parties' names, which students see their sides by ("Paige Winston (Plaintiff)"). */
export function PartyFields({
  plaintiff,
  defendant,
  onPlaintiff,
  onDefendant,
}: {
  plaintiff: string
  defendant: string
  onPlaintiff(value: string): void
  onDefendant(value: string): void
}) {
  return (
    <div className="case-parties">
      <label>
        Plaintiff
        <input
          type="text"
          value={plaintiff}
          onChange={(e) => onPlaintiff(e.target.value)}
          placeholder="Paige Winston"
          maxLength={200}
          required
        />
      </label>
      <label>
        Defendant
        <input
          type="text"
          value={defendant}
          onChange={(e) => onDefendant(e.target.value)}
          placeholder="Thrillville Parks"
          maxLength={200}
          required
        />
      </label>
    </div>
  )
}
