import { useState, type ReactNode } from 'react'
import { Check, Sparkles, X } from 'lucide-react'
import type { CheckTag, DiscoveryCheck, KeyedCheck } from '../../courses/types'

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
 * makes it out of date. Without `onCheck` (a preview, or AI feedback off), it's
 * just the send button. A draft opened again starts with its last check
 * (`initialCheck`). When the case limits the rounds of feedback, the check
 * button says how many are left; after the last one it greys out and the send
 * button takes over.
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
  initialCheck = null,
  onCheckChange,
  extra,
  rounds = null,
  roundsUsed = 0,
}: {
  /** What the footer says on the left (deadlines, what happens next). */
  info?: ReactNode
  /** Whether the draft is complete enough to check or send. */
  ready: boolean
  /** The draft as a string, to tell when it's been edited since the check. */
  draftKey: string
  /** Checks the draft; `previousCheckId` is the check shown, when checking again. */
  onCheck?(previousCheckId?: string): Promise<DiscoveryCheck>
  /** Sends it, with the last check's id; throws to show an error. */
  onSubmit(checkId?: string): Promise<void>
  submitIcon?: ReactNode
  submitLabel: string
  busyLabel: string
  /** The send button when the check asked for changes, e.g. "Serve anyway". */
  anywayLabel: string
  /** Sending isn't possible (over the team's limit, say). */
  blocked?: boolean
  /** The last check of a draft opened again. */
  initialCheck?: KeyedCheck | null
  /** Called with each new check, to keep it with the draft. */
  onCheckChange?(check: KeyedCheck): void
  /** More buttons before the check and send buttons (the draft's). */
  extra?: ReactNode
  /** How many checks one draft gets; null for unlimited. */
  rounds?: number | null
  /** Checks already used before any shown here (answers to a set, after a refresh). */
  roundsUsed?: number
}) {
  const [check, setCheck] = useState<KeyedCheck | null>(initialCheck)
  const [checking, setChecking] = useState(false)
  const [checkFailed, setCheckFailed] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stale = check !== null && check.key !== draftKey
  const good = check?.tag === 'LOOKS_GOOD' && !stale
  const used = check ? (check.round ?? roundsUsed + 1) : roundsUsed
  const left = rounds === null ? null : Math.max(0, rounds - used)
  const outOfRounds = left === 0

  async function runCheck() {
    if (!onCheck) return
    setChecking(true)
    setError(null)
    setCheckFailed(false)
    try {
      const result = await onCheck(check?.id)
      const keyed = { ...result, key: draftKey }
      setCheck(keyed)
      onCheckChange?.(keyed)
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
  const pill = left === null ? null : left === 1 && used > 0 ? 'Last round' : `${left} left`
  const checkButton = (label: string) => (
    <button
      type="button"
      className={`ws-btn ${outOfRounds ? 'ws-btn-secondary' : 'ws-btn-primary'}`}
      onClick={runCheck}
      disabled={busy || !ready || outOfRounds}
      aria-label={pill ? `${label}, ${pill === 'Last round' ? 'last round' : `${left} ${left === 1 ? 'round' : 'rounds'} left`}` : undefined}
    >
      <Sparkles aria-hidden="true" />
      {label}
      {pill && !checking && <span className="ai-check-left">{pill}</span>}
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
  } else if (outOfRounds && !good) {
    // No rounds left: the check is greyed out, and sending is the way on.
    actions = (
      <>
        {checkButton(check ? 'Check again' : 'Check with AI')}
        {sendButton(true, submitLabel)}
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
        <div className="ai-check-actions">
          {extra}
          {actions}
        </div>
      </div>
      {outOfRounds && !good && !error && (
        <p className="ai-check-last">That was your last round of AI feedback. Send it when you&rsquo;re ready.</p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
