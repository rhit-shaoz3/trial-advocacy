import { useState } from 'react'
import { ChevronRight, FilePen, Trash2 } from 'lucide-react'
import { shortDate } from '../../courses/caseLabels'
import type { DiscoveryDraft, SubpoenaDraftContent } from '../../courses/types'
import { CheckBadge } from '../../components/CheckSummary'
import type { DraftStatus } from './useDraft'

const time = (at: Date) => at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/**
 * The draft's buttons in a new subpoena or set: whether it's saved, Cancel
 * (which deletes it, asking first once there's something in it), and Save as
 * draft (which saves and goes back to the list).
 */
export function DraftControls({
  status,
  empty,
  onSave,
  onCancel,
}: {
  status: DraftStatus
  empty: boolean
  onSave(): Promise<void>
  onCancel(): Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  if (confirming) {
    return (
      <span className="ex-confirm" role="group" aria-label="Delete this draft?">
        <span className="ex-confirm-text">Delete this draft?</span>
        <button type="button" className="ws-btn ws-btn-danger" disabled={busy} onClick={() => run(onCancel)}>
          {busy ? 'Deleting…' : 'Delete draft'}
        </button>
        <button type="button" className="ws-btn ws-btn-secondary" disabled={busy} onClick={() => setConfirming(false)}>
          Keep editing
        </button>
        {error && (
          <span className="form-error" role="alert">
            {error}
          </span>
        )}
      </span>
    )
  }
  return (
    <>
      <span className="ex-draft-status" role="status">
        {status.state === 'saving'
          ? 'Saving…'
          : status.state === 'saved'
            ? `Draft saved ${time(status.at)}`
            : status.state === 'error'
              ? 'Couldn’t save the draft'
              : ''}
      </span>
      <button type="button" className="ws-btn ws-btn-secondary" disabled={busy} onClick={() => (empty ? run(onCancel) : setConfirming(true))}>
        Cancel
      </button>
      <button type="button" className="ws-btn ws-btn-secondary" disabled={busy || empty} onClick={() => run(onSave)}>
        <FilePen aria-hidden="true" />
        Save as draft
      </button>
    </>
  )
}

const truncate = (text: string, max = 90) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)

/** What a draft is, for its row: who a subpoena is for, or a set's first line and how many. */
function describe(draft: DiscoveryDraft, unit: [string, string]) {
  if (draft.kind === 'subpoena') {
    const s = draft.content as SubpoenaDraftContent
    return { title: s.recipient.trim() ? `To ${truncate(s.recipient.trim(), 60)}` : 'Untitled subpoena', detail: '' }
  }
  const lines = ('items' in draft.content ? draft.content.items : []).map((l) => l.trim()).filter(Boolean)
  return {
    title: lines[0] ? truncate(lines[0]) : 'Untitled set',
    detail: `${lines.length} ${lines.length === 1 ? unit[0] : unit[1]} · `,
  }
}

/** The team's unsent subpoenas or sets of one kind: open one to carry on, or delete it. */
export function DraftsList({
  drafts,
  unit = ['item', 'items'],
  onOpen,
  onDelete,
  now,
}: {
  drafts: DiscoveryDraft[]
  /** What a set's lines are called, e.g. ['question', 'questions']. */
  unit?: [string, string]
  onOpen(draft: DiscoveryDraft): void
  onDelete(id: string): Promise<void>
  now: Date
}) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (drafts.length === 0) return null

  async function remove(id: string) {
    setError(null)
    try {
      await onDelete(id)
      setConfirming(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  return (
    <section className="cw-card ex-section ex-drafts" aria-labelledby="ex-drafts-title">
      <h3 id="ex-drafts-title" className="ex-subtitle">
        Drafts
      </h3>
      <p className="cw-section-sub">Saved as your team writes them. Only your team sees these until you send one.</p>
      <ul className="ex-sets">
        {drafts.map((d) => {
          const { title, detail } = describe(d, unit)
          return (
            <li key={d.id} className="ex-draft-row">
              {confirming === d.id ? (
                <span className="ex-confirm" role="group" aria-label={`Delete ${title}?`}>
                  <span className="ex-confirm-text">Delete “{title}”?</span>
                  <button type="button" className="ws-btn ws-btn-danger" onClick={() => remove(d.id)}>
                    Delete draft
                  </button>
                  <button type="button" className="ws-btn ws-btn-secondary" onClick={() => setConfirming(null)}>
                    Keep it
                  </button>
                </span>
              ) : (
                <>
                  <button type="button" className="ex-set-row ex-set-link" onClick={() => onOpen(d)}>
                    <span className="ws-icon-tile ws-icon-tile-sm ws-tone-grey" aria-hidden="true">
                      <FilePen />
                    </span>
                    <span className="cw-row-body">
                      <strong>{title}</strong>
                      <small>
                        {detail}Edited {shortDate(d.updatedAt, now)}
                        {d.updatedBy ? ` by ${d.updatedBy}` : ''}
                      </small>
                      {d.lastCheck && <CheckBadge tag={d.lastCheck.tag} />}
                    </span>
                    <ChevronRight className="cw-row-end" aria-hidden="true" />
                  </button>
                  <button type="button" className="ex-icon-button" aria-label={`Delete draft: ${title}`} onClick={() => setConfirming(d.id)}>
                    <Trash2 aria-hidden="true" />
                  </button>
                </>
              )}
            </li>
          )
        })}
      </ul>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
