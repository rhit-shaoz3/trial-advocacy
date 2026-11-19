import { useId, useState } from 'react'
import { parsePages } from '../../courses/exhibitLabels'
import type { PlannerSource } from '../../courses/types'

const GROUP_LABEL: Record<PlannerSource['group'], string> = {
  'case-file': 'Case file',
  investigator: 'From the investigator',
  interviews: 'Your interviews and depositions',
  reports: 'Reports and replies',
}

export interface EvidenceChoice {
  source: PlannerSource
  parts: number[] | null
  excerpt: string
  note: string
}

/**
 * Choosing evidence for a card: a file, interview or report the team can
 * cite, whole or in part (a PDF's pages; a transcript's Q&A or a text's
 * paragraphs, as on the exhibit list), with the passage that matters and why.
 */
export function EvidencePicker({
  sources,
  onAdd,
  onCancel,
}: {
  sources: PlannerSource[] | null
  onAdd(choice: EvidenceChoice): Promise<void>
  onCancel(): void
}) {
  const id = useId()
  const [sourceKey, setSourceKey] = useState('')
  const [whole, setWhole] = useState(true)
  const [pages, setPages] = useState('')
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [excerpt, setExcerpt] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!sources) return <p className="muted">Loading what you can cite…</p>
  if (sources.length === 0) return <p className="muted">Your team has nothing to cite yet.</p>

  const source = sources.find((s) => `${s.kind}:${s.id}` === sourceKey) ?? null
  const choosable = Boolean(source && (source.paged || source.parts?.length))
  const parsed = source?.paged && !whole ? parsePages(pages) : null
  const parts = !source || whole || !choosable ? null : source.paged ? parsed : [...picked].sort((a, b) => a - b)
  const ready = Boolean(source) && (whole || !choosable || (parts !== null && parts.length > 0))
  const unit = source?.kind === 'interview' ? 'Q&A' : source?.paged ? 'pages' : 'paragraphs'

  const choose = (key: string) => {
    setSourceKey(key)
    setWhole(true)
    setPages('')
    setPicked(new Set())
  }

  async function add() {
    if (!source || !ready) return
    setBusy(true)
    setError(null)
    try {
      await onAdd({ source, parts, excerpt: excerpt.trim(), note: note.trim() })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  const groups = (Object.keys(GROUP_LABEL) as PlannerSource['group'][])
    .map((group) => ({ group, items: sources.filter((s) => s.group === group) }))
    .filter((g) => g.items.length > 0)

  return (
    <div className="pl-evidence-picker" role="group" aria-label="Add evidence">
      <label className="pl-field">
        <span className="pl-field-label">Source</span>
        <select value={sourceKey} onChange={(e) => choose(e.target.value)}>
          <option value="">Choose a file, interview, or report</option>
          {groups.map((g) => (
            <optgroup key={g.group} label={GROUP_LABEL[g.group]}>
              {g.items.map((s) => (
                <option key={`${s.kind}:${s.id}`} value={`${s.kind}:${s.id}`}>
                  {s.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      {source && choosable && (
        <fieldset className="pl-parts">
          <legend className="pl-field-label">Which part</legend>
          <label>
            <input type="radio" name={`${id}-whole`} checked={whole} onChange={() => setWhole(true)} />
            All of it
          </label>
          <label>
            <input type="radio" name={`${id}-whole`} checked={!whole} onChange={() => setWhole(false)} />
            Only some {unit}
          </label>
          {!whole && source.paged && (
            <label className="pl-field">
              <span className="pl-field-label">Pages</span>
              <input type="text" value={pages} onChange={(e) => setPages(e.target.value)} placeholder="e.g. 3–5, 9" />
              {pages.trim() && !parsed && <small className="pl-field-error">Write pages like 3–5, 9.</small>}
            </label>
          )}
          {!whole && source.parts && (
            <ul className="pl-part-list">
              {source.parts.map((p, i) => (
                <li key={p.n}>
                  <label>
                    <input
                      type="checkbox"
                      checked={picked.has(p.n)}
                      onChange={(e) =>
                        setPicked((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(p.n)
                          else next.delete(p.n)
                          return next
                        })
                      }
                    />
                    <span>
                      <strong>{source.kind === 'interview' ? `Q${i + 1}` : `¶${i + 1}`}</strong>{' '}
                      {p.question ? `${p.question} — ${p.text}` : p.text}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      )}

      <label className="pl-field">
        <span className="pl-field-label">The passage that matters (optional)</span>
        <textarea rows={2} value={excerpt} onChange={(e) => setExcerpt(e.target.value)} maxLength={4000} placeholder="Quote it, so you can check it says what the card claims." />
      </label>
      <label className="pl-field">
        <span className="pl-field-label">Why it matters (optional)</span>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} />
      </label>
      {error && (
        <p className="pl-error" role="alert">
          {error}
        </p>
      )}
      <div className="pl-actions">
        <button type="button" className="ws-btn ws-btn-primary" disabled={!ready || busy} onClick={() => void add()}>
          {busy ? 'Adding…' : 'Add evidence'}
        </button>
        <button type="button" className="ws-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
