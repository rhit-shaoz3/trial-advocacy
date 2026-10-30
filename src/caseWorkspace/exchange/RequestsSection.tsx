import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  CornerDownLeft,
  Inbox,
  Lock,
  Minus,
  Plus,
  Send,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { dueLabel, shortDate } from '../../courses/caseLabels'
import {
  DEFAULT_AI_FEEDBACK,
  questionWeight,
  type CheckInput,
  type DiscoveryCheck,
  type DiscoveryDraft,
  type ExchangeKind,
  type ExchangeRequest,
  type ItemResponse,
  type KeyedCheck,
  type StudentPart,
} from '../../courses/types'
import { DictationTextarea } from '../../components/Dictation'
import { AiCheck } from './AiCheck'
import { DraftControls, DraftsList } from './Drafts'
import { useDraft, type DraftActions } from './useDraft'

type TeamRequest = StudentPart['requests'][number]

const COPY: Record<
  ExchangeKind,
  { title: string; rule: string; about: string; one: string; many: string; write: string; placeholder: string; sideLabel: string }
> = {
  interrogatories: {
    title: 'Interrogatories',
    rule: 'FRCP 33',
    about: 'Written questions to the other team, answered in writing and under oath.',
    one: 'interrogatory',
    many: 'interrogatories',
    write: 'Write interrogatories',
    placeholder: 'Type a question…',
    sideLabel: 'question',
  },
  rfas: {
    title: 'Requests for admission',
    rule: 'FRCP 36',
    about: 'Statements you ask the other team to agree or disagree with.',
    one: 'request for admission',
    many: 'requests for admission',
    write: 'Write requests',
    placeholder: 'Type a statement for them to admit…',
    sideLabel: 'request',
  },
}

const ADMISSION_LABEL = { agree: 'Agreed', disagree: 'Disagreed', partial: 'Partly agreed' } as const

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "27 days left", "Due today", or "3 days late". */
function timeLeft(iso: string, now: Date) {
  // Rounded, so a clock change (an hour either way) doesn't add or lose a day.
  const days = Math.round((new Date(iso).getTime() - now.getTime()) / 86_400_000)
  if (days === 0) return 'Due today'
  return days > 0 ? `${plural(days, 'day')} left` : `${plural(-days, 'day')} late`
}

type View = { mode: 'hub' } | { mode: 'compose'; draft?: DiscoveryDraft } | { mode: 'respond'; id: string } | { mode: 'read'; id: string }

/**
 * One kind of request (interrogatories, or requests for admission) as a team
 * sees it: what it has left, sets to respond to, and sets sent and answered;
 * writing a set (one per line), responding to one, and reading one.
 */
