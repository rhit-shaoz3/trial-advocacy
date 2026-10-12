import { Pencil, Plus, Trash2, UserRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { errorMessage } from '../dashboard/errorMessage'
import { useCasesApi } from './CasesApiContext'
import { characterBadge, ROLE_LABELS } from './format'
import { PublishControl } from './PublishControl'
import { SideSelect } from './SideSelect'
import type { Character, CharacterInput, CharacterRole, InstructorCase } from './types'

interface Props {
  c: InstructorCase
  onChanged(): Promise<void>
  onPublish(published: boolean): Promise<void>
}

const EMPTY: CharacterInput = { name: '', title: '', role: 'witness', side: 'both' }

function CharacterForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: CharacterInput
  submitLabel: string
  /** Rejects if saving failed, which keeps the form filled in. */
  onSubmit(input: CharacterInput): Promise<unknown>
  onCancel?(): void
}) {
  const [input, setInput] = useState(initial)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await onSubmit({ ...input, name: input.name.trim(), title: input.title.trim() })
      if (!onCancel) setInput(EMPTY) // the add form clears itself for the next one
    } catch {
      // The section shows the error; keep what was typed so it can be fixed.
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="character-form" onSubmit={handleSubmit} aria-label={submitLabel}>
      <input
        type="text"
        className="input"
        aria-label="Name"
        placeholder="Name, e.g. Elena Rivera"
        value={input.name}
        onChange={(e) => setInput({ ...input, name: e.target.value })}
        maxLength={100}
        required
      />
      <input
        type="text"
        className="input"
        aria-label="Title"
        placeholder="Title, e.g. Police Officer"
        value={input.title}
        onChange={(e) => setInput({ ...input, title: e.target.value })}
        maxLength={100}
        required
      />
      <select
        className="input"
        aria-label="Role"
        value={input.role}
        onChange={(e) => setInput({ ...input, role: e.target.value as CharacterRole })}
      >
        {(Object.keys(ROLE_LABELS) as CharacterRole[]).map((role) => (
          <option key={role} value={role}>
            {ROLE_LABELS[role]}
          </option>
        ))}
      </select>
      <SideSelect
        label="Character visible to"
        className="input"
        value={input.side}
        onChange={(side) => setInput({ ...input, side })}
      />
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {!onCancel && <Plus size={16} aria-hidden />} {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

export function CharactersSection({ c, onChanged, onPublish }: Props) {
  const api = useCasesApi()
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Checkbox changes show immediately; the server catches up in the background.
  const [knows, setKnows] = useState<Record<string, boolean>>({})

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
      await onChanged()
    } catch (err) {
      setError(errorMessage(err))
      throw err
    }
  }

  const linkKey = (characterId: string, documentId: string) => `${characterId}:${documentId}`
  const isLinked = (ch: Character, documentId: string) =>
    knows[linkKey(ch.id, documentId)] ?? ch.documentIds.includes(documentId)

  async function toggleKnows(ch: Character, documentId: string) {
    const key = linkKey(ch.id, documentId)
    const next = !isLinked(ch, documentId)
    setKnows((current) => ({ ...current, [key]: next }))
    try {
      await run(() => api.setCharacterKnows(c.id, ch.id, documentId, next))
    } catch {
      setKnows((current) => ({ ...current, [key]: !next }))
    }
  }

  return (
    <section className="panel" aria-labelledby="characters-heading">
      <div className="panel-head">
        <h2 id="characters-heading">Characters</h2>
        <PublishControl label="characters" published={c.published.characters} onChange={onPublish} />
      </div>
      <p className="hint section-intro">
        Witnesses and investigators students can interview. Tick the documents each one knows
        about. (AI role-play comes later.)
      </p>

      <CharacterForm
        initial={EMPTY}
        submitLabel="Add character"
        onSubmit={(input) => run(() => api.createCharacter(c.id, input))}
      />

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {c.characters.length > 0 && (
        <ul className="character-grid">
          {c.characters.map((ch) =>
            editing === ch.id ? (
              <li key={ch.id} className="character-card editing">
                <CharacterForm
                  initial={{ name: ch.name, title: ch.title, role: ch.role, side: ch.side }}
                  submitLabel="Save"
                  onCancel={() => setEditing(null)}
                  onSubmit={(input) =>
                    run(() => api.updateCharacter(c.id, ch.id, input)).then(() => setEditing(null))
                  }
                />
              </li>
            ) : (
              <li key={ch.id} className="character-card">
                <div className="character-card-top">
                  <span className="avatar avatar-muted" aria-hidden>
                    <UserRound size={18} />
                  </span>
                  <span className={`badge ${ch.side === 'defendant' ? 'badge-defendant' : ''}`}>
                    {characterBadge(ch.role, ch.side)}
                  </span>
                </div>
                <p className="character-name">{ch.name}</p>
                <p className="hint">{ch.title}</p>
                <p className="character-knows">
                  {ch.documentIds.length === 0 ? (
                    <span className="badge badge-warning">Knows nothing yet</span>
                  ) : (
                    <span className="hint">
                      Knows {ch.documentIds.length} document{ch.documentIds.length === 1 ? '' : 's'}
                    </span>
                  )}
                </p>
                <div className="character-card-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Edit ${ch.name}`}
                    onClick={() => setEditing(ch.id)}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Delete ${ch.name}`}
                    onClick={() => {
                      if (window.confirm(`Delete ${ch.name}?`)) {
                        void run(() => api.deleteCharacter(c.id, ch.id)).catch(() => {})
                      }
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      {c.characters.length > 0 && c.documents.length > 0 && (
        <div className="grid-scroll">
          <table className="data-table knows-grid">
            <caption>What each character knows</caption>
            <thead>
              <tr>
                <th scope="col">Character</th>
                {c.documents.map((doc) => (
                  <th scope="col" key={doc.id}>
                    {doc.filename}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {c.characters.map((ch) => (
                <tr key={ch.id}>
                  <th scope="row">{ch.name}</th>
                  {c.documents.map((doc) => (
                    <td key={doc.id}>
                      <input
                        type="checkbox"
                        aria-label={`${ch.name} knows ${doc.filename}`}
                        checked={isLinked(ch, doc.id)}
                        onChange={() => toggleKnows(ch, doc.id)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {c.characters.length > 0 && c.documents.length === 0 && (
        <p className="hint">Upload case files to choose what each character knows.</p>
      )}
    </section>
  )
}
