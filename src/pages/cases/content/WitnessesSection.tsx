import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useCourseService } from '../../../courses/CourseServiceContext'
import { AUDIENCE_LABEL } from '../../../courses/caseLabels'
import {
  DEFAULT_LIMIT,
  DEFAULT_PRACTICE,
  MAX_LIMIT,
  type CaseMaterial,
  type CourseCase,
  type Side,
  type Witness,
  type WitnessInput,
  type WitnessSuggestions,
} from '../../../courses/types'
import { ROLE_LABEL } from '../../../courses/worldLabel'
import { WitnessAvatar } from '../../../components/WitnessAvatar'
import { initialPicture, type PictureChoice } from './witnessPicture'
import { WitnessPicturePicker } from './WitnessPicturePicker'
import { DictationTextarea } from '../../../components/Dictation'
import { SuggestedNote } from '../../../components/SuggestedNote'
import { useCaseSuggestions, useSuggestedField } from './caseSuggestions'
import { LimitField } from './LimitField'
import { limitDraft, parseLimit, sameLimit } from './limitDraft'

const BLANK: WitnessInput = {
  name: '',
  role: '',
  description: '',
  hidden: false,
  alignedSide: null,
  personaNotes: '',
  depositionMaterialId: null,
  knownMaterialIds: [],
  defendingCounsel: '',
  avatarPreset: null,
  isClient: false,
  speaksForOrganization: false,
}

const isAiWitness = (w: Witness) => w.alignedSide !== null && w.depositionMaterialId !== null
const fileLabel = (m: CaseMaterial) => (m.description ? `${m.description} (${m.filename})` : m.filename)

/**
 * The case's witnesses. A witness with a side and a deposition file becomes an
 * AI witness: it answers teams' interview questions from that deposition and
 * the case files it has seen.
 */
