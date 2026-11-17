import { useImperativeHandle, useState, type FormEvent, type Ref } from 'react'
import { WitnessAvatar } from '../../../components/WitnessAvatar'
import { useCourseService } from '../../../courses/CourseServiceContext'
import {
  DEFAULT_INVESTIGATOR_NAME,
  DEFAULT_LIMIT,
  INVESTIGATOR_AVATAR_URL,
  investigatorOf,
  type CourseCase,
} from '../../../courses/types'
import { DictationTextarea } from '../../../components/Dictation'
import { HelpToggle } from '../../../components/HelpToggle'
import { LimitField } from './LimitField'
import { limitDraft, parseLimit, sameLimit } from './limitDraft'
import type { StepSave } from './stepSave'

/**
 * The case's background investigator, the same for every team: whether the
 * case has one (without him there's no investigate phase), his name, the
 * instructor's own instructions for him, and how many requests each team (or
 * student) can send.
 */
export function InvestigatorSection({
  courseId,
  courseCase,
  onSaved,
  saveRef,
}: {
  courseId: string
  courseCase: CourseCase
  onSaved(updated: CourseCase): void
  /** For the case setup flow: Next saves the changes. */
  saveRef?: Ref<StepSave>
}) {
  const service = useCourseService()
  /** What's saved now, to tell whether there's anything to save. */
  const [initial, setInitial] = useState(() => investigatorOf(courseCase))
  const [enabled, setEnabled] = useState(initial.enabled)
  const [name, setName] = useState(initial.name)
  const [instructions, setInstructions] = useState(initial.instructions)
  const [limit, setLimit] = useState(() => limitDraft(initial.limit ?? DEFAULT_LIMIT))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsedLimit = parseLimit(limit)
  const changed =
    enabled !== initial.enabled ||
    name.trim() !== initial.name ||
    instructions.trim() !== initial.instructions ||
    !sameLimit(parsedLimit, initial.limit ?? DEFAULT_LIMIT)

  async function save() {
    if (!parsedLimit) throw new Error('Enter how many requests each team or student can send, from 1 up.')
    const updated = await service.saveInvestigator(courseId, courseCase.id, {
      enabled,
      name: name.trim() || DEFAULT_INVESTIGATOR_NAME,
      instructions: instructions.trim(),
      limit: parsedLimit,
    })
    const saved = investigatorOf(updated)
    setInitial(saved)
    setName(saved.name)
    setInstructions(saved.instructions)
    setLimit(limitDraft(saved.limit ?? DEFAULT_LIMIT))
    onSaved(updated)
    return updated
  }

  useImperativeHandle(saveRef, () => ({
    pending: () => changed,
    save: async () => (changed ? save() : undefined),
  }))

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await save()
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
        <LimitField
          label="Requests to the investigator"
          hint="Each assignment a team emails him counts as one. Per student, each partner has their own."
          value={limit}
          onChange={(next) => {
            setLimit(next)
            setSaved(false)
          }}
          disabled={!enabled}
        />
        <label>
          Instructions for the investigator (optional)
          <DictationTextarea
            value={instructions}
            onChange={(e) => {
              setInstructions(e.target.value)
              setSaved(false)
            }}
            placeholder="Optional"
            maxLength={2000}
            rows={3}
            disabled={!enabled}
          />
          <span className="muted field-hint">
            Sent with every request, with the case file. Your instructions come first: where they differ from his
            standard instructions, he follows yours.
          </span>
        </label>
        <HelpToggle label="What can I write here?">
          <p>
            Leave it empty and he works from his standard instructions: a licensed investigator who stays within the
            law, works from the case file, and can follow people in public and create ordinary records of his own work.
            Some things you might add:
          </p>
          <ul>
            <li>
              <strong>A personality.</strong> &ldquo;A gruff retired detective who keeps reports short and calls
              everyone &lsquo;counselor.&rsquo;&rdquo;
            </li>
            <li>
              <strong>Whether he can create new records.</strong> &ldquo;Don&rsquo;t create new documents or
              photos; only report what&rsquo;s in the case file.&rdquo;
            </li>
            <li>
              <strong>Things he won&rsquo;t do.</strong> &ldquo;He won&rsquo;t follow or watch anyone.&rdquo;
              &ldquo;He won&rsquo;t look into the plaintiff&rsquo;s medical history.&rdquo;
            </li>
            <li>
              <strong>Things he can do.</strong> &ldquo;He can get the park&rsquo;s maintenance logs without a
              subpoena.&rdquo;
            </li>
            <li>
              <strong>What to stress.</strong> &ldquo;Push teams to think about the timeline of the ride
              inspection.&rdquo; Or how long his reports should be.
            </li>
          </ul>
        </HelpToggle>
        <div className="panel-form-actions">
          <button type="submit" className="btn-primary" disabled={saving || !changed || !parsedLimit}>
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
