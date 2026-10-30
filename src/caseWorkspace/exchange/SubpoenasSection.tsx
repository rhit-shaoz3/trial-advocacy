import { useEffect, useState } from 'react'
import { BookOpen, ChevronRight, Clock, FileText, Lock, Megaphone, Plus, ScrollText, Send } from 'lucide-react'
import { DictationTextarea } from '../../components/Dictation'
import { SubpoenaForm } from '../../components/SubpoenaForm'
import { shortDate } from '../../courses/caseLabels'
import { SUBPOENA_TYPE_HINT, SUBPOENA_TYPE_LABEL } from '../../courses/subpoenaForm'
import type {
  CaseParties,
  CheckInput,
  DiscoveryCheck,
  DiscoveryDraft,
  Firm,
  KeyedCheck,
  Side,
  StudentSubpoenas,
  SubpoenaDraftContent,
  SubpoenaInput,
  SubpoenaType,
  TeamSubpoena,
} from '../../courses/types'
import { DEFAULT_AI_FEEDBACK } from '../../courses/types'
import { AiCheck } from './AiCheck'
import { DraftControls, DraftsList } from './Drafts'
import { useDraft, type DraftActions } from './useDraft'
import { Meter, SubHead } from './RequestsSection'
import { FlagButton } from '../flags'

const MAX_RECIPIENT = 200
const MAX_DESCRIPTION = 1000
const MAX_RECORDS = 4000
const MAX_JUSTIFICATION = 2000

/** What the Justification field asks. */
export const JUSTIFICATION_PROMPT =
  'Imagine the person/company you\u2019re requesting information from files a motion to quash or modify the subpoena. When the judge asks you to justify the validity, relevance, and proportionality of your request, what would you say?'

