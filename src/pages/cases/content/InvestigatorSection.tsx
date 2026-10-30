import { useState, type FormEvent } from 'react'
import { WitnessAvatar } from '../../../components/WitnessAvatar'
import { useCourseService } from '../../../courses/CourseServiceContext'
import { DEFAULT_INVESTIGATOR_NAME, INVESTIGATOR_AVATAR_URL, investigatorOf, type CourseCase } from '../../../courses/types'
import { DictationTextarea } from '../../../components/Dictation'
import { SuggestedNote } from '../../../components/SuggestedNote'
import { useCaseSuggestions, useSuggestedField } from './caseSuggestions'

/**
 * The case's background investigator, the same for every team: whether the
 * case has one (without him there's no investigate phase), his name, and the
 * instructor's own instructions for him.
 */
export function InvestigatorSection({
  courseId,
  courseCase,
  onSaved,
}: {
  courseId: string
  courseCase: CourseCase
  onSaved(updated: CourseCase): void
}) {
  const service = useCourseService()
  /** What's saved now, to tell whether there's anything to save. */
  const [initial, setInitial] = useState(() => investigatorOf(courseCase))
  const [enabled, setEnabled] = useState(initial.enabled)
  const [name, setName] = useState(initial.name)
  const suggestions = useCaseSuggestions(courseId, courseCase.id)
  const notes = useSuggestedField(initial.instructions, suggestions?.investigatorNotes)
  const instructions = notes.value
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changed =
    enabled !== initial.enabled || name.trim() !== initial.name || instructions.trim() !== initial.instructions

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const updated = await service.saveInvestigator(courseId, courseCase.id, {
        enabled,
        name: name.trim() || DEFAULT_INVESTIGATOR_NAME,
        instructions: instructions.trim(),
      })
      setInitial(investigatorOf(updated))
      setName(investigatorOf(updated).name)
      notes.reset(investigatorOf(updated).instructions)
      onSaved(updated)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="course-section" aria-labelledby="investigator-heading">
      <div className="section-header">
        <h2 id="investigator-heading">Background investigator</h2>
      </div>
      <p className="muted section-hint">
        Teams email the investigator assignments in the investigate phase: finding and interviewing new people,
        searching public records, inspecting the scene. You review every report, its new facts, and any case files he
        would unlock for the team, before the team sees it (in review lite, set on the Review page, reports go straight
        to the team, and you see what they flag). Without an investigator, the case goes straight from the
        introduction (or information exchange) to deposition.
      </p>
      <form className="panel-form investigator-form" onSubmit={handleSubmit} aria-label="Investigator settings">
        <div className="investigator-profile">
          <WitnessAvatar src={INVESTIGATOR_AVATAR_URL} size="lg" />
          <label className="investigator-toggle">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => {
                setEnabled(e.target.checked)
                setSaved(false)
              }}
            />
            Use a background investigator
          </label>
        </div>
        <label>
          Name
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setSaved(false)
            }}
            placeholder={DEFAULT_INVESTIGATOR_NAME}
            maxLength={120}
            disabled={!enabled}
          />
        </label>
        <label>
          Instructions for the investigator (optional)
          <DictationTextarea
            value={instructions}
            onChange={(e) => {
              notes.setValue(e.target.value)
              setSaved(false)
            }}
            placeholder="Anything he should know: what to stress, where to look, how long reports should be"
            maxLength={2000}
            rows={3}
            disabled={!enabled}
          />
          {notes.suggested && <SuggestedNote />}
          <span className="muted field-hint">Sent with every request, alongside his standing instructions and the case file.</span>
        </label>
        <div className="panel-form-actions">
          <button type="submit" className="btn-primary" disabled={saving || !changed}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {saved && !changed && (
            <span className="muted" role="status">
              Saved.
            </span>
          )}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  )
}
