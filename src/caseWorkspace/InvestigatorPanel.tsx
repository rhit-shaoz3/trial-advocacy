import { useState, type FormEvent } from 'react'
import { Clock, Download, FilePen, FileText, Lock, Mail, Paperclip, Send, Trash2 } from 'lucide-react'
import type { ViewableFile } from '../components/FileViewer'
import { WitnessAvatar } from '../components/WitnessAvatar'
import { fileTypeLabel, formatSize, shortDate } from '../courses/caseLabels'
import type { InteractionLimit, Investigation, MessageDraft, MessageDraftActions } from '../courses/types'
import { DictationTextarea } from '../components/Dictation'
import { FlagButton } from './flags'

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
 * email to send him the next assignment, while the instructor's limit allows.
 * Locked until the investigate phase.
 */
export function InvestigatorPanel({
  investigator,
  available,
  teamName,
  investigations,
  downloadUrl,
  onOpenFile,
  onSend,
  reviewLite,
  drafts,
  draftActions,
}: {
  investigator: { name: string; avatarUrl: string; limit?: InteractionLimit }
  available: boolean
  /** "Team 3", or null before the team is matched. */
  teamName: string | null
  /** The team's requests, newest first; leave out (the preview) to show him without them. */
  investigations?: Investigation[]
  downloadUrl(materialId: string): string
  /** Opens an attached file in the viewer; leave out to only offer downloads. */
  onOpenFile?(file: ViewableFile): void
  /** Sends an assignment (from a draft, which sending deletes); leave out (the preview, or a closed case) to hide the email. */
  onSend?(assignment: string, draftId?: string): Promise<void>
  /** Review lite: reports come straight back, without the instructor's review. */
  reviewLite?: boolean
  /** The team's unsent emails to him; leave out (the preview) to not keep drafts. */
  drafts?: MessageDraft[]
  draftActions?: MessageDraftActions
}) {
  const ours = (drafts ?? []).filter((d) => d.kind === 'investigator')
  /** The draft open in the email, if any. */
  const [editing, setEditing] = useState<MessageDraft | null>(null)
  const reports = investigations?.filter((i) => i.status === 'completed') ?? []
  const working = investigations?.find((i) => i.status === 'working')
  const [latest, ...earlier] = reports
  const limit = investigator.limit
  // Every request counts, the team's or (per student) this student's.
  const used = limit && investigations ? investigations.filter((i) => limit.per === 'team' || i.mine).length : 0
  const usedUp = Boolean(limit && used >= limit.max)

  return (
    <section className="cw-card cw-investigator" aria-labelledby="cw-investigator-title">
      <div className="cw-investigator-profile">
        <WitnessAvatar src={investigator.avatarUrl} size="xl" />
        <div>
          <span className="ws-eyebrow">Background investigator</span>
          <h2 id="cw-investigator-title">{investigator.name}</h2>
          <p className="cw-section-sub">
            A licensed private investigator working for your team. Email him an assignment and he&rsquo;ll report back
            with what he finds.{' '}
            {reviewLite
              ? 'His reports come straight to you; flag anything you think is wrong for your instructor.'
              : 'Your instructor reviews every report before it reaches you.'}
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
                  {working.askedBy && ` by ${working.askedBy}`}.{' '}
                  {reviewLite
                    ? 'His report comes back as soon as it’s written; you can send the next assignment then.'
                    : 'His report comes back once your instructor has reviewed it; you can send the next assignment then.'}
                </p>
                <blockquote>{working.assignment}</blockquote>
              </div>
            </div>
          )}

          {latest && <InvestigatorReport investigation={latest} downloadUrl={downloadUrl} onOpenFile={onOpenFile} latest />}

          {limit && investigations && teamName && (
            <p className="cw-investigator-limit">
              {used} of {limit.max} {limit.max === 1 ? 'request' : 'requests'} used{' '}
              {limit.per === 'student' ? 'by you' : 'by your team'} · {Math.max(0, limit.max - used)} left
            </p>
          )}
          {onSend && !working && teamName && !usedUp && (
            <InvestigatorEmail
              key={editing?.id ?? 'new'}
              name={investigator.name}
              teamName={teamName}
              draft={editing ?? undefined}
              draftActions={draftActions}
              onSend={async (assignment, draftId) => {
                await onSend(assignment, draftId)
                setEditing(null)
              }}
              onDraftSaved={() => setEditing(null)}
              reviewLite={reviewLite}
            />
          )}
          {ours.length > 0 && onSend && teamName && (
            <section className="cw-investigator-drafts" aria-labelledby="cw-investigator-drafts">
              <h3 id="cw-investigator-drafts">Drafts</h3>
              <ul>
                {ours.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      className="cw-draft-open"
                      aria-current={editing?.id === d.id ? 'true' : undefined}
                      disabled={Boolean(working) || usedUp}
                      onClick={() => setEditing(d)}
                    >
                      <FilePen aria-hidden="true" />
                      <span>{draftLine(d)}</span>
                      <small>
                        {shortDate(d.updatedAt)}
                        {d.updatedBy && ` · ${d.updatedBy}`}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {onSend && !working && teamName && usedUp && (
            <p className="cw-empty">
              {limit!.per === 'student' ? 'You’ve' : 'Your team has'} used{' '}
              {limit!.max === 1 ? 'the one request' : `all ${limit!.max} requests`} your instructor allows to{' '}
              {investigator.name}.
            </p>
          )}
          {!teamName && <p className="cw-empty">Your team can email the investigator once it&rsquo;s in a case world.</p>}

          {earlier.length > 0 && (
            <section className="cw-investigation-history" aria-labelledby="cw-investigation-history">
              <h3 id="cw-investigation-history">Earlier reports</h3>
              {earlier.map((r) => (
                <InvestigatorReport key={r.id} investigation={r} downloadUrl={downloadUrl} onOpenFile={onOpenFile} />
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
  onOpenFile,
  latest = false,
  onOpen,
}: {
  investigation: Investigation
  downloadUrl(materialId: string): string
  /** Opens an attached file in the viewer; leave out to only offer downloads. */
  onOpenFile?(file: ViewableFile): void
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
        {r.facts?.some((f) => f.auto) && (
          // Review lite: what he turned up stands without the instructor, so the team can flag it.
          <div className="cw-investigation-facts">
            <span>What the investigator turned up</span>
            <ul>
              {r.facts.map((f) => (
                <li key={f.id}>
                  {f.text}
                  {f.auto && <FlagButton kind="fact" targetId={f.id} what={f.text} />}
                </li>
              ))}
            </ul>
          </div>
        )}
        {r.unlocked.length > 0 && (
          <div className="cw-investigation-files">
            <span>
              <Paperclip aria-hidden="true" />
              {r.unlocked.length === 1 ? '1 attachment' : `${r.unlocked.length} attachments`}, also in your case file
            </span>
            <ul>
              {r.unlocked.map((f) => (
                <li key={f.id}>
                  {onOpenFile ? (
                    <>
                      <button
                        type="button"
                        className="cw-attachment"
                        title={`Open ${f.title} in the viewer`}
                        onClick={() => onOpenFile(f)}
                      >
                        <FileText aria-hidden="true" />
                        <span className="cw-attachment-name">{f.title}</span>
                        <small>
                          {fileTypeLabel(f.contentType)} · {formatSize(f.sizeBytes)}
                        </small>
                      </button>
                      <a
                        className="cw-attachment-download"
                        href={downloadUrl(f.id)}
                        download={f.filename}
                        aria-label={`Download ${f.title}`}
                        title="Download"
                      >
                        <Download aria-hidden="true" />
                      </a>
                    </>
                  ) : (
                    <a href={downloadUrl(f.id)} download={f.filename} aria-label={`Download ${f.title}`}>
                      <Download aria-hidden="true" />
                      <span className="cw-attachment-name">{f.title}</span>
                      <small>
                        {fileTypeLabel(f.contentType)} · {formatSize(f.sizeBytes)}
                      </small>
                    </a>
                  )}
                  {f.auto && <FlagButton kind="document" targetId={f.id} reviewId={r.id} what={f.title} />}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  )
}

const draftLine = (d: MessageDraft) => {
  const text = 'assignment' in d.content ? d.content.assignment.trim() : ''
  return text ? (text.length > 90 ? `${text.slice(0, 89).trimEnd()}…` : text) : 'Empty draft'
}

/**
 * The email to the investigator: the team's next assignment. With
 * `draftActions`, it can be saved as a draft to finish later. Also opened
 * from the planner, filled in from a gap (`prefill`).
 */
export function InvestigatorEmail({
  name,
  teamName,
  draft,
  prefill,
  draftActions,
  onSend,
  onDraftSaved,
  reviewLite,
}: {
  name: string
  teamName: string
  /** The draft to carry on with. */
  draft?: MessageDraft
  prefill?: string
  draftActions?: MessageDraftActions
  onSend(assignment: string, draftId?: string): Promise<void>
  /** After Save as draft (or deleting the draft). */
  onDraftSaved?(): void
  reviewLite?: boolean
}) {
  const [assignment, setAssignment] = useState(() => (draft && 'assignment' in draft.content ? draft.content.assignment : (prefill ?? '')))
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const text = assignment.trim()
    if (!text) return
    setSending(true)
    setError(null)
    try {
      await onSend(text, draft?.id)
      setAssignment('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSending(false)
    }
  }

  async function keep(action: () => Promise<unknown>) {
    setSending(true)
    setError(null)
    try {
      await action()
      onDraftSaved?.()
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
      <DictationTextarea
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
        <small className="muted">
          One assignment at a time.{reviewLite ? '' : ' Your instructor reviews his report first.'}
        </small>
        <span className="cw-email-buttons">
          {draft && draftActions && (
            <button
              type="button"
              className="ws-btn ws-btn-secondary"
              disabled={sending}
              onClick={() => window.confirm('Delete this draft?') && void keep(() => draftActions.remove(draft.id))}
            >
              <Trash2 aria-hidden="true" />
              Delete draft
            </button>
          )}
          {draftActions && (
            <button
              type="button"
              className="ws-btn ws-btn-secondary"
              disabled={sending || !assignment.trim()}
              onClick={() => void keep(() => draftActions.save('investigator', draft?.id ?? null, { assignment }))}
            >
              <FilePen aria-hidden="true" />
              Save as draft
            </button>
          )}
          <button type="submit" className="ws-btn ws-btn-primary" disabled={sending || !assignment.trim()}>
            <Send aria-hidden="true" />
            {sending ? 'Sending…' : `Send to ${name}`}
          </button>
        </span>
      </div>
    </form>
  )
}
