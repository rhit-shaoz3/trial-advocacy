import { useEffect, useState, type FormEvent } from 'react'
import { Clock, Download, FileText, Inbox, Mail, MailOpen, Paperclip, PenSquare, Send, X } from 'lucide-react'
import type { ViewableFile } from '../../components/FileViewer'
import { WitnessAvatar } from '../../components/WitnessAvatar'
import { DictationTextarea } from '../../components/Dictation'
import { dueLabel, fileTypeLabel, formatSize, shortDate } from '../../courses/caseLabels'
import type { ClientEmail, ClientEmailInput, InteractionLimit, WorkspaceWitness } from '../../courses/types'
import { TeachMe } from '../exchange/TeachMe'
import { TeachMeButton } from '../exchange/TeachMeButton'
import { FlagButton } from '../flags'
import '../exchange/exchange.css'
import './clientInbox.css'
import { splitReply } from './splitReply'

/** The longest subject and email a team can send (match the server). */
const MAX_SUBJECT_LENGTH = 200
const MAX_BODY_LENGTH = 4000

type Folder = 'inbox' | 'sent'

/** One message in the inbox: the team's email (sent), or the clients' reply to it (received). */
interface Message {
  key: string
  kind: 'sent' | 'received'
  email: ClientEmail
  date: string
}

const messagesOf = (emails: ClientEmail[]): Message[] =>
  emails
    .flatMap((e): Message[] => [
      { key: `sent:${e.id}`, kind: 'sent', email: e, date: e.sentAt },
      ...(e.status === 'completed' && e.repliedAt ? [{ key: `received:${e.id}`, kind: 'received' as const, email: e, date: e.repliedAt }] : []),
    ])
    .sort((a, b) => b.date.localeCompare(a.date))

/**
 * The team's email with its clients, laid out like an inbox: what came back
 * (Inbox) and what the team sent (Sent), the open message, and a Compose
 * button while the instructor's limit allows. `composeTo` opens Compose
 * addressed to those clients, as from a witness's Email button.
 */
