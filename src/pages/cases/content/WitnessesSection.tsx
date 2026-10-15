import { useEffect, useState, type FormEvent } from 'react'
import { useCourseService } from '../../../courses/CourseServiceContext'
import { AUDIENCE_LABEL } from '../../../courses/caseLabels'
import { AUDIENCES, type Audience, type Witness, type WitnessInput } from '../../../courses/types'

const BLANK: WitnessInput = { name: '', role: '', description: '', audience: 'all' }

/** The case's witness directory. Each witness will later be an AI students can interview. */
export function WitnessesSection({ courseId, caseId }: { courseId: string; caseId: string }) {
  const service = useCourseService()
  const [witnesses, setWitnesses] = useState<Witness[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** The witness being edited, 'new' for the add form, or null. */
  const [editing, setEditing] = useState<string | 'new' | null>(null)

  useEffect(() => {
    let cancelled = false
    service
      .listWitnesses(courseId, caseId)
      .then((list) => !cancelled && setWitnesses(list))
      .catch((err: Error) => !cancelled && setLoadError(err.message))
    return () => {
      cancelled = true
    }
  }, [service, courseId, caseId])

  async function handleSave(input: WitnessInput) {
    if (editing === 'new') {
      const created = await service.createWitness(courseId, caseId, input)
      setWitnesses((prev) => [...(prev ?? []), created])
    } else if (editing) {
      const updated = await service.updateWitness(courseId, caseId, editing, input)
      setWitnesses((prev) => prev?.map((w) => (w.id === updated.id ? updated : w)) ?? null)
    }
    setEditing(null)
  }

  async function handleDelete(witness: Witness) {
    if (!window.confirm(`Remove ${witness.name} from this case?`)) return
    setError(null)
    try {
      await service.deleteWitness(courseId, caseId, witness.id)
      setWitnesses((prev) => prev?.filter((w) => w.id !== witness.id) ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

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
        The people in the case&rsquo;s story. Students see them in their Witnesses tab; interviews with
        AI witnesses come later.
      </p>

      {editing === 'new' && (
        <WitnessForm label="New witness" initial={BLANK} onSave={handleSave} onCancel={() => setEditing(null)} />
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
                  onSave={handleSave}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <li key={w.id} className="content-item" aria-label={w.name}>
                <div>
                  <strong>{w.name}</strong>
                  {w.role && <span className="muted"> · {w.role}</span>}
                  <span className={`badge content-audience-${w.audience}`}>{AUDIENCE_LABEL[w.audience]}</span>
                  {w.description && <p>{w.description}</p>}
                </div>
                <span className="content-actions">
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

function WitnessForm({
  label,
  initial,
  onSave,
  onCancel,
}: {
  label: string
  initial: WitnessInput
  /** Throw to show the error in the form. */
  onSave(input: WitnessInput): Promise<void>
  onCancel(): void
}) {
  const [name, setName] = useState(initial.name)
  const [role, setRole] = useState(initial.role)
  const [description, setDescription] = useState(initial.description)
  const [audience, setAudience] = useState<Audience>(initial.audience)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await onSave({ name, role, description, audience })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setSaving(false)
    }
  }

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