export function WitnessesSection({
  courseId,
  courseCase,
  onCaseChange,
}: {
  courseId: string
  courseCase: CourseCase
  onCaseChange(updated: CourseCase): void
}) {
  const caseId = courseCase.id
  const service = useCourseService()
  const [witnesses, setWitnesses] = useState<Witness[] | null>(null)
  const [materials, setMaterials] = useState<CaseMaterial[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** The witness being edited, 'new' for the add form, or null. */
  const [editing, setEditing] = useState<string | 'new' | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([service.listWitnesses(courseId, caseId), service.listMaterials(courseId, caseId)])
      .then(([list, files]) => {
        if (cancelled) return
        setWitnesses(list)
        setMaterials(files)
      })
      .catch((err: Error) => !cancelled && setLoadError(err.message))
    return () => {
      cancelled = true
    }
  }, [service, courseId, caseId])

  async function handleSave(input: WitnessInput, picture: PictureChoice, hadUpload: boolean) {
    if (!editing) return
    let saved =
      editing === 'new'
        ? await service.createWitness(courseId, caseId, input)
        : await service.updateWitness(courseId, caseId, editing, input)
    const show = (witness: Witness) =>
      setWitnesses((prev) =>
        editing === 'new' ? [...(prev ?? []), witness] : (prev?.map((w) => (w.id === witness.id ? witness : w)) ?? null),
      )
    // The witness is saved; the picture goes up after it, with its own error.
    try {
      if (picture.kind === 'new') saved = await service.uploadWitnessAvatar(courseId, caseId, saved.id, picture.image)
      else if (picture.kind === 'none' && hadUpload) saved = await service.removeWitnessAvatar(courseId, caseId, saved.id)
    } catch (err) {
      setError(`Saved ${saved.name}, but not the picture. ${err instanceof Error ? err.message : ''}`.trim())
    }
    show(saved)
    setEditing(null)
  }

  async function handleDelete(witness: Witness) {
    if (!window.confirm(`Remove ${witness.name} from this case? Teams' interviews with them are deleted too.`)) return
    setError(null)
    try {
      await service.deleteWitness(courseId, caseId, witness.id)
      setWitnesses((prev) => prev?.filter((w) => w.id !== witness.id) ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  const testPath = (w: Witness, side: Side) => `/courses/${courseId}/cases/${caseId}/witnesses/${w.id}?side=${side}`

  return (
    <section className="course-section" aria-labelledby="witnesses-heading">
      <div className="section-header">
        <h2 id="witnesses-heading">Witnesses</h2>
        {editing !== 'new' && (
          <button type="button" className="btn-primary" onClick={() => setEditing('new')}>
            Add witness
          </button>
        )}
      </div>
      <p className="muted section-hint">
        The people in the case&rsquo;s story, shown in students&rsquo; Witnesses tab. To make one an AI
        witness that teams can interview, choose the side they testify for and their deposition file
        (upload it to the case file as Instructors only). The AI keeps to that deposition and the files
        you tick as ones they have seen.
      </p>

      <WitnessSettings courseId={courseId} courseCase={courseCase} onSaved={onCaseChange} />

      <SuggestedWitnesses
        courseId={courseId}
        caseId={caseId}
        hasWitnesses={(witnesses?.length ?? 0) > 0}
        onAdded={(added) => setWitnesses((prev) => [...(prev ?? []), ...added])}
      />

      {editing === 'new' && (
        <WitnessForm
          label="New witness"
          initial={BLANK}
          materials={materials}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {loadError ? (
        <p className="form-error" role="alert">
          Could not load the witnesses. {loadError}
        </p>
      ) : !witnesses ? (
        <p className="muted">Loading witnesses…</p>
      ) : witnesses.length === 0 ? (
        <p className="muted">No witnesses yet.</p>
      ) : (
        <ul className="content-list" aria-label="Witnesses">
          {witnesses.map((w) =>
            editing === w.id ? (
              <li key={w.id}>
                <WitnessForm
                  label={`Edit ${w.name}`}
                  initial={w}
                  materials={materials}
                  onSave={handleSave}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <li key={w.id} className="content-item content-witness" aria-label={w.name}>
                <WitnessAvatar src={w.avatarUrl} />
                <div>
                  <strong>{w.name}</strong>
                  {w.role && <span className="muted"> · {w.role}</span>}
                  {w.hidden && <span className="badge content-audience-instructor">Hidden from students</span>}
                  {w.isClient && w.alignedSide && (
                    <span className="badge content-client">{ROLE_LABEL[w.alignedSide]}&rsquo;s client</span>
                  )}
                  {isAiWitness(w) && <span className="badge content-ai-witness">AI witness</span>}
                  {w.description && <p>{w.description}</p>}
                  {isAiWitness(w) && <AiSummary witness={w} materials={materials} />}
                </div>
                <span className="content-actions">
                  {isAiWitness(w) && (
                    <>
                      <Link to={testPath(w, 'plaintiff')}>Test as plaintiff</Link>
                      <Link to={testPath(w, 'defense')}>Test as defense</Link>
                    </>
                  )}
                  <button type="button" className="link-button" onClick={() => setEditing(w.id)}>
                    Edit
                  </button>
                  <button type="button" className="link-button" onClick={() => handleDelete(w)}>
                    Remove
                  </button>
                </span>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  )
}

/** One line on what the AI witness reads, and a warning if its deposition can't be read. */
function AiSummary({ witness: w, materials }: { witness: Witness; materials: CaseMaterial[] }) {
  const deposition = materials.find((m) => m.id === w.depositionMaterialId)
  const known = w.knownMaterialIds.length
  return (
    <>
      <small className="muted content-meta">
        For the {ROLE_LABEL[w.alignedSide!].toLowerCase()} · Deposition: {deposition ? fileLabel(deposition) : 'missing'} ·{' '}
        {known === 1 ? '1 other file seen' : `${known} other files seen`}
        {w.defendingCounsel && ` · Lawyer: ${w.defendingCounsel}`}
      </small>
      {deposition && deposition.textStatus !== 'ready' && (
        <small className="form-error content-meta">
          {deposition.textStatus === 'pending'
            ? 'The deposition is still being read; the witness can answer once it is done.'
            : 'The deposition file could not be read. Retry it in the Case file tab.'}
        </small>
      )}
    </>
  )
}

/** Case-wide settings every AI witness in the case uses. */
function WitnessSettings({
  courseId,
  courseCase,
  onSaved,
}: {
  courseId: string
  courseCase: CourseCase
  onSaved(updated: CourseCase): void
}) {
  const service = useCourseService()
  const suggestions = useCaseSuggestions(courseId, courseCase.id)
  const field = useSuggestedField(courseCase.disputedIssues, suggestions?.disputedIssues)
  const issues = field.value
  const savedLimit = courseCase.interviewLimit ?? DEFAULT_LIMIT
  const [limit, setLimit] = useState(() => limitDraft(savedLimit))
  const parsedLimit = parseLimit(limit)
  const savedEmailLimit = courseCase.clientEmailLimit ?? DEFAULT_LIMIT
  const [emailLimit, setEmailLimit] = useState(() => limitDraft(savedEmailLimit))
  const parsedEmailLimit = parseLimit(emailLimit)
  const savedPractice = courseCase.practice ?? DEFAULT_PRACTICE
  const [practiceOn, setPracticeOn] = useState(savedPractice.enabled)
  const [practiceLimit, setPracticeLimit] = useState(String(savedPractice.limit))
  const parsedPracticeLimit = /^\d+$/.test(practiceLimit.trim()) && Number(practiceLimit) >= 1 && Number(practiceLimit) <= MAX_LIMIT ? Number(practiceLimit) : null
  const practiceChanged = practiceOn !== savedPractice.enabled || parsedPracticeLimit !== savedPractice.limit
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null)
  const changed =
    issues.trim() !== courseCase.disputedIssues ||
    !sameLimit(parsedLimit, savedLimit) ||
    !sameLimit(parsedEmailLimit, savedEmailLimit) ||
    practiceChanged

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      let saved = await service.saveWitnessSettings(courseId, courseCase.id, {
        // The witnesses always use the real date now.
        inWorldDate: null,
        disputedIssues: issues,
        interviewLimit: parsedLimit ?? undefined,
        clientEmailLimit: parsedEmailLimit ?? undefined,
      })
      if (practiceChanged && parsedPracticeLimit) {
        saved = await service.savePracticeSettings(courseId, courseCase.id, { enabled: practiceOn, limit: parsedPracticeLimit })
      }
      onSaved(saved)
      field.reset(saved.disputedIssues)
      setLimit(limitDraft(saved.interviewLimit ?? DEFAULT_LIMIT))
      setEmailLimit(limitDraft(saved.clientEmailLimit ?? DEFAULT_LIMIT))
      setPracticeOn((saved.practice ?? DEFAULT_PRACTICE).enabled)
      setPracticeLimit(String((saved.practice ?? DEFAULT_PRACTICE).limit))
      setMessage({ error: false, text: 'Saved.' })
    } catch (err) {
      setMessage({ error: true, text: err instanceof Error ? err.message : 'Something went wrong.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="panel-form content-form" onSubmit={handleSubmit} aria-label="AI witness settings">
      <label className="content-form-full">
        Issues the witnesses must leave disputed (optional)
        <DictationTextarea
          value={issues}
          onChange={(e) => field.setValue(e.target.value)}
          placeholder="The facts the witnesses mustn't settle, separated by semicolons"
          maxLength={2000}
          rows={2}
        />
        {field.suggested && <SuggestedNote />}
      </label>
      <LimitField
        label="Interviews with each witness"
        hint="An interview counts once it has a question; starting over begins the next one. Depositions count too. Per student, an interview counts for each partner who asks in it."
        value={limit}
        onChange={(next) => {
          setLimit(next)
          setMessage(null)
        }}
      />
      <LimitField
        label="Emails to the client"
        hint="Each email a team sends its clients counts as one. Per student, each partner has their own."
        value={emailLimit}
        onChange={(next) => {
          setEmailLimit(next)
          setMessage(null)
        }}
      />
      <fieldset className="limit-field">
        <legend>Practice with the witnesses</legend>
        <label className="investigator-toggle">
          <input
            type="checkbox"
            checked={practiceOn}
            onChange={(e) => {
              setPracticeOn(e.target.checked)
              setMessage(null)
            }}
          />
          Let students practice
        </label>
        <div className="limit-field-inputs">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_LIMIT}
            step={1}
            value={practiceLimit}
            disabled={!practiceOn}
            onChange={(e) => {
              setPracticeLimit(e.target.value)
              setMessage(null)
            }}
            aria-label="Practice sessions for each student"
            aria-invalid={parsedPracticeLimit === null}
            aria-describedby="practice-limit-hint"
          />
          <span>sessions per student</span>
        </div>
        <span id="practice-limit-hint" className={parsedPracticeLimit === null ? 'form-error field-hint' : 'muted field-hint'}>
          {parsedPracticeLimit === null
            ? `Enter a whole number from 1 to ${MAX_LIMIT}.`
            : 'A student picks a witness, a setting (interview, deposition, direct, cross, or redirect), and what to practice; a coach comments on each question. Practice doesn’t count toward interviews, and nothing said in it reaches the case. A session counts once it has a question.'}
        </span>
      </fieldset>
      <div className="panel-form-actions">
        <button type="submit" className="btn-secondary" disabled={saving || !changed || !parsedLimit || !parsedEmailLimit || !parsedPracticeLimit}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {message && (
          <span className={message.error ? 'form-error' : 'muted'} role={message.error ? 'alert' : 'status'}>
            {message.text}
          </span>
        )}
      </div>
    </form>
  )
}

function WitnessForm({
  label,
  initial,
  materials,
  onSave,
  onCancel,
}: {
  label: string
  initial: WitnessInput & { avatarUrl?: string | null }
  materials: CaseMaterial[]
  /** Throw to show the error in the form. `hadUpload`: the witness had an uploaded picture before. */
  onSave(input: WitnessInput, picture: PictureChoice, hadUpload: boolean): Promise<void>
  onCancel(): void
}) {
  const [picture, setPicture] = useState<PictureChoice>(() => initialPicture(initial))
  const [name, setName] = useState(initial.name)
  const [role, setRole] = useState(initial.role)
  const [description, setDescription] = useState(initial.description)
  const [shown, setShown] = useState(!initial.hidden)
  const [alignedSide, setAlignedSide] = useState<Side | null>(initial.alignedSide)
  const [depositionId, setDepositionId] = useState(initial.depositionMaterialId ?? '')
  const [known, setKnown] = useState<string[]>(initial.knownMaterialIds)
  const [personaNotes, setPersonaNotes] = useState(initial.personaNotes)
  const [counsel, setCounsel] = useState(initial.defendingCounsel)
  const [isClient, setIsClient] = useState(initial.isClient ?? false)
  const [organization, setOrganization] = useState(initial.speaksForOrganization ?? false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Depositions are usually instructors-only files, so list those first.
  const depositionChoices = [...materials].sort(
    (a, b) => Number(b.audience === 'instructor') - Number(a.audience === 'instructor'),
  )
  const others = materials.filter((m) => m.id !== depositionId)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await onSave(
        {
          name,
          role,
          description,
          hidden: !shown,
          alignedSide,
          depositionMaterialId: depositionId || null,
          knownMaterialIds: known.filter((id) => id !== depositionId),
          personaNotes,
          defendingCounsel: counsel,
          avatarPreset: picture.kind === 'preset' ? picture.preset : null,
          // A client needs a side.
          isClient: isClient && alignedSide !== null,
          speaksForOrganization: isClient && alignedSide !== null && organization,
        },
        picture,
        initialPicture(initial).kind === 'uploaded',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setSaving(false)
    }
  }

  const toggleKnown = (id: string, checked: boolean) =>
    setKnown((prev) => (checked ? [...prev, id] : prev.filter((k) => k !== id)))

  return (
    <form className="panel-form content-form" onSubmit={handleSubmit} aria-label={label}>
      <label className="content-form-grow">
        Name
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name, or a description like “The store manager”"
          maxLength={120}
          required
          autoFocus
        />
      </label>
      <label className="content-form-grow">
        Role
        <input
          type="text"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="Their job or title"
          maxLength={120}
        />
      </label>
      <label>
        Testifies for
        <select value={alignedSide ?? ''} onChange={(e) => setAlignedSide((e.target.value || null) as Side | null)}>
          <option value="">Neither side</option>
          <option value="plaintiff">Plaintiff</option>
          <option value="defense">Defense</option>
        </select>
      </label>
      <div className="content-form-full content-show">
        <label className="investigator-toggle">
          <input type="checkbox" checked={shown} onChange={(e) => setShown(e.target.checked)} />
          Show to students
        </label>
        <span className="muted field-hint">
          Both sides see every witness. Turn this off to keep this one from students until you&rsquo;re ready. A hidden
          witness you pick for initial disclosures is shown when the introduction ends.
        </span>
      </div>
      <div className="content-form-full content-show">
        <label className="investigator-toggle">
          <input
            type="checkbox"
            checked={isClient && alignedSide !== null}
            onChange={(e) => setIsClient(e.target.checked)}
            disabled={alignedSide === null}
          />
          This is a client
        </label>
        {isClient && alignedSide !== null && (
          <label className="investigator-toggle">
            <input type="checkbox" checked={organization} onChange={(e) => setOrganization(e.target.checked)} />
            Speaks for an organization (e.g. the park&rsquo;s safety manager)
          </label>
        )}
        <span className="muted field-hint">
          {alignedSide === null
            ? 'Choose whom they testify for to make them a client.'
            : `The ${ROLE_LABEL[alignedSide].toLowerCase()} team can email its clients for information and documents. With several clients, they answer together, from anything any of them knows or owns.${isClient && !depositionId ? ' Choose an interview file under AI witness so the team can interview them too.' : ''}`}
        </span>
      </div>
      <label className="content-form-full">
        About this witness (optional)
        <DictationTextarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What they saw or did, in a sentence"
          maxLength={4000}
          rows={2}
        />
      </label>

      <WitnessPicturePicker
        value={picture}
        uploadedUrl={initialPicture(initial).kind === 'uploaded' ? initial.avatarUrl : null}
        onChange={setPicture}
      />

      <fieldset className="content-form-full content-fieldset">
        <legend>AI witness</legend>
        <p className="muted section-hint">
          With a side (Testifies for, above) and a deposition file, teams can interview this witness. Students
          never see these settings or the deposition.
        </p>
        <div className="content-form">
          <label className="content-form-grow">
            Interview file
            <select value={depositionId} onChange={(e) => setDepositionId(e.target.value)}>
              <option value="">None</option>
              {depositionChoices.map((m) => (
                <option key={m.id} value={m.id}>
                  {fileLabel(m)}
                  {m.audience === 'instructor' ? '' : ` · ${AUDIENCE_LABEL[m.audience]}`}
                </option>
              ))}
            </select>
          </label>
          <label className="content-form-grow">
            Witness&rsquo;s lawyer&rsquo;s name (optional)
            <input
              type="text"
              value={counsel}
              onChange={(e) => setCounsel(e.target.value)}
              // The lawyer objects for the witness whenever the other side asks; blank shows as "Defending counsel".
              placeholder="Defending counsel"
              title="The witness's lawyer objects to improper questions from the other side. Leave blank to show them as Defending counsel."
              maxLength={120}
            />
          </label>
        </div>
        {others.length > 0 && (
          <div role="group" aria-label="Files the witness has seen" className="content-checklist">
            <span>Files the witness has seen</span>
            {others.map((m) => (
              <label key={m.id} className="content-check">
                <input
                  type="checkbox"
                  checked={known.includes(m.id)}
                  onChange={(e) => toggleKnown(m.id, e.target.checked)}
                />
                {fileLabel(m)}
              </label>
            ))}
          </div>
        )}
        <label className="content-form-full">
          Background and demeanor (optional)
          <DictationTextarea
            value={personaNotes}
            onChange={(e) => setPersonaNotes(e.target.value)}
            placeholder="How they come across: background, manner, loyalties"
            maxLength={4000}
            rows={3}
          />
        </label>
      </fieldset>

      <div className="panel-form-actions">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save witness'}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}

/** How often to check back while the AI reads the initial file. */
const SUGGESTIONS_POLL_MS = 3000

/**
 * The witnesses the AI read from the initial file (the complaint), offered
 * once: tick the ones to add, and they're created with their name, role, and
 * part in the story filled in. Adding or skipping puts the list away for good.
 */
function SuggestedWitnesses({
  courseId,
  caseId,
  hasWitnesses,
  onAdded,
}: {
  courseId: string
  caseId: string
  hasWitnesses: boolean
  onAdded(witnesses: Witness[]): void
}) {
  const service = useCourseService()
  const [state, setState] = useState<WitnessSuggestions | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () =>
      service
        .getWitnessSuggestions(courseId, caseId)
        .then((next) => {
          if (cancelled) return
          setState(next)
          if (next.status === 'ready') setPicked(new Set(next.suggestions.map((s) => s.name)))
          // Keep checking while the file is read and the AI thinks.
          if (next.status === 'waiting' && (next.reason === 'reading' || next.reason === 'thinking')) {
            timer = setTimeout(load, SUGGESTIONS_POLL_MS)
          }
        })
        .catch(() => {}) // the witness list still works without suggestions
    load()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [service, courseId, caseId])

  if (!state || state.status === 'done') return null
  if (state.status === 'failed') {
    return (
      <p className="muted suggest-note" role="status">
        {state.error} Upload the complaint as a PDF or Word document and make it the starting file to try again.
      </p>
    )
  }
  if (state.status === 'waiting') {
    if (hasWitnesses && (state.reason === 'no-file' || state.reason === 'no-parties')) return null
    if (state.reason === 'reading' || state.reason === 'thinking') {
      return (
        <section className="suggest-panel suggest-loading" role="status" aria-labelledby="suggest-title">
          <h3 id="suggest-title">
            <span className="suggest-spinner" aria-hidden="true" />
            Finding likely witnesses
          </h3>
          <p className="muted">
            {state.reason === 'reading'
              ? 'Reading the complaint. Suggested witnesses will appear here in a minute or two.'
              : 'The AI is picking out the people the complaint names. Suggested witnesses will appear here shortly.'}
          </p>
          <ul aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="suggest-skeleton" />
            ))}
          </ul>
        </section>
      )
    }
    return (
      <p className="muted suggest-note" role="status">
        {state.reason === 'no-file'
          ? 'Upload the complaint as the case’s initial file, and the AI will suggest likely witnesses from it.'
          : 'Name the plaintiff and defendant in the case details, and the AI will suggest likely witnesses.'}
      </p>
    )
  }
  if (state.suggestions.length === 0) return null

  async function finish(add: boolean) {
    if (state?.status !== 'ready') return
    setBusy(true)
    setError(null)
    try {
      const added: Witness[] = []
      if (add) {
        for (const s of state.suggestions.filter((s) => picked.has(s.name))) {
          added.push(
            await service.createWitness(courseId, caseId, {
              ...BLANK,
              name: s.name,
              role: s.role,
              description: s.description,
              alignedSide: s.alignedSide,
            }),
          )
        }
      }
      await service.finishWitnessSuggestions(courseId, caseId)
      onAdded(added)
      setState({ status: 'done' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  const toggle = (name: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (on) next.add(name)
      else next.delete(name)
      return next
    })

  return (
    <section className="suggest-panel" aria-labelledby="suggest-title">
      <h3 id="suggest-title">Likely witnesses from the complaint</h3>
      <p className="muted">
        Tick the ones to add. You can edit them afterward, and add their deposition files. These are only suggested
        this once.
      </p>
      <ul>
        {state.suggestions.map((s) => (
          <li key={s.name}>
            <label>
              <input type="checkbox" checked={picked.has(s.name)} onChange={(e) => toggle(s.name, e.target.checked)} />
              <span>
                <strong>{s.name}</strong>
                {s.role && <span className="muted"> · {s.role}</span>}
                {s.alignedSide && <span className="badge">{ROLE_LABEL[s.alignedSide]}&rsquo;s side</span>}
                {s.description && <small>{s.description}</small>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="panel-form-actions">
        <button type="button" className="btn-primary" onClick={() => finish(true)} disabled={busy || picked.size === 0}>
          {busy ? 'Adding…' : picked.size === 1 ? 'Add 1 witness' : `Add ${picked.size} witnesses`}
        </button>
        <button type="button" className="btn-secondary" onClick={() => finish(false)} disabled={busy}>
          Skip
        </button>
      </div>
    </section>
  )
}