export function RequestsSection({
  kind,
  part,
  open,
  opponentNumber,
  opponentSide,
  onSend,
  onRespond,
  onCheck,
  onTeach,
  initialRequestId,
  drafts,
  initialDraftId,
  onOpenDraft,
  now = new Date(),
}: {
  kind: ExchangeKind
  part: StudentPart
  /** Whether requests are open yet (after the introduction phase). */
  open: boolean
  opponentNumber: number
  opponentSide: string
  /** Leave out to make it read-only (a closed case). */
  /** `draftId`: the draft it was written in. */
  onSend?(items: string[], checkId?: string, draftId?: string): Promise<void>
  onRespond?(requestId: string, responses: ItemResponse[], checkId?: string): Promise<void>
  /** Has the AI check a draft (a set, or answers) before it's sent; leave out to send without one. */
  onCheck?(input: CheckInput): Promise<DiscoveryCheck>
  onTeach(): void
  /** A request to open on (read), as when a notice links to its response. */
  initialRequestId?: string
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
    if (draft && onSend) return { mode: 'compose', draft }
    return initialRequestId && part.requests.some((r) => r.id === initialRequestId) ? { mode: 'read', id: initialRequestId } : { mode: 'hub' }
  })
  const request = view.mode === 'respond' || view.mode === 'read' ? part.requests.find((r) => r.id === view.id) : undefined
  const copy = COPY[kind]
  const back = () => setView({ mode: 'hub' })
  // The instructor can turn AI feedback off for this part, or limit its rounds.
  const ai = part.aiFeedback ?? DEFAULT_AI_FEEDBACK
  const check = ai.enabled ? onCheck : undefined

  if (view.mode === 'compose' && onSend) {
    return (
      <Compose
        key={view.draft?.id ?? 'new'}
        kind={kind}
        part={part}
        to={`Team ${opponentNumber} (${opponentSide})`}
        draft={view.draft}
        actions={drafts}
        onOpenDraft={onOpenDraft}
        onSend={async (items, checkId, draftId) => {
          await onSend(items, checkId, draftId)
          back()
        }}
        onCheck={check && ((items, previousCheckId) => check({ kind, mode: 'draft', draft: { items }, previousCheckId }))}
        rounds={ai.rounds}
        onBack={back}
        onTeach={onTeach}
      />
    )
  }
  if (view.mode === 'respond' && request && onRespond) {
    return (
      <Respond
        kind={kind}
        request={request}
        onRespond={async (responses, checkId) => {
          await onRespond(request.id, responses, checkId)
          setView({ mode: 'read', id: request.id })
        }}
        onCheck={check && ((responses) => check({ kind, mode: 'answer', requestId: request.id, draft: { responses } }))}
        rounds={ai.rounds}
        onBack={back}
        onTeach={onTeach}
        now={now}
      />
    )
  }
  if (view.mode === 'read' && request) {
    return <ReadSet kind={kind} request={request} onBack={back} onTeach={onTeach} now={now} />
  }

  const toRespond = part.requests.filter((r) => r.direction === 'received' && !r.respondedAt)
  const history = part.requests.filter((r) => r.direction === 'sent' || r.respondedAt)
  const canWrite = Boolean(onSend) && open && part.remaining > 0
  return (
    <div className="ex-stack">
      <section className="cw-card ex-section" aria-labelledby={`ex-${kind}-title`}>
        <header className="ex-section-head">
          <div>
            <span className="ws-eyebrow">
              {copy.title} · {copy.rule}
            </span>
            <h2 id={`ex-${kind}-title`}>{copy.title}</h2>
            <p className="cw-section-sub">{copy.about}</p>
          </div>
          <div className="ex-head-actions">
            <button type="button" className="ws-btn ws-btn-secondary" onClick={onTeach}>
              <BookOpen aria-hidden="true" />
              Teach me
            </button>
            {onSend && (
              <button
                type="button"
                className="ws-btn ws-btn-primary"
                disabled={!canWrite}
                title={!open ? undefined : part.remaining === 0 ? `Your team has used all ${part.limit} ${copy.many}.` : undefined}
                onClick={() => setView({ mode: 'compose' })}
              >
                <Plus aria-hidden="true" />
                {copy.write}
              </button>
            )}
          </div>
        </header>
        {!open ? (
          <p className="ex-note">
            <Lock aria-hidden="true" />
            {copy.title} open in the information exchange phase.
          </p>
        ) : (
          <div className="ex-remaining">
            <p>
              You have{' '}
              <strong>
                {part.remaining}/{part.limit}
              </strong>{' '}
              {part.remaining === 1 ? copy.one : copy.many} left
            </p>
            <Meter used={part.used} limit={part.limit} />
          </div>
        )}
      </section>

      {open && onSend && drafts && (
        <DraftsList
          drafts={part.drafts}
          unit={[copy.sideLabel, `${copy.sideLabel}s`]}
          onOpen={(draft) => setView({ mode: 'compose', draft })}
          onDelete={drafts.remove}
          now={now}
        />
      )}

      {open && (
        <section className="cw-card ex-section ex-to-respond" aria-labelledby={`ex-${kind}-respond`}>
          <h3 id={`ex-${kind}-respond`} className="ex-subtitle">
            To respond to {toRespond.length > 0 && <span className="cw-badge cw-badge-overdue">{toRespond.length}</span>}
          </h3>
          {toRespond.length === 0 ? (
            <p className="cw-empty">Nothing to respond to.</p>
          ) : (
            <ul className="ex-sets">
              {toRespond.map((r) => (
                <li key={r.id} className="ex-set-row">
                  <span className="ws-icon-tile ws-icon-tile-sm ws-tone-rose" aria-hidden="true">
                    <Inbox />
                  </span>
                  <span className="cw-row-body">
                    <strong>From Team {r.fromTeam.number}</strong>
                    <small>
                      {plural(r.items.length, copy.sideLabel)} · received {shortDate(r.sentAt, now)}
                    </small>
                  </span>
                  <span className={new Date(r.dueAt) < now ? 'ex-due cw-overdue' : 'ex-due'}>
                    <Clock aria-hidden="true" />
                    Due {dueLabel(r.dueAt, now)}
                  </span>
                  {onRespond ? (
                    <button type="button" className="ws-btn ws-btn-primary" onClick={() => setView({ mode: 'respond', id: r.id })}>
                      Respond
                    </button>
                  ) : (
                    <button type="button" className="ws-btn ws-btn-secondary" onClick={() => setView({ mode: 'read', id: r.id })}>
                      View
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {open && (
        <section className="cw-card ex-section" aria-labelledby={`ex-${kind}-history`}>
          <h3 id={`ex-${kind}-history`} className="ex-subtitle">
            Sent and answered
          </h3>
          {history.length === 0 ? (
            <p className="cw-empty">No sets yet.</p>
          ) : (
            <ul className="ex-sets">
              {history.map((r) => {
                const sent = r.direction === 'sent'
                const unseen = sent && r.respondedAt && !r.seen
                return (
                  <li key={r.id}>
                    <button type="button" className="ex-set-row ex-set-link" onClick={() => setView({ mode: 'read', id: r.id })}>
                      <span className={`ws-icon-tile ws-icon-tile-sm ${sent ? 'ws-tone-blue' : 'ws-tone-grey'}`} aria-hidden="true">
                        {sent ? <Send /> : <Inbox />}
                      </span>
                      <span className="cw-row-body">
                        <strong>{sent ? `To Team ${r.toTeam.number}` : `From Team ${r.fromTeam.number}`}</strong>
                        <small>
                          {plural(r.items.length, copy.sideLabel)} · {sent ? 'sent' : 'received'} {shortDate(r.sentAt, now)}
                        </small>
                      </span>
                      {unseen && <span className="cw-badge cw-badge-new">New</span>}
                      <StatusBadge request={r} now={now} />
                      <ChevronRight className="cw-row-end" aria-hidden="true" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

function StatusBadge({ request: r, now }: { request: ExchangeRequest; now: Date }) {
  if (r.respondedAt) return <span className="cw-badge cw-badge-done">Answered {shortDate(r.respondedAt, now)}</span>
  if (new Date(r.dueAt) < now) return <span className="cw-badge cw-badge-overdue">Overdue</span>
  return <span className="cw-badge ex-badge-amber">Waiting · due {shortDate(r.dueAt, now)}</span>
}

/** One block per question the team can still ask (a bar when there are many). */
export function Meter({ used, limit }: { used: number; limit: number }) {
  if (limit > 30) {
    return (
      <div className="ex-meter-bar" role="progressbar" aria-label="Used" aria-valuenow={used} aria-valuemin={0} aria-valuemax={limit}>
        <span style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} />
      </div>
    )
  }
  return (
    <div className="ex-meter" role="progressbar" aria-label="Used" aria-valuenow={used} aria-valuemin={0} aria-valuemax={limit}>
      {Array.from({ length: limit }, (_, i) => (
        <span key={i} className={i < used ? 'ex-meter-used' : undefined} />
      ))}
    </div>
  )
}

export function SubHead({
  eyebrow,
  title,
  sub,
  onBack,
  onTeach,
  aside,
}: {
  eyebrow: string
  title: string
  sub: string
  onBack(): void
  onTeach(): void
  aside?: ReactNode
}) {
  return (
    <>
      <button type="button" className="ex-back" onClick={onBack}>
        <ChevronLeft aria-hidden="true" />
        Back
      </button>
      <header className="ex-section-head">
        <div>
          <span className="ws-eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
          <p className="cw-section-sub">{sub}</p>
        </div>
        <div className="ex-head-actions">
          {aside}
          <button type="button" className="ws-btn ws-btn-secondary" onClick={onTeach}>
            <BookOpen aria-hidden="true" />
            Teach me
          </button>
        </div>
      </header>
    </>
  )
}

/** Writing a set: one per line. Return starts a new line, until the team's limit. */
function Compose({
  kind,
  part,
  to,
  draft,
  actions,
  onOpenDraft,
  onSend,
  onCheck,
  rounds,
  onBack,
  onTeach,
}: {
  kind: ExchangeKind
  part: StudentPart
  to: string
  /** The draft to carry on with. */
  draft?: DiscoveryDraft
  actions?: DraftActions
  onOpenDraft?(draftId: string | null): void
  onSend(items: string[], checkId?: string, draftId?: string): Promise<void>
  onCheck?(items: string[], previousCheckId?: string): Promise<DiscoveryCheck>
  /** How many checks one draft gets; null for unlimited. */
  rounds: number | null
  onBack(): void
  onTeach(): void
}) {
  const copy = COPY[kind]
  const [lines, setLines] = useState<string[]>(() => {
    const saved = draft && 'items' in draft.content ? draft.content.items : []
    return saved.length > 0 ? saved : ['']
  })
  const [lastCheck, setLastCheck] = useState<KeyedCheck | null>(draft?.lastCheck ?? null)
  const empty = !lines.some((l) => l.trim())
  const autosave = useDraft({ kind, initial: draft, content: { items: lines }, check: lastCheck, empty, actions })
  // The open draft goes in the address, so a refresh comes back to it.
  useEffect(() => {
    if (!autosave.draftId) return
    onOpenDraft?.(autosave.draftId)
    return () => onOpenDraft?.(null)
  }, [autosave.draftId, onOpenDraft])
  const [focus, setFocus] = useState(0)
  const refs = useRef<(HTMLTextAreaElement | null)[]>([])
  const weightOf = (t: string) => (kind === 'interrogatories' ? questionWeight(t) : 1)
  const filled = lines.filter((l) => l.trim())
  const thisSet = filled.reduce((n, l) => n + weightOf(l), 0)
  const left = part.remaining - thisSet
  // A new line needs room for at least one more.
  const canAdd = left >= 1 && lines.at(-1)!.trim() !== ''

  useEffect(() => {
    refs.current[focus]?.focus()
  }, [focus, lines.length])

  function add(after = lines.length - 1) {
    if (!canAdd && after === lines.length - 1) return
    if (left < 1) return
    setLines((l) => [...l.slice(0, after + 1), '', ...l.slice(after + 1)])
    setFocus(after + 1)
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>, i: number) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (lines[i].trim()) add(i)
    }
  }

  const items = () => filled.map((l) => l.trim())
  const over = left < 0
  return (
    <section className="cw-card ex-section" aria-label={`New ${copy.many}`}>
      <SubHead
        eyebrow={`New set · ${copy.title}`}
        title={`${copy.title} to ${to}`}
        sub={
          kind === 'interrogatories'
            ? 'One question per line. Each subpart, like (a) and (b), and each separate question mark counts as its own question.'
            : 'One statement per line, written so the other side can agree or disagree with it.'
        }
        onBack={onBack}
        onTeach={onTeach}
      />
      <div className={over || left === 0 ? 'ex-tally ex-tally-full' : 'ex-tally'}>
        <p>
          <strong>This set: {plural(thisSet, kind === 'interrogatories' ? 'question' : 'request')}</strong> ·{' '}
          <strong>
            {Math.max(0, left)} of {part.limit} left after sending
          </strong>
        </p>
        <Meter used={Math.min(part.limit, part.used + thisSet)} limit={part.limit} />
      </div>
      <ol className="ex-lines">
        {lines.map((line, i) => {
          const weight = weightOf(line)
          return (
            <li key={i} className={focus === i ? 'ex-line ex-line-focus' : 'ex-line'}>
              <span className="ex-line-number">{i + 1}.</span>
              <div>
                <DictationTextarea
                  ref={(el) => {
                    refs.current[i] = el
                  }}
                  aria-label={`${copy.title === 'Interrogatories' ? 'Question' : 'Request'} ${i + 1}`}
                  value={line}
                  rows={1}
                  maxLength={1000}
                  placeholder={copy.placeholder}
                  onFocus={() => setFocus(i)}
                  onKeyDown={(e) => onKey(e, i)}
                  onChange={(e) => setLines((l) => l.map((x, j) => (j === i ? e.target.value : x)))}
                />
                {weight > 1 && (
                  <p className="ex-warn">
                    <TriangleAlert aria-hidden="true" />
                    Has {weight} subparts or questions, so it counts as {weight} questions.
                  </p>
                )}
                {focus === i && (
                  <p className="ex-keys">
                    <CornerDownLeft aria-hidden="true" />
                    Return for a new line · Shift + Return for a line break
                  </p>
                )}
              </div>
              {lines.length > 1 && (
                <button
                  type="button"
                  className="ex-icon-button"
                  aria-label={`Remove line ${i + 1}`}
                  onClick={() => {
                    setLines((l) => l.filter((_, j) => j !== i))
                    setFocus(Math.max(0, i - 1))
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              )}
            </li>
          )
        })}
      </ol>
      <div className="ex-add">
        <button type="button" className="ws-btn ws-btn-secondary" onClick={() => add()} disabled={!canAdd}>
          <Plus aria-hidden="true" />
          Add another
        </button>
        {left < 1 ? (
          <span className="ex-out" role="status">
            <TriangleAlert aria-hidden="true" />
            {over
              ? `That's ${-left} more than your team has left. Shorten the set to send it.`
              : `You're out of ${copy.many}. Your team has used all ${part.limit}.`}
          </span>
        ) : (
          <span className="cw-section-sub">or press Return</span>
        )}
      </div>
      <AiCheck
        info={
          <>
            <Clock aria-hidden="true" className="ex-inline" /> {to.split(' (')[0]} has {plural(part.days, 'day')} to respond
            once they receive it.
          </>
        }
        ready={filled.length > 0}
        blocked={over}
        draftKey={JSON.stringify(items())}
        onCheck={onCheck && ((previousCheckId) => onCheck(items(), previousCheckId))}
        rounds={rounds}
        initialCheck={draft?.lastCheck}
        onCheckChange={setLastCheck}
        onSubmit={(checkId) => autosave.submit((draftId) => onSend(items(), checkId, draftId))}
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
        submitLabel={`Send to ${to.split(' (')[0]}`}
        busyLabel="Sending…"
        anywayLabel="Send anyway"
      />
    </section>
  )
}

type Draft = Omit<ItemResponse, 'position'>
const EMPTY: Draft = { answer: '', objection: false, admission: null, agreePart: '', disagreePart: '' }

/** Responding to a set the other team sent: an answer (or objection) each, or agree / disagree / partial. */
function Respond({
  kind,
  request,
  onRespond,
  onCheck,
  rounds,
  onBack,
  onTeach,
  now,
}: {
  kind: ExchangeKind
  request: TeamRequest
  onRespond(responses: ItemResponse[], checkId?: string): Promise<void>
  /** Answers' checks are counted by the set, so there's no earlier check to name. */
  onCheck?(responses: ItemResponse[]): Promise<DiscoveryCheck>
  rounds: number | null
  onBack(): void
  onTeach(): void
  now: Date
}) {
  const copy = COPY[kind]
  const [drafts, setDrafts] = useState<Draft[]>(() => request.items.map(() => ({ ...EMPTY })))
  const set = (i: number, patch: Partial<Draft>) => setDrafts((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const done = (d: Draft) =>
    kind === 'interrogatories'
      ? d.answer.trim() !== ''
      : d.admission !== null && (d.admission !== 'partial' || (d.agreePart.trim() !== '' && d.disagreePart.trim() !== ''))
  const answered = drafts.filter(done).length

  const responses = () => request.items.map((item, i) => ({ position: item.position, ...drafts[i] }))

  return (
    <section className="cw-card ex-section" aria-label={`Respond to ${copy.many}`}>
      <SubHead
        eyebrow={`From Team ${request.fromTeam.number} · ${copy.rule}`}
        title={`Respond to Team ${request.fromTeam.number}’s ${copy.many}`}
        sub={
          kind === 'interrogatories'
            ? 'Answer each question fully and in writing, based on what your side knows.'
            : 'For each statement, agree, disagree, or agree in part. Anything you agree with is treated as settled.'
        }
        onBack={onBack}
        onTeach={onTeach}
        aside={
          <span className={new Date(request.dueAt) < now ? 'ex-due-chip ex-due-late' : 'ex-due-chip'}>
            <strong>Due {shortDate(request.dueAt, now)}</strong>
            <small>{timeLeft(request.dueAt, now)}</small>
          </span>
        }
      />
      <ol className="ex-respond">
        {request.items.map((item, i) => {
          const d = drafts[i]
          return (
            <li key={item.position} className={done(d) ? 'ex-respond-item' : 'ex-respond-item ex-respond-open'}>
              <p className="ex-question">
                <span>{item.position}.</span> {item.text}
              </p>
              {kind === 'interrogatories' ? (
                <>
                  <label className="ex-reason">
                    {d.objection ? 'Your objection' : 'Your answer'}
                    <DictationTextarea
                      value={d.answer}
                      rows={2}
                      maxLength={4000}
                      placeholder={d.objection ? 'Why the question is improper…' : 'Write your answer…'}
                      onChange={(e) => set(i, { answer: e.target.value })}
                    />
                  </label>
                  <label className="ex-check">
                    <input type="checkbox" checked={d.objection} onChange={(e) => set(i, { objection: e.target.checked })} />
                    Object to this question instead <small>FRCP 33(b)(4)</small>
                  </label>
                </>
              ) : (
                <>
                  <div className="ex-segments" role="radiogroup" aria-label={`Response to request ${item.position}`}>
                    {(
                      [
                        ['agree', 'Agree', Check],
                        ['disagree', 'Disagree', X],
                        ['partial', 'Partial', Minus],
                      ] as const
                    ).map(([value, label, Icon]) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={d.admission === value}
                        onClick={() => set(i, { admission: value })}
                      >
                        <Icon aria-hidden="true" />
                        {label}
                      </button>
                    ))}
                  </div>
                  {d.admission === 'partial' && (
                    <div className="ex-partial">
                      <label className="ex-reason ex-reason-agree">
                        What you agree with
                        <DictationTextarea value={d.agreePart} rows={2} maxLength={4000} onChange={(e) => set(i, { agreePart: e.target.value })} />
                      </label>
                      <label className="ex-reason ex-reason-disagree">
                        What you disagree with
                        <DictationTextarea
                          value={d.disagreePart}
                          rows={2}
                          maxLength={4000}
                          onChange={(e) => set(i, { disagreePart: e.target.value })}
                        />
                      </label>
                    </div>
                  )}
                  {d.admission === 'disagree' && (
                    <label className="ex-reason">
                      Explain (optional)
                      <DictationTextarea value={d.answer} rows={2} maxLength={4000} onChange={(e) => set(i, { answer: e.target.value })} />
                    </label>
                  )}
                </>
              )}
            </li>
          )
        })}
      </ol>
      <AiCheck
        info={`${answered} of ${request.items.length} answered`}
        ready={answered === request.items.length}
        draftKey={JSON.stringify(drafts)}
        onCheck={onCheck && (() => onCheck(responses()))}
        rounds={rounds}
        roundsUsed={request.checkRounds ?? 0}
        onSubmit={(checkId) => onRespond(responses(), checkId)}
        submitIcon={<Send aria-hidden="true" />}
        submitLabel="Send responses"
        busyLabel="Sending…"
        anywayLabel="Send responses anyway"
      />
    </section>
  )
}

/** A set, sent or received, with its responses once they're in. */
function ReadSet({
  kind,
  request: r,
  onBack,
  onTeach,
  now,
}: {
  kind: ExchangeKind
  request: TeamRequest
  onBack(): void
  onTeach(): void
  now: Date
}) {
  const copy = COPY[kind]
  const sent = r.direction === 'sent'
  const count = (a: 'agree' | 'disagree' | 'partial') => r.items.filter((i) => i.admission === a).length
  const objections = r.items.filter((i) => i.objection).length
  return (
    <section className="cw-card ex-section" aria-label={`${copy.title} set`}>
      <SubHead
        eyebrow={sent ? `Sent to Team ${r.toTeam.number}` : `From Team ${r.fromTeam.number}`}
        title={
          sent
            ? r.respondedAt
              ? `Team ${r.toTeam.number}’s responses`
              : `Your ${copy.many} to Team ${r.toTeam.number}`
            : `Team ${r.fromTeam.number}’s ${copy.many}`
        }
        sub={`${plural(r.items.length, copy.sideLabel)} · sent ${shortDate(r.sentAt, now)}${
          r.respondedAt ? ` · responded ${shortDate(r.respondedAt, now)}` : ` · due ${shortDate(r.dueAt, now)}`
        }`}
        onBack={onBack}
        onTeach={onTeach}
      />
      {r.respondedAt && (
        <p className="ex-summary">
          {kind === 'rfas' ? (
            <>
              <span className="cw-badge cw-badge-done">{count('agree')} agreed</span>
              <span className="cw-badge ex-badge-amber">{count('partial')} partly agreed</span>
              <span className="cw-badge cw-badge-overdue">{count('disagree')} disagreed</span>
            </>
          ) : (
            <>
              <span className="cw-badge cw-badge-done">{r.items.length - objections} answered</span>
              {objections > 0 && <span className="cw-badge ex-badge-amber">{plural(objections, 'objection')}</span>}
            </>
          )}
        </p>
      )}
      {!r.respondedAt && sent && <p className="cw-empty">Waiting for Team {r.toTeam.number} to respond.</p>}
      <ol className="ex-answers">
        {r.items.map((item) => (
          <li key={item.position}>
            <p className="ex-question">
              <span>{item.position}.</span> {item.text}
              {item.admission && (
                <span className={`cw-badge ex-admission-${item.admission}`}>{ADMISSION_LABEL[item.admission]}</span>
              )}
              {item.objection && <span className="cw-badge ex-badge-amber">Objection</span>}
            </p>
            {r.respondedAt &&
              (item.admission === 'partial' ? (
                <div className="ex-partial-read">
                  <p className="ex-agree">
                    <Check aria-hidden="true" />
                    Agree: {item.agreePart}
                  </p>
                  <p className="ex-disagree">
                    <X aria-hidden="true" />
                    Disagree: {item.disagreePart}
                  </p>
                </div>
              ) : (
                item.answer && (
                  <div className={item.objection ? 'ex-answer ex-answer-objection' : 'ex-answer'}>
                    <small>
                      {kind === 'rfas'
                        ? 'Explanation'
                        : `${sent ? 'Their' : 'Your'} ${item.objection ? 'objection' : 'answer'}`}
                    </small>
                    {item.answer}
                  </div>
                )
              ))}
          </li>
        ))}
      </ol>
      {r.respondedAt && <p className="cw-section-sub">Both teams see these responses here.</p>}
    </section>
  )
}
