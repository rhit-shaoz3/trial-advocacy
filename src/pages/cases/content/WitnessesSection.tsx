import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useCourseService } from '../../../courses/CourseServiceContext'
import { AUDIENCE_LABEL } from '../../../courses/caseLabels'
import {
  AUDIENCES,
  type Audience,
  type CaseMaterial,
  type CourseCase,
  type Side,
  type Witness,
  type WitnessInput,
} from '../../../courses/types'
import { ROLE_LABEL } from '../../../courses/worldLabel'
import { WitnessAvatar } from '../../../components/WitnessAvatar'
import { initialPicture, type PictureChoice } from './witnessPicture'
import { WitnessPicturePicker } from './WitnessPicturePicker'

const BLANK: WitnessInput = {
  name: '',
  role: '',
  description: '',
  audience: 'all',
  alignedSide: null,
  personaNotes: '',
  depositionMaterialId: null,
  knownMaterialIds: [],
  defendingCounsel: '',
  avatarPreset: null,
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
                  <span className={`badge content-audience-${w.audience}`}>{AUDIENCE_LABEL[w.audience]}</span>
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
  const [date, setDate] = useState(courseCase.inWorldDate ?? '')
  const [issues, setIssues] = useState(courseCase.disputedIssues)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null)
  const changed = date !== (courseCase.inWorldDate ?? '') || issues.trim() !== courseCase.disputedIssues

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      const saved = await service.saveWitnessSettings(courseId, courseCase.id, {
        inWorldDate: date || null,
        disputedIssues: issues,
      })
      onSaved(saved)
      setIssues(saved.disputedIssues)
      setMessage({ error: false, text: 'Saved.' })
    } catch (err) {
      setMessage({ error: true, text: err instanceof Error ? err.message : 'Something went wrong.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="panel-form content-form" onSubmit={handleSubmit} aria-label="AI witness settings">
      <label>
        Today&rsquo;s date in the case
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="content-form-full">
        Issues the witnesses must leave disputed (optional)
        <textarea
          value={issues}
          onChange={(e) => setIssues(e.target.value)}
          placeholder="Whether the operator was at the controls when the train stopped; whether the lap bar was locked"
          maxLength={2000}
          rows={2}
        />
      </label>
      <div className="panel-form-actions">
        <button type="submit" className="btn-secondary" disabled={saving || !changed}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        <small className="muted">Without a date, the witnesses use the real date.</small>
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
  const [audience, setAudience] = useState<Audience>(initial.audience)
  const [alignedSide, setAlignedSide] = useState<Side | null>(initial.alignedSide)
  const [depositionId, setDepositionId] = useState(initial.depositionMaterialId ?? '')
  const [known, setKnown] = useState<string[]>(initial.knownMaterialIds)
  const [personaNotes, setPersonaNotes] = useState(initial.personaNotes)
  const [counsel, setCounsel] = useState(initial.defendingCounsel)
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
          audience,
          alignedSide,
          depositionMaterialId: depositionId || null,
          knownMaterialIds: known.filter((id) => id !== depositionId),
          personaNotes,
          defendingCounsel: counsel,
          avatarPreset: picture.kind === 'preset' ? picture.preset : null,
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
          placeholder="Elena Torres"
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
          placeholder="Ride operator"
          maxLength={120}
        />
      </label>
      <label>
        Visible to
        <select value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
          {AUDIENCES.map((a) => (
            <option key={a} value={a}>
              {AUDIENCE_LABEL[a]}
            </option>
          ))}
        </select>
      </label>
      <label className="content-form-full">
        About this witness (optional)
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Was at the ride controls when the train stopped."
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
          Choose a side and a deposition file to let teams interview this witness. Students never see these
          settings or the deposition.
        </p>
        <div className="content-form">
          <label>
            Testifies for
            <select
              value={alignedSide ?? ''}
              onChange={(e) => setAlignedSide((e.target.value || null) as Side | null)}
            >
              <option value="">Not an AI witness</option>
              <option value="plaintiff">Plaintiff</option>
              <option value="defense">Defense</option>
            </select>
          </label>
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
          <textarea
            value={personaNotes}
            onChange={(e) => setPersonaNotes(e.target.value)}
            placeholder="Has run rides for five years. Plain-spoken, loyal to the park, defensive about the ride's safety."
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
