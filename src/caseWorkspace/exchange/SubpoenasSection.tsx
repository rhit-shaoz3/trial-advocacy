import { useState } from 'react'
import { BookOpen, ChevronRight, Clock, FileText, Lock, Megaphone, Plus, ScrollText, Send } from 'lucide-react'
import { DictationTextarea } from '../../components/Dictation'
import { shortDate } from '../../courses/caseLabels'
import type { StudentSubpoenas, TeamSubpoena } from '../../courses/types'
import { Meter, SubHead } from './RequestsSection'

const MAX_RECIPIENT = 200
const MAX_RECORDS = 4000

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

type View = { mode: 'hub' } | { mode: 'compose' } | { mode: 'read'; id: string }

/**
 * A team's subpoenas: what it has left, the ones it served and their answers,
 * and notice of the ones the other team served. Serving one names who it's
 * for and the records wanted; the instructor answers as the recipient.
 */
export function SubpoenasSection({
  part,
  open,
  opponentNumber,
  onServe,
  onOpenDocument,
  onTeach,
  initialSubpoenaId,
  now = new Date(),
}: {
  part: StudentSubpoenas
  /** Whether subpoenas are open yet (after the introduction phase). */
  open: boolean
  opponentNumber: number
  /** Leave out to make it read-only (a closed case). */
  onServe?(recipient: string, records: string): Promise<void>
  /** Opens a produced case file in the viewer. */
  onOpenDocument?(materialId: string): void
  onTeach(): void
  /** A subpoena to open on, as when a notice links to its answer. */
  initialSubpoenaId?: string
  now?: Date
}) {
  const [view, setView] = useState<View>(
    initialSubpoenaId && part.served.some((s) => s.id === initialSubpoenaId) ? { mode: 'read', id: initialSubpoenaId } : { mode: 'hub' },
  )
  const back = () => setView({ mode: 'hub' })

  if (view.mode === 'compose' && onServe) {
    return (
      <Compose
        part={part}
        onServe={async (recipient, records) => {
          await onServe(recipient, records)
          back()
        }}
        onBack={back}
        onTeach={onTeach}
      />
    )
  }
  const reading = view.mode === 'read' ? part.served.find((s) => s.id === view.id) : undefined
  if (reading) {
    return <ReadSubpoena subpoena={reading} onOpenDocument={onOpenDocument} onBack={back} onTeach={onTeach} now={now} />
  }

  const canServe = Boolean(onServe) && open && part.remaining > 0
  return (
    <div className="ex-stack">
      <section className="cw-card ex-section" aria-labelledby="ex-subpoenas-title">
        <header className="ex-section-head">
          <div>
            <span className="ws-eyebrow">Subpoenas · FRCP 45</span>
            <h2 id="ex-subpoenas-title">Subpoenas</h2>
            <p className="cw-section-sub">Order a person or organization to produce records your team doesn&rsquo;t have.</p>
          </div>
          <div className="ex-head-actions">
            <button type="button" className="ws-btn ws-btn-secondary" onClick={onTeach}>
              <BookOpen aria-hidden="true" />
              Teach me
            </button>
            {onServe && (
              <button
                type="button"
                className="ws-btn ws-btn-primary"
                disabled={!canServe}
                title={open && part.remaining === 0 ? `Your team has used all ${part.limit} subpoenas.` : undefined}
                onClick={() => setView({ mode: 'compose' })}
              >
                <Plus aria-hidden="true" />
                Serve a subpoena
              </button>
            )}
          </div>
        </header>
        {!open ? (
          <p className="ex-note">
            <Lock aria-hidden="true" />
            Subpoenas open in the information exchange phase.
          </p>
        ) : (
          <div className="ex-remaining">
            <p>
              You have{' '}
              <strong>
                {part.remaining}/{part.limit}
              </strong>{' '}
              {part.remaining === 1 ? 'subpoena' : 'subpoenas'} left
            </p>
            <Meter used={part.used} limit={part.limit} />
          </div>
        )}
      </section>

      {open && (
        <section className="cw-card ex-section" aria-labelledby="ex-subpoenas-served">
          <h3 id="ex-subpoenas-served" className="ex-subtitle">
            Served by your team
          </h3>
          {part.served.length === 0 ? (
            <p className="cw-empty">No subpoenas yet.</p>
          ) : (
            <ul className="ex-sets">
              {part.served.map((s) => (
                <li key={s.id}>
                  <button type="button" className="ex-set-row ex-set-link" onClick={() => setView({ mode: 'read', id: s.id })}>
                    <span className="ws-icon-tile ws-icon-tile-sm ws-tone-amber" aria-hidden="true">
                      <ScrollText />
                    </span>
                    <span className="cw-row-body">
                      <strong>To {s.recipient}</strong>
                      <small>
                        Served {shortDate(s.sentAt, now)}
                        {s.sentBy ? ` by ${s.sentBy}` : ''}
                      </small>
                    </span>
                    {s.respondedAt && !s.seen && <span className="cw-badge cw-badge-new">New</span>}
                    <StatusBadge subpoena={s} now={now} />
                    <ChevronRight className="cw-row-end" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {open && (
        <section className="cw-card ex-section" aria-labelledby="ex-subpoenas-notices">
          <h3 id="ex-subpoenas-notices" className="ex-subtitle">
            Notices from Team {opponentNumber}
          </h3>
          <p className="cw-section-sub">
            The other side has to tell you when it serves a subpoena. You see who and what, not what came back.
          </p>
          {part.notices.length === 0 ? (
            <p className="cw-empty">Team {opponentNumber} hasn&rsquo;t served any subpoenas.</p>
          ) : (
            <ul className="ex-sets">
              {part.notices.map((n) => (
                <li key={n.id} className="ex-set-row ex-notice">
                  <span className="ws-icon-tile ws-icon-tile-sm ws-tone-grey" aria-hidden="true">
                    <Megaphone />
                  </span>
                  <span className="cw-row-body">
                    <strong>To {n.recipient}</strong>
                    <small>
                      Served by Team {n.teamNumber} · {shortDate(n.sentAt, now)}
                    </small>
                    <span className="ex-notice-records">{n.records}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

function StatusBadge({ subpoena: s, now }: { subpoena: TeamSubpoena; now: Date }) {
  if (s.outcome === 'complied') return <span className="cw-badge cw-badge-done">Records produced</span>
  if (s.outcome === 'quashed') return <span className="cw-badge cw-badge-overdue">Quashed</span>
  if (new Date(s.dueAt) < now) return <span className="cw-badge cw-badge-overdue">Overdue</span>
  return <span className="cw-badge ex-badge-amber">Waiting · due {shortDate(s.dueAt, now)}</span>
}

/** Serving a subpoena: who it's for, and the records wanted. */
function Compose({
  part,
  onServe,
  onBack,
  onTeach,
}: {
  part: StudentSubpoenas
  onServe(recipient: string, records: string): Promise<void>
  onBack(): void
  onTeach(): void
}) {
  const [recipient, setRecipient] = useState('')
  const [records, setRecords] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function serve() {
    setBusy(true)
    setError(null)
    try {
      await onServe(recipient.trim(), records.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  return (
    <section className="cw-card ex-section" aria-label="New subpoena">
      <SubHead
        eyebrow="New subpoena · FRCP 45"
        title="Serve a subpoena"
        sub="Name the recipient and describe the records narrowly: what, about whom, and from which dates."
        onBack={onBack}
        onTeach={onTeach}
      />
      <div className="ex-tally">
        <p>
          <strong>
            {part.remaining - 1} of {part.limit} left after serving
          </strong>
        </p>
        <Meter used={Math.min(part.limit, part.used + 1)} limit={part.limit} />
      </div>
      <div className="ex-subpoena-form">
        <label className="ex-reason">
          To
          <input
            type="text"
            className="ex-text-input"
            value={recipient}
            maxLength={MAX_RECIPIENT}
            placeholder="Custodian of records, Mercy General Hospital"
            onChange={(e) => setRecipient(e.target.value)}
          />
        </label>
        <label className="ex-reason">
          Records to produce
          <DictationTextarea
            value={records}
            rows={5}
            maxLength={MAX_RECORDS}
            placeholder="All emergency room records for the plaintiff from June 10 to June 14, 2019, including intake notes and imaging reports."
            onChange={(e) => setRecords(e.target.value)}
          />
        </label>
      </div>
      <div className="ex-footer">
        <span className="cw-section-sub">
          <Clock aria-hidden="true" className="ex-inline" /> The recipient has {plural(part.days, 'day')} to answer. The other
          team gets notice.
        </span>
        <button type="button" className="ws-btn ws-btn-primary" onClick={serve} disabled={busy || !recipient.trim() || !records.trim()}>
          <Send aria-hidden="true" />
          {busy ? 'Serving…' : 'Serve subpoena'}
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

/** One subpoena the team served, with the answer once it's in. */
function ReadSubpoena({
  subpoena: s,
  onOpenDocument,
  onBack,
  onTeach,
  now,
}: {
  subpoena: TeamSubpoena
  onOpenDocument?(materialId: string): void
  onBack(): void
  onTeach(): void
  now: Date
}) {
  return (
    <section className="cw-card ex-section" aria-label={`Subpoena to ${s.recipient}`}>
      <SubHead
        eyebrow="Subpoena · FRCP 45"
        title={`Subpoena to ${s.recipient}`}
        sub={`Served ${shortDate(s.sentAt, now)}${s.sentBy ? ` by ${s.sentBy}` : ''} · ${
          s.respondedAt ? `answered ${shortDate(s.respondedAt, now)}` : `due ${shortDate(s.dueAt, now)}`
        }`}
        onBack={onBack}
        onTeach={onTeach}
        aside={<StatusBadge subpoena={s} now={now} />}
      />
      <div className="ex-answer ex-subpoena-block">
        <small>Records requested</small>
        {s.records}
      </div>
      {!s.respondedAt ? (
        <p className="cw-empty">Waiting for {s.recipient} to answer.</p>
      ) : (
        <>
          {s.response && (
            <div className={s.outcome === 'quashed' ? 'ex-answer ex-answer-objection ex-subpoena-block' : 'ex-answer ex-subpoena-block'}>
              <small>{s.outcome === 'quashed' ? 'Quashed' : `From ${s.recipient}`}</small>
              {s.response}
            </div>
          )}
          {s.documents.length > 0 && (
            <div className="ex-produced">
              <h3 className="ex-subtitle">Produced records</h3>
              <p className="cw-section-sub">These are in your team&rsquo;s Case file now.</p>
              <ul className="ex-sets">
                {s.documents.map((d) => (
                  <li key={d.materialId}>
                    {onOpenDocument ? (
                      <button type="button" className="ex-set-row ex-set-link" onClick={() => onOpenDocument(d.materialId)}>
                        <FileText aria-hidden="true" />
                        <span className="cw-row-body">
                          <strong>{d.title}</strong>
                        </span>
                        <ChevronRight className="cw-row-end" aria-hidden="true" />
                      </button>
                    ) : (
                      <span className="ex-set-row">
                        <FileText aria-hidden="true" />
                        <span className="cw-row-body">
                          <strong>{d.title}</strong>
                        </span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  )
}
