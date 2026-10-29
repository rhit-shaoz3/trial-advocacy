import { useState, type ReactNode } from 'react'
import { Check, Sparkles, X } from 'lucide-react'
import type { CheckTag, DiscoveryCheck } from '../../courses/types'

const TAG_LABEL: Record<CheckTag, string> = {
  LOOKS_GOOD: 'Looks good',
  SMALL_EDITS: 'Small edits',
  NEEDS_IMPROVEMENT: 'Needs improvement',
}

/**
 * The footer of a discovery draft (a subpoena, a set of interrogatories or
 * RFAs, or the answers to one), with "Check with AI" before sending: an
 * experienced trial attorney reviews the draft. Looks good reveals the send
 * button; small edits or needs improvement show the mentor's questions, with
 * Check again first and sending anyway still possible. Editing after a check
 * makes it out of date. Without `onCheck` (a preview, or no AI), it's just the
 * send button.
 */
export function AiCheck({
  info,
  ready,
  draftKey,
  onCheck,
  onSubmit,
  submitIcon,
  submitLabel,
  busyLabel,
  anywayLabel,
  blocked = false,
}: {
  /** What the footer says on the left (deadlines, what happens next). */
  info?: ReactNode
  /** Whether the draft is complete enough to check or send. */
  ready: boolean
  /** The draft as a string, to tell when it's been edited since the check. */
  draftKey: string
  onCheck?(): Promise<DiscoveryCheck>
  /** Sends it, with the last check's id; throws to show an error. */
  onSubmit(checkId?: string): Promise<void>
  submitIcon?: ReactNode
  submitLabel: string
  busyLabel: string
  /** The send button when the check asked for changes, e.g. "Serve anyway". */
  anywayLabel: string
  /** Sending isn't possible (over the team's limit, say). */
  blocked?: boolean
}) {
  const [check, setCheck] = useState<(DiscoveryCheck & { key: string }) | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkFailed, setCheckFailed] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stale = check !== null && check.key !== draftKey
  const good = check?.tag === 'LOOKS_GOOD' && !stale

  async function runCheck() {
    if (!onCheck) return
    setChecking(true)
    setError(null)
    setCheckFailed(false)
    try {
      const result = await onCheck()
      setCheck({ ...result, key: draftKey })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setCheckFailed(true)
    } finally {
      setChecking(false)
    }
  }

  async function send() {
    setSending(true)
    setError(null)
    try {
      await onSubmit(check?.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setSending(false)
    }
  }

  const busy = checking || sending
  const sendButton = (primary: boolean, label: string) => (
    <button type="button" className={`ws-btn ${primary ? 'ws-btn-primary' : 'ws-btn-secondary'}`} onClick={send} disabled={busy || !ready || blocked}>
      {submitIcon}
      {sending ? busyLabel : label}
    </button>
  )
  const checkButton = (label: string) => (
    <button type="button" className="ws-btn ws-btn-primary" onClick={runCheck} disabled={busy || !ready}>
      <Sparkles aria-hidden="true" />
      {label}
    </button>
  )

  let actions: ReactNode
  if (!onCheck) actions = sendButton(true, submitLabel)
  else if (checking) actions = checkButton('Checking…')
  else if (checkFailed && !check) {
    // A down AI never blocks the class.
    actions = (
      <>
        {sendButton(false, `${submitLabel} without a check`)}
        {checkButton('Try again')}
      </>
    )
  } else if (!check) actions = checkButton('Check with AI')
  else if (good) actions = sendButton(true, submitLabel)
  else {
    actions = (
      <>
        {sendButton(false, anywayLabel)}
        {checkButton('Check again')}
      </>
    )
  }

  return (
    <div className="ai-check">
      {(checking || check) && (
        <div className={`ai-check-result${check && !checking ? ` ai-check-${check.tag.toLowerCase()}` : ''}`}>
          <p className="ai-check-status" role="status">
            {checking ? (
              <>
                <span className="ai-check-icon ai-check-spinner" aria-hidden="true" />
                Checking your draft…
              </>
            ) : (
              check && (
                <>
                  <span className="ai-check-icon" aria-hidden="true">
                    {check.tag === 'LOOKS_GOOD' ? <Check /> : check.tag === 'SMALL_EDITS' ? '~' : <X />}
                  </span>
                  {TAG_LABEL[check.tag]}
                  {stale && <span className="ai-check-stale">You&rsquo;ve edited since this check.</span>}
                </>
              )
            )}
          </p>
          {check && !checking && check.tag !== 'LOOKS_GOOD' && check.feedback && (
            <div className="ai-check-feedback" aria-label="AI feedback">
              {check.feedback}
            </div>
          )}
        </div>
      )}
      <div className="ex-footer">
        {info && <span className="cw-section-sub">{info}</span>}
        <div className="ai-check-actions">{actions}</div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