export function ClientInbox({
  clients,
  emails,
  limit,
  teamName,
  downloadUrl,
  onOpenFile,
  onSend,
  reviewLite,
  composeTo,
  onComposeOpened,
}: {
  clients: WorkspaceWitness[]
  /** The team's emails, newest first; leave out (the preview) to show the inbox empty. */
  emails?: ClientEmail[]
  limit?: InteractionLimit
  /** "Team 3", or null before the team is matched. */
  teamName: string | null
  downloadUrl(materialId: string): string
  onOpenFile?(file: ViewableFile): void
  /** Sends an email; leave out (the preview, or a closed case) to hide Compose. */
  onSend?(email: ClientEmailInput): Promise<void>
  /** Review lite: replies come straight back, without the instructor's review. */
  reviewLite?: boolean
  /** Clients to open Compose to, or null. */
  composeTo?: string[] | null
  /** Called once `composeTo` has opened Compose, so it isn't opened again. */
  onComposeOpened?(): void
}) {
  const list = emails ?? []
  const [folder, setFolder] = useState<Folder>('inbox')
  const messages = messagesOf(list)
  const shown = messages.filter((m) => (folder === 'inbox' ? m.kind === 'received' : m.kind === 'sent'))
  const [selected, setSelected] = useState<string | null>(null)
  const open = shown.find((m) => m.key === selected) ?? shown[0] ?? null
  const [composing, setComposing] = useState<string[] | null>(null)
  const [teach, setTeach] = useState<DOMRect | null>(null)

  const waiting = list.find((e) => e.status === 'working')
  const used = limit ? list.filter((e) => limit.per === 'team' || e.mine).length : 0
  const usedUp = Boolean(limit && used >= limit.max)
  const canCompose = Boolean(onSend && teamName && !waiting && !usedUp)
  const unread = list.filter((e) => e.status === 'completed' && !e.seen).length

  useEffect(() => {
    if (!composeTo) return
    if (canCompose) setComposing(composeTo)
    onComposeOpened?.()
  }, [composeTo, canCompose, onComposeOpened])

  const names = clients.map((c) => c.name).join(', ')

  return (
    <section className="cw-card ci" aria-labelledby="ci-title">
      <header className="ci-head">
        <div className="ci-who">
          {clients.slice(0, 3).map((c) => (
            <WitnessAvatar key={c.id} src={c.avatarUrl} size="lg" />
          ))}
          <div>
            <span className="ws-eyebrow">Client email</span>
            <h2 id="ci-title">{clients.length === 1 ? clients[0].name : 'Your clients'}</h2>
            <p className="cw-section-sub">
              {clients.length > 1 ? `${names}. ` : ''}Email your client for documents and details they have.{' '}
              {reviewLite
                ? 'Replies come straight to you; flag anything you think is wrong for your instructor.'
                : 'Your instructor reviews every reply before it reaches you.'}
            </p>
          </div>
        </div>
        <div className="ci-actions">
          <TeachMeButton variant="compact" about="Emailing your client" onOpen={setTeach} />
          {onSend && teamName && (
            <button
              type="button"
              className="ws-btn ws-btn-primary"
              onClick={() => setComposing(clients.map((c) => c.id))}
              disabled={!canCompose}
              title={waiting ? 'Wait for the reply to your last email first.' : usedUp ? 'Your team has used its emails.' : undefined}
            >
              <PenSquare aria-hidden="true" />
              Compose
            </button>
          )}
        </div>
      </header>

      {limit && teamName && (
        <p className="ci-limit">
          {used} of {limit.max} {limit.max === 1 ? 'email' : 'emails'} used {limit.per === 'student' ? 'by you' : 'by your team'} ·{' '}
          {Math.max(0, limit.max - used)} left
          {waiting && ' · Waiting for a reply to your last email'}
        </p>
      )}
      {!teamName && <p className="cw-empty">Your team can email its client once it&rsquo;s in a case world.</p>}

      {composing && onSend && teamName && (
        <Compose
          key={composing.join(' ')}
          clients={clients}
          initialTo={composing}
          teamName={teamName}
          reviewLite={reviewLite}
          onSend={async (email) => {
            await onSend(email)
            setComposing(null)
            setFolder('sent')
            setSelected(null)
          }}
          onCancel={() => setComposing(null)}
        />
      )}

      <div className="ci-box">
        <nav className="ci-list" aria-label="Messages">
          <div className="ci-folders" role="tablist" aria-label="Folders">
            <button type="button" role="tab" aria-selected={folder === 'inbox'} onClick={() => setFolder('inbox')}>
              <Inbox aria-hidden="true" />
              Inbox
              {unread > 0 && <span className="ci-count">{unread}</span>}
            </button>
            <button type="button" role="tab" aria-selected={folder === 'sent'} onClick={() => setFolder('sent')}>
              <Send aria-hidden="true" />
              Sent
            </button>
          </div>
          {shown.length === 0 ? (
            <p className="ci-none">{folder === 'inbox' ? 'No replies yet.' : 'Nothing sent yet.'}</p>
          ) : (
            <ul>
              {shown.map((m) => {
                const unseen = m.kind === 'received' && !m.email.seen
                return (
                  <li key={m.key}>
                    <button
                      type="button"
                      className={`ci-item${open?.key === m.key ? ' ci-item-open' : ''}${unseen ? ' ci-item-unread' : ''}`}
                      aria-current={open?.key === m.key ? 'true' : undefined}
                      onClick={() => setSelected(m.key)}
                    >
                      <span className="ci-item-top">
                        <span className="ci-item-who">
                          {m.kind === 'received' ? (splitReply(m.email.reply ?? '').headers.from ?? names) : `To: ${m.email.to.join(', ')}`}
                        </span>
                        <small>{shortDate(m.date)}</small>
                      </span>
                      <span className="ci-item-subject">
                        {m.kind === 'received' ? `Re: ${m.email.subject}` : m.email.subject}
                        {m.kind === 'received' && m.email.attachments.length > 0 && (
                          <Paperclip aria-label={`${m.email.attachments.length} attachments`} />
                        )}
                      </span>
                      {m.kind === 'sent' && m.email.status === 'working' && (
                        <small className="ci-item-waiting">
                          <Clock aria-hidden="true" />
                          {reviewLite ? 'Waiting for a reply' : 'Waiting for a reply (your instructor reviews it first)'}
                        </small>
                      )}
                      {unseen && <span className="cw-badge cw-badge-new">New</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </nav>
        <div className="ci-read">
          {open ? (
            <Reading message={open} names={names} teamName={teamName} downloadUrl={downloadUrl} onOpenFile={onOpenFile} />
          ) : (
            <p className="ci-none ci-read-none">
              <MailOpen aria-hidden="true" />
              {folder === 'inbox' ? 'Your client’s replies show up here.' : 'Emails you send show up here.'}
            </p>
          )}
        </div>
      </div>

      {teach && <TeachMe topic="client" from={teach} onClose={() => setTeach(null)} />}
    </section>
  )
}

/** The open message, laid out as an email. */
function Reading({
  message: { kind, email },
  names,
  teamName,
  downloadUrl,
  onOpenFile,
}: {
  message: Message
  names: string
  teamName: string | null
  downloadUrl(materialId: string): string
  onOpenFile?(file: ViewableFile): void
}) {
  const reply = kind === 'received' ? splitReply(email.reply ?? '') : null
  const from = reply ? (reply.headers.from ?? names) : `${email.from ?? 'Your team'}${teamName ? ` (${teamName})` : ''}`
  const to = reply ? 'Your team' : email.to.join(', ')
  const subject = reply ? (reply.headers.subject ?? `Re: ${email.subject}`) : email.subject
  const date = reply ? email.repliedAt! : email.sentAt
  return (
    <article className="ci-message" aria-label={subject}>
      <h3>{subject}</h3>
      <dl className="ci-headers">
        <div>
          <dt>From</dt>
          <dd>{from}</dd>
        </div>
        <div>
          <dt>To</dt>
          <dd>{to}</dd>
        </div>
        <div>
          <dt>Date</dt>
          <dd>{dueLabel(date)}</dd>
        </div>
      </dl>
      <p className="ci-body">{reply ? reply.body : email.body}</p>
      {kind === 'sent' && email.status === 'working' && (
        <p className="ci-pending" role="status">
          <Clock aria-hidden="true" />
          Waiting for a reply.
        </p>
      )}
      {reply && email.facts?.some((f) => f.auto) && (
        // Review lite: what the client said stands without the instructor, so the team can flag it.
        <div className="cw-investigation-facts">
          <span>What your client told you</span>
          <ul>
            {email.facts.map((f) => (
              <li key={f.id}>
                {f.text}
                {f.auto && <FlagButton kind="fact" targetId={f.id} what={f.text} />}
              </li>
            ))}
          </ul>
        </div>
      )}
      {reply && email.attachments.length > 0 && (
        <div className="cw-investigation-files">
          <span>
            <Paperclip aria-hidden="true" />
            {email.attachments.length === 1 ? '1 attachment' : `${email.attachments.length} attachments`}, also in your case file
          </span>
          <ul>
            {email.attachments.map((f) => (
              <li key={f.id}>
                {onOpenFile ? (
                  <>
                    <button type="button" className="cw-attachment" title={`Open ${f.title} in the viewer`} onClick={() => onOpenFile(f)}>
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
                  </a>
                )}
                {f.auto && <FlagButton kind="document" targetId={f.id} reviewId={email.id} what={f.title} />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  )
}

/** A new email to the team's clients: whom to, the subject, and what to ask. */
function Compose({
  clients,
  initialTo,
  teamName,
  reviewLite,
  onSend,
  onCancel,
}: {
  clients: WorkspaceWitness[]
  initialTo: string[]
  teamName: string
  reviewLite?: boolean
  onSend(email: ClientEmailInput): Promise<void>
  onCancel(): void
}) {
  const [to, setTo] = useState<string[]>(initialTo)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!to.length || !subject.trim() || !body.trim()) return
    setSending(true)
    setError(null)
    try {
      await onSend({ to, subject: subject.trim(), body: body.trim() })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setSending(false)
    }
  }

  return (
    <form className="cw-email ci-compose" onSubmit={handleSubmit} aria-label="New email to your client">
      <div className="ci-compose-head">
        <strong>
          <Mail aria-hidden="true" /> New email
        </strong>
        <button type="button" className="icon-button" onClick={onCancel} aria-label="Discard email" title="Discard">
          <X aria-hidden="true" />
        </button>
      </div>
      <div className="cw-email-head">
        <fieldset className="ci-to">
          <legend>
            <small>To</small>
          </legend>
          {clients.map((c) => (
            <label key={c.id}>
              <input
                type="checkbox"
                checked={to.includes(c.id)}
                onChange={(e) => setTo((prev) => (e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id)))}
                disabled={sending}
              />
              {c.name}
            </label>
          ))}
        </fieldset>
        <span>
          <small>From</small> {teamName}
        </span>
      </div>
      <label className="ci-subject">
        <small>Subject</small>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={MAX_SUBJECT_LENGTH}
          disabled={sending}
          placeholder="What it's about"
        />
      </label>
      <label className="cw-sr" htmlFor="ci-body">
        Your email
      </label>
      <DictationTextarea
        id="ci-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What do you need from your client? Ask for specific documents, or what they remember about something."
        maxLength={MAX_BODY_LENGTH}
        rows={7}
        disabled={sending}
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="cw-email-actions">
        <small className="muted">
          {to.length === 0 ? 'Choose at least one client.' : `One email at a time.${reviewLite ? '' : ' Your instructor reviews the reply first.'}`}
        </small>
        <button type="submit" className="ws-btn ws-btn-primary" disabled={sending || !to.length || !subject.trim() || !body.trim()}>
          <Send aria-hidden="true" />
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  )
}
