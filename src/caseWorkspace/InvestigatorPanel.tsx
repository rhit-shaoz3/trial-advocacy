import { useState, type FormEvent } from 'react'
import { Clock, Download, Lock, Mail, Paperclip, Send } from 'lucide-react'
import { WitnessAvatar } from '../components/WitnessAvatar'
import { fileTypeLabel, formatSize, shortDate } from '../courses/caseLabels'
import type { Investigation } from '../courses/types'

/** The longest assignment a team can send (matches the server). */
const MAX_ASSIGNMENT_LENGTH = 4000

const WHAT_HE_DOES = [
  'Search public records, news coverage, and public social media',
  'Find and interview people who aren’t witnesses yet: neighbors, bystanders, former employees',
  'Inspect, photograph, and measure the scene',
  'Watch people, including named witnesses, from public places',
  'Request public government records',
]

/**
 * The case's background investigator, for a team: who he is and what he can
 * do, the reports he's sent back (after the instructor's review), and an
 * email to send him the next assignment. Locked until the investigate phase.
 */
export function InvestigatorPanel({
  investigator,
  available,
  teamName,
  investigations,
  downloadUrl,
  onSend,
}: {
  investigator: { name: string; avatarUrl: string }
  available: boolean
  /** "Team 3", or null before the team is matched. */
  teamName: string | null
  /** The team's requests, newest first; leave out (the preview) to show him without them. */
  investigations?: Investigation[]
  downloadUrl(materialId: string): string
  /** Sends an assignment; leave out (the preview, or a closed case) to hide the email. */
  onSend?(assignment: string): Promise<void>
}) {
  const reports = investigations?.filter((i) => i.status === 'completed') ?? []
  const working = investigations?.find((i) => i.status === 'working')
  const [latest, ...earlier] = reports

  return (
    <section className="cw-card cw-investigator" aria-labelledby="cw-investigator-title">
      <div className="cw-investigator-profile">
        <WitnessAvatar src={investigator.avatarUrl} size="xl" />
        <div>
          <span className="ws-eyebrow">Background investigator</span>
          <h2 id="cw-investigator-title">{investigator.name}</h2>
          <p className="cw-section-sub">
            A licensed private investigator working for your team. Email him an assignment and he&rsquo;ll report back
            with what he finds. Your instructor reviews every report before it reaches you.
          </p>
        </div>
      </div>
      <div className="cw-investigator-scope">
        <div>
          <h3>He can</h3>
          <ul>
            {WHAT_HE_DOES.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3>He can&rsquo;t</h3>
          <ul>
            <li>Interview anyone already named as a witness, or contact the other side</li>
            <li>Get private records (phone, bank, medical) without a subpoena</li>
            <li>Follow anyone into private places, or track them</li>
            <li>Lie about who he works for, or get into anyone&rsquo;s accounts</li>
          </ul>
        </div>
      </div>

      {!available ? (
        <p className="cw-investigator-locked">
          <Lock aria-hidden="true" />
          {investigator.name} becomes available in the investigate phase.
        </p>
      ) : (
        <>
          {working && (
            <div className="cw-investigation-pending" role="status">
              <Clock aria-hidden="true" />
              <div>
                <strong>{investigator.name} is on it.</strong>
                <p>
                  Sent {shortDate(working.sentAt)}
                  {working.askedBy && ` by ${working.askedBy}`}. His report comes back once your instructor has
                  reviewed it; you can send the next assignment then.
                </p>
                <blockquote>{working.assignment}</blockquote>
              </div>
            </div>
          )}

          {latest && <InvestigatorReport investigation={latest} downloadUrl={downloadUrl} latest />}

          {onSend && !working && teamName && (
            <InvestigatorEmail name={investigator.name} teamName={teamName} onSend={onSend} />
          )}
          {!teamName && <p className="cw-empty">Your team can email the investigator once it&rsquo;s in a case world.</p>}

          {earlier.length > 0 && (
            <section className="cw-investigation-history" aria-labelledby="cw-investigation-history">
              <h3 id="cw-investigation-history">Earlier reports</h3>
              {earlier.map((r) => (
                <InvestigatorReport key={r.id} investigation={r} downloadUrl={downloadUrl} />
              ))}
            </section>
          )}
        </>
      )}
    </section>
  )
}

/** One report back from the investigator: the assignment, his report, and any files it unlocked. */
export function InvestigatorReport({
  investigation: r,
  downloadUrl,
  latest = false,
  onOpen,
}: {
  investigation: Investigation
  downloadUrl(materialId: string): string
  /** The newest report shows in full; earlier ones open on a click. */
  latest?: boolean
  /** Called when the report is opened (to mark it read). */
  onOpen?(): void
}) {
  return (
    <details
      className={`cw-investigation${r.seen ? '' : ' cw-investigation-new'}`}
      open={latest}
      onToggle={(e) => e.currentTarget.open && onOpen?.()}
    >
      <summary>
        <Mail aria-hidden="true" />
        <span>
          <strong>Report{r.completedAt && ` · ${shortDate(r.completedAt)}`}</strong>
          <small>{r.assignment}</small>
        </span>
        {!r.seen && <span className="cw-badge cw-badge-new">New</span>}
      </summary>
      <div className="cw-investigation-body">
        <p className="cw-investigation-assignment">
          <span>Your assignment{r.askedBy && ` (sent by ${r.askedBy})`}</span>
          {r.assignment}
        </p>
        <p className="cw-investigation-report">{r.report}</p>
        {r.unlocked.length > 0 && (
          <div className="cw-investigation-files">
            <span>
              <Paperclip aria-hidden="true" />
              {r.unlocked.length === 1 ? '1 attachment' : `${r.unlocked.length} attachments`}, also in your case file
            </span>
            <ul>
              {r.unlocked.map((f) => (
                <li key={f.id}>
                  <a href={downloadUrl(f.id)} download={f.filename} aria-label={`Download ${f.title}`}>
                    <Download aria-hidden="true" />
                    <span className="cw-attachment-name">{f.title}</span>
                    <small>
                      {fileTypeLabel(f.contentType)} · {formatSize(f.sizeBytes)}
                    </small>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  )
}

/** The email to the investigator: the team's next assignment. */
function InvestigatorEmail({
  name,
  teamName,
  onSend,
}: {
  name: string
  teamName: string
  onSend(assignment: string): Promise<void>
}) {
  const [assignment, setAssignment] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const text = assignment.trim()
    if (!text) return
    setSending(true)
    setError(null)
    try {
      await onSend(text)
      setAssignment('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSending(false)
    }
  }

  return (
    <form className="cw-email" onSubmit={handleSubmit} aria-label={`Email ${name}`}>
      <div className="cw-email-head">
        <span>
          <small>To</small> {name}
        </span>
        <span>
          <small>From</small> {teamName}
        </span>
      </div>
      <label className="cw-sr" htmlFor="cw-email-body">
        Your assignment
      </label>
      <textarea
        id="cw-email-body"
        value={assignment}
        onChange={(e) => setAssignment(e.target.value)}
        placeholder={`What should ${name} look into? Be specific: who, what, where, and what you want to know.`}
        maxLength={MAX_ASSIGNMENT_LENGTH}
        rows={6}
        disabled={sending}
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="cw-email-actions">
        <small className="muted">One assignment at a time. Your instructor reviews his report first.</small>
        <button type="submit" className="ws-btn ws-btn-primary" disabled={sending || !assignment.trim()}>
          <Send aria-hidden="true" />
          {sending ? 'Sending…' : `Send to ${name}`}
        </button>
      </div>
    </form>
  )
}
