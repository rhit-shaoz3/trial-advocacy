import { useContext, useEffect, useState, type FormEvent } from 'react'
import { Flag } from 'lucide-react'
import type { FlagKind } from '../courses/types'
import { FlagsContext } from './flagsContext'

const STATUS: Record<'open' | 'kept' | 'changed', string> = {
  open: 'Flagged · waiting for your instructor',
  kept: 'Your instructor looked at your flag and kept it as it is',
  changed: 'Your instructor looked at your flag and changed it',
}

/**
 * Flags one thing decided automatically, with the team's reason: a fact, a
 * file (with the report it came with), or a subpoena's answer. Once flagged,
 * it shows where the flag stands instead.
 */
export function FlagButton({
  kind,
  targetId,
  reviewId,
  label = 'Flag for your instructor',
  what,
}: {
  kind: FlagKind
  targetId: string
  reviewId?: string
  label?: string
  /** What's being flagged, for the screen reader label. */
  what: string
}) {
  const context = useContext(FlagsContext)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The newest flag on it says where it stands.
  const flag = context?.flags.find((f) => f.kind === kind && f.targetId === targetId)
  const unread = flag?.status === 'resolved' && !flag.seen
  useEffect(() => {
    // Shown is read; the New badge stays until the page reloads the flags.
    if (unread) context?.markSeen()
  }, [unread, context])
  if (!context) return null

  if (flag) {
    const status = flag.status === 'open' ? 'open' : (flag.resolution ?? 'kept')
    return (
      <p className={`cw-flag-status cw-flag-${status}`}>
        <Flag aria-hidden="true" />
        {STATUS[status]}
        {flag.status === 'resolved' && !flag.seen && <span className="cw-badge cw-badge-new">New</span>}
      </p>
    )
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await context!.raise({ kind, targetId, reviewId, reason: reason.trim() })
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return open ? (
    <form className="cw-flag-form" onSubmit={submit}>
      <label>
        What do you think is wrong?
        <textarea value={reason} rows={3} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="cw-flag-actions">
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={busy || !reason.trim()}>
          {busy ? 'Sending…' : 'Send to your instructor'}
        </button>
      </div>
    </form>
  ) : (
    <button type="button" className="link-button cw-flag-button" onClick={() => setOpen(true)} aria-label={`${label}: ${what}`}>
      <Flag aria-hidden="true" />
      {label}
    </button>
  )
}