/** What the subpoena form needs besides the team's own fields. */
export interface SubpoenaFormContext {
  caseId: string
  parties: CaseParties
  side: Side
  firm: Firm
  /** The student, who signs as the team's attorney. */
  attorney: string | null
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

type View = { mode: 'hub' } | { mode: 'compose'; draft?: DiscoveryDraft } | { mode: 'read'; id: string }

/**
 * A team's subpoenas: what it has left, the ones it served and their answers,
 * and notice of the ones the other team served. Serving one names who it's
 * for and the records wanted; the instructor answers as the recipient.
 */
export function SubpoenasSection({
  part,
  form,
  open,
  opponentNumber,
  onServe,
  onCheck,
  onOpenDocument,
  onTeach,
  initialSubpoenaId,
  drafts,
  initialDraftId,
  onOpenDraft,
  now = new Date(),
}: {
  part: StudentSubpoenas
  form: SubpoenaFormContext
  /** Whether subpoenas are open yet (after the introduction phase). */
  open: boolean
  opponentNumber: number
  /** Leave out to make it read-only (a closed case). `draftId`: the draft it was written in. */
  onServe?(subpoena: SubpoenaInput, checkId?: string, draftId?: string): Promise<void>
  /** Has the AI check the draft before it's served; leave out to serve without one. */
  onCheck?(input: CheckInput): Promise<DiscoveryCheck>
  /** Opens a produced case file in the viewer. */
  onOpenDocument?(materialId: string): void
  onTeach(): void
  /** A subpoena to open on, as when a notice links to its answer. */
  initialSubpoenaId?: string
  /** Saves and deletes the team's drafts; leave out to not keep drafts. */
  drafts?: DraftActions
  /** A draft to open on, as after a refresh. */
  initialDraftId?: string
  /** Called with the open draft's id, and null on leaving it. */
  onOpenDraft?(draftId: string | null): void
  now?: Date
}) {
  const [view, setView] = useState<View>(() => {
    const draft = initialDraftId ? part.drafts.find((d) => d.id === initialDraftId) : undefined
    if (draft && onServe) return { mode: 'compose', draft }
    return initialSubpoenaId && part.served.some((s) => s.id === initialSubpoenaId) ? { mode: 'read', id: initialSubpoenaId } : { mode: 'hub' }
  })
  const back = () => setView({ mode: 'hub' })

  if (view.mode === 'compose' && onServe) {
    return (
      <Compose
        key={view.draft?.id ?? 'new'}
        part={part}
        form={form}
        draft={view.draft}
        actions={drafts}
        onOpenDraft={onOpenDraft}
        onServe={async (subpoena, checkId, draftId) => {
          await onServe(subpoena, checkId, draftId)
          back()
        }}
        onCheck={part.aiFeedback?.enabled === false ? undefined : onCheck}
        onBack={back}
        onTeach={onTeach}
      />
    )
  }
  const reading = view.mode === 'read' ? part.served.find((s) => s.id === view.id) : undefined
  if (reading) {
    return <ReadSubpoena subpoena={reading} form={form} onOpenDocument={onOpenDocument} onBack={back} onTeach={onTeach} now={now} />
  }

  const canServe = Boolean(onServe) && open && part.remaining > 0
  return (
    <div className="ex-stack">
      <section className="cw-card ex-section" aria-labelledby="ex-subpoenas-title">
        <header className="ex-section-head">
          <div>
            <span className="ws-eyebrow">Subpoenas · FRCP 45</span>
            <h2 id="ex-subpoenas-title">Subpoenas</h2>
            <p className="cw-section-sub">
              Order a person or organization to produce what your team doesn&rsquo;t have:{' '}
              {part.types.map((t) => SUBPOENA_TYPE_LABEL[t].toLowerCase()).join(', ')}.
            </p>
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

      {open && onServe && drafts && (
        <DraftsList drafts={part.drafts} onOpen={(draft) => setView({ mode: 'compose', draft })} onDelete={drafts.remove} now={now} />
      )}

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
                        {SUBPOENA_TYPE_LABEL[s.requestType]} · Served {shortDate(s.sentAt, now)}
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
                      {SUBPOENA_TYPE_LABEL[n.requestType]} · Served by Team {n.teamNumber} · {shortDate(n.sentAt, now)}
                    </small>
                    <span className="ex-notice-records">{n.records}</span>
                  </span>
                  {n.seen === false && <span className="cw-badge cw-badge-new">New</span>}
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
  if (s.outcome === 'responded') return <span className="cw-badge cw-badge-done">Response received</span>
  if (s.outcome === 'denied') return <span className="cw-badge cw-badge-overdue">Denied</span>
  if (new Date(s.dueAt) < now) return <span className="cw-badge cw-badge-overdue">Overdue</span>
  return <span className="cw-badge ex-badge-amber">Awaiting response · due {shortDate(s.dueAt, now)}</span>
}

/**
 * Serving a subpoena: who it's for and who they are, what kind of request (only
 * the kinds the case allows; fixed when there's one), and what it wants, shown
 * as it fills in on the federal form.
 */
function Compose({
  part,
  form,
  draft,
  actions,
  onOpenDraft,
  onServe,
  onCheck,
  onBack,
  onTeach,
}: {
  part: StudentSubpoenas
  form: SubpoenaFormContext
  /** The draft to carry on with. */
  draft?: DiscoveryDraft
  actions?: DraftActions
  onOpenDraft?(draftId: string | null): void
  onServe(subpoena: SubpoenaInput, checkId?: string, draftId?: string): Promise<void>
  onCheck?(input: CheckInput): Promise<DiscoveryCheck>
  onBack(): void
  onTeach(): void
}) {
  const saved = draft?.content as SubpoenaDraftContent | undefined
  const [recipient, setRecipient] = useState(saved?.recipient ?? '')
  const [recipientDescription, setRecipientDescription] = useState(saved?.recipientDescription ?? '')
  const [requestType, setRequestType] = useState<SubpoenaType | ''>(() => {
    if (saved?.requestType && part.types.includes(saved.requestType)) return saved.requestType
    return part.types.length === 1 ? part.types[0] : ''
  })
  const [records, setRecords] = useState(saved?.records ?? '')
  const [justification, setJustification] = useState(saved?.justification ?? '')
  const [lastCheck, setLastCheck] = useState<KeyedCheck | null>(draft?.lastCheck ?? null)
  const ready = Boolean(recipient.trim() && records.trim() && requestType && justification.trim())
  const content: SubpoenaDraftContent = { recipient, recipientDescription, requestType, records, justification }
  const empty = ![recipient, recipientDescription, records, justification].some((t) => t.trim())
  const autosave = useDraft({ kind: 'subpoena', initial: draft, content, check: lastCheck, empty, actions })
  // The open draft goes in the address, so a refresh comes back to it.
  useEffect(() => {
    if (!autosave.draftId) return
    onOpenDraft?.(autosave.draftId)
    return () => onOpenDraft?.(null)
  }, [autosave.draftId, onOpenDraft])
  // The date it would be due if served now, for the form.
  const [dueIfServedNow] = useState(() => new Date(Date.now() + part.days * 86_400_000).toISOString())
  const subpoena = (): SubpoenaInput => ({
    recipient: recipient.trim(),
    recipientDescription: recipientDescription.trim(),
    requestType: requestType as SubpoenaType,
    records: records.trim(),
    justification: justification.trim(),
  })

  return (
    <section className="cw-card ex-section" aria-label="New subpoena">
      <SubHead
        eyebrow="New subpoena · FRCP 45"
        title="Serve a subpoena"
        sub="Name the recipient and ask narrowly: what, about whom, and from which dates."
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
      <div className="ex-subpoena-compose">
        <div className="ex-subpoena-form">
          <label className="ex-reason">
            To
            <input
              type="text"
              className="ex-text-input"
              value={recipient}
              maxLength={MAX_RECIPIENT}
              placeholder="Custodian of records, and the person, company, or office that has them"
              onChange={(e) => setRecipient(e.target.value)}
            />
          </label>
          <label className="ex-reason">
            Who they are
            <input
              type="text"
              className="ex-text-input"
              value={recipientDescription}
              maxLength={MAX_DESCRIPTION}
              placeholder="Who they are, and how they’re connected to the case"
              onChange={(e) => setRecipientDescription(e.target.value)}
            />
          </label>
          {part.types.length === 1 ? (
            <div className="ex-reason">
              Type of request
              <p className="ex-fixed-type">
                <strong>{SUBPOENA_TYPE_LABEL[part.types[0]]}</strong>
                <small>{SUBPOENA_TYPE_HINT[part.types[0]]}</small>
              </p>
            </div>
          ) : (
            <label className="ex-reason">
              Type of request
              <select
                className="ex-text-input"
                value={requestType}
                onChange={(e) => setRequestType(e.target.value as SubpoenaType | '')}
              >
                <option value="">Choose one…</option>
                {part.types.map((t) => (
                  <option key={t} value={t}>
                    {SUBPOENA_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
              {requestType && <small className="ex-type-hint">{SUBPOENA_TYPE_HINT[requestType]}</small>}
            </label>
          )}
          <label className="ex-reason">
            {requestType === 'inspection' ? 'What to inspect' : 'What you want'}
            <DictationTextarea
              value={records}
              rows={6}
              maxLength={MAX_RECORDS}
              placeholder={
                requestType === 'inspection'
                  ? 'The place or thing to inspect, and what you\u2019ll do there: measure, photograph, test.'
                  : '1. The records you want: what, about whom, and from which dates.'
              }
              onChange={(e) => setRecords(e.target.value)}
            />
          </label>
          <label className="ex-reason">
            Justification
            <span className="ex-justification-hint">{JUSTIFICATION_PROMPT}</span>
            <DictationTextarea
              value={justification}
              rows={5}
              maxLength={MAX_JUSTIFICATION}
              onChange={(e) => setJustification(e.target.value)}
            />
          </label>
        </div>
        <div className="ex-subpoena-preview">
          <h3 className="ex-subtitle">Your subpoena</h3>
          <SubpoenaForm
            {...form}
            recipient={recipient}
            requestType={requestType || null}
            records={records}
            servedAt={null}
            dueAt={dueIfServedNow}
          />
        </div>
      </div>
      <AiCheck
        info={
          <>
            <Clock aria-hidden="true" className="ex-inline" /> The recipient has {plural(part.days, 'day')} to respond. The
            other team gets notice.
          </>
        }
        ready={ready}
        draftKey={JSON.stringify([recipient, recipientDescription, requestType, records, justification].map((t) => t.trim()))}
        onCheck={onCheck && ((previousCheckId) => onCheck({ kind: 'subpoena', mode: 'draft', draft: subpoena(), previousCheckId }))}
        rounds={(part.aiFeedback ?? DEFAULT_AI_FEEDBACK).rounds}
        initialCheck={draft?.lastCheck}
        onCheckChange={setLastCheck}
        onSubmit={(checkId) => autosave.submit((draftId) => onServe(subpoena(), checkId, draftId))}
        extra={
          actions && (
            <DraftControls
              status={autosave.status}
              empty={empty}
              onSave={async () => {
                await autosave.flush()
                onBack()
              }}
              onCancel={async () => {
                await autosave.discard()
                onBack()
              }}
            />
          )
        }
        submitIcon={<Send aria-hidden="true" />}
        submitLabel="Serve subpoena"
        busyLabel="Serving…"
        anywayLabel="Serve anyway"
      />
    </section>
  )
}

/** One subpoena the team served, with the answer once it's in. */
function ReadSubpoena({
  subpoena: s,
  form,
  onOpenDocument,
  onBack,
  onTeach,
  now,
}: {
  subpoena: TeamSubpoena
  form: SubpoenaFormContext
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
      <details className="ex-subpoena-served" open={!s.respondedAt}>
        <summary>The subpoena you served</summary>
        <SubpoenaForm
          {...form}
          attorney={s.sentBy}
          recipient={s.recipient}
          requestType={s.requestType}
          records={s.records}
          servedAt={s.sentAt}
          dueAt={s.dueAt}
        />
        {s.justification && (
          <p className="ex-justification">
            <strong>Your justification:</strong> {s.justification}
          </p>
        )}
      </details>
      {!s.respondedAt ? (
        <p className="cw-empty">Waiting for {s.recipient} to respond.</p>
      ) : s.outcome === 'denied' ? (
        <>
          <div className="ex-answer ex-answer-objection ex-subpoena-block">
            <small>Your subpoena was denied</small>
            {s.response || 'The court won\u2019t enforce this subpoena, so nothing was produced.'}
          </div>
          {s.auto && (
            <FlagButton kind="subpoena" targetId={s.id} label="Appeal the denial" what={`subpoena to ${s.recipient}`} />
          )}
        </>
      ) : (
        <>
          {s.response && (
            <div className="ex-answer ex-subpoena-block ex-subpoena-response">
              <small>Response from {s.recipient}</small>
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
          {s.auto && (
            <FlagButton kind="subpoena" targetId={s.id} label="Flag this response" what={`response of ${s.recipient}`} />
          )}
        </>
      )}
    </section>
  )
}
