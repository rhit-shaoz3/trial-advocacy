import { useEffect, useState, type ReactNode } from 'react'
import { ArrowRight, CheckCheck, CircleHelp, Eye, Pencil } from 'lucide-react'
import { useCourseService } from '../../../courses/CourseServiceContext'
import { shortDate } from '../../../courses/caseLabels'
import { worldLabel } from '../../../courses/worldLabel'
import type { CourseCase, ExchangeKind, ExchangeRequest, ExchangeSettings } from '../../../courses/types'
import type { ExchangeStep } from './ExchangeSetupFlow'
import { KIND_LABEL, SIDE_LABEL, partSummary, subpoenaSummary } from './exchangeLabels'
import { CheckSummary } from '../../../components/CheckSummary'
import './exchange.css'

const ADMISSION: Record<'agree' | 'disagree' | 'partial', string> = {
  agree: 'Agreed',
  disagree: 'Disagreed',
  partial: 'Partly agreed',
}

/** Answered, waiting, or overdue. */
function status(r: ExchangeRequest, now: Date) {
  if (r.respondedAt) return { label: 'Answered', tone: 'answered' }
  return new Date(r.dueAt) < now ? { label: 'Overdue', tone: 'overdue' } : { label: 'Waiting', tone: 'waiting' }
}

/**
 * The case's Information exchange tab: every set teams have sent each other,
 * read-only and kept off the Review page, and the settings, each of which
 * reopens its step of the setup.
 */
export function ExchangeTab({
  courseId,
  courseCase,
  onEdit,
  summary,
  now = new Date(),
}: {
  courseId: string
  courseCase: CourseCase
  onEdit(step: ExchangeStep): void
  /** Below the exchanges, in the same column: the exchange card, once its phase is over. */
  summary?: ReactNode
  now?: Date
}) {
  const service = useCourseService()
  const [settings, setSettings] = useState<ExchangeSettings | null>(null)
  const [requests, setRequests] = useState<ExchangeRequest[] | null>(null)
  const [kind, setKind] = useState<ExchangeKind | 'all'>('all')
  const [world, setWorld] = useState<number | 'all'>('all')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    service.getExchange(courseId, courseCase.id).then((e) => !cancelled && setSettings(e.settings), () => {})
    service
      .listExchangeRequests(courseId, courseCase.id)
      .then((r) => !cancelled && setRequests(r))
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [service, courseId, courseCase.id])

  const worlds = [...new Set((requests ?? []).map((r) => r.worldNumber))].sort((a, b) => a - b)
  const shown = (requests ?? []).filter((r) => (kind === 'all' || r.kind === kind) && (world === 'all' || r.worldNumber === world))

  return (
    <div className="exchange-tab">
      <div className="exchange-tab-main">
        <section className="course-section" aria-labelledby="exchanges-heading">
          <div className="section-header">
            <div>
              <span className="ws-eyebrow">Read only</span>
              <h2 id="exchanges-heading">Exchanges</h2>
            </div>
            {worlds.length > 1 && (
              <label className="exchange-world-select">
                <select
                  aria-label="Case world"
                  value={world}
                  onChange={(e) => setWorld(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                >
                  <option value="all">Every case world</option>
                  {worlds.map((n) => (
                    <option key={n} value={n}>
                      Case world {worldLabel(n)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="exchange-filters" role="group" aria-label="Show">
            {(['all', 'interrogatories', 'rfas'] as const).map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
                {k === 'all' ? 'All' : KIND_LABEL[k]}
              </button>
            ))}
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {!requests ? (
            !error && <p className="muted">Loading…</p>
          ) : shown.length === 0 ? (
            <p className="muted">
              {courseCase.phase === 'introduction'
                ? 'Teams can send requests once you move the case to information exchange.'
                : 'No requests yet.'}
            </p>
          ) : (
            <ul className="exchange-sets">
              {shown.map((r) => {
                const s = status(r, now)
                const Icon = r.kind === 'interrogatories' ? CircleHelp : CheckCheck
                const noun = r.kind === 'interrogatories' ? 'question' : 'request'
                return (
                  <li key={r.id}>
                    <details className="exchange-set">
                      <summary>
                        <span className={`ws-icon-tile ws-icon-tile-sm ${r.kind === 'interrogatories' ? 'ws-tone-blue' : 'ws-tone-amber'}`} aria-hidden="true">
                          <Icon />
                        </span>
                        <span>
                          <strong>
                            {KIND_LABEL[r.kind]} · Case world {worldLabel(r.worldNumber)}
                          </strong>
                          <small>
                            Team {r.fromTeam.number} ({SIDE_LABEL[r.fromTeam.side]}) <ArrowRight aria-label="to" className="exchange-inline-icon" /> Team{' '}
                            {r.toTeam.number} ({SIDE_LABEL[r.toTeam.side]}) · {r.items.length} {noun}
                            {r.items.length === 1 ? '' : 's'} ·{' '}
                            {r.respondedAt ? `answered ${shortDate(r.respondedAt, now)}` : `due ${shortDate(r.dueAt, now)}`}
                          </small>
                        </span>
                        <span className={`exchange-badge exchange-badge-${s.tone}`}>{s.label}</span>
                      </summary>
                      <ol className="exchange-set-items">
                        {r.items.map((item) => (
                          <li key={item.position}>
                            <strong>
                              {item.position}. {item.text}
                            </strong>
                            {r.respondedAt ? (
                              r.kind === 'interrogatories' ? (
                                <p>
                                  {item.objection && <span className="exchange-badge exchange-badge-objection">Objection</span>} {item.answer}
                                </p>
                              ) : (
                                <p>
                                  <span className="exchange-badge exchange-badge-answered">{ADMISSION[item.admission!]}</span>{' '}
                                  {item.admission === 'partial'
                                    ? `Agree: ${item.agreePart} Disagree: ${item.disagreePart}`
                                    : item.answer}
                                </p>
                              )
                            ) : (
                              <p className="muted">No response yet.</p>
                            )}
                          </li>
                        ))}
                      </ol>
                      <CheckSummary label={`Team ${r.fromTeam.number}'s AI check before sending:`} check={r.check} />
                      {r.respondedAt && (
                        <CheckSummary label={`Team ${r.toTeam.number}'s AI check before answering:`} check={r.responseCheck} />
                      )}
                    </details>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="muted exchange-note">
            <Eye aria-hidden="true" className="exchange-inline-icon" /> Only you can see this view. Students aren&rsquo;t told
            when you look, and nothing here goes to the Review page.
          </p>
        </section>
        {summary}
      </div>

      <section className="course-section exchange-settings-card" aria-labelledby="exchange-settings-heading">
        <div className="section-header">
          <h2 id="exchange-settings-heading">Settings</h2>
          <button type="button" className="btn-secondary" onClick={() => onEdit('disclosures')}>
            <Pencil aria-hidden="true" className="exchange-inline-icon" /> Edit all
          </button>
        </div>
        {settings && (
          <ul>
            {(
              [
                [
                  'disclosures',
                  'Initial disclosures',
                  settings.disclosures.enabled
                    ? `${settings.disclosures.materialIds.length + settings.disclosures.witnessIds.length} items`
                    : 'Not included',
                ],
                ['subpoenas', 'Subpoenas', settings.subpoenas.enabled ? subpoenaSummary(settings.subpoenas) : 'Not included'],
                [
                  'interrogatories',
                  'Interrogatories',
                  settings.interrogatories.enabled ? partSummary(settings.interrogatories, 'questions') : 'Not included',
                ],
                ['rfas', 'Requests for admission', settings.rfas.enabled ? partSummary(settings.rfas, 'requests') : 'Not included'],
                [
                  'email',
                  'Welcome email',
                  [settings.firms.plaintiff.firm, settings.firms.defense.firm].filter(Boolean).join(' · ') || 'No firms yet',
                ],
              ] as [ExchangeStep, string, string][]
            ).map(([step, title, summary]) => (
              <li key={step}>
                <span>
                  <strong>{title}</strong>
                  <small>{summary}</small>
                </span>
                <button type="button" className="link-button exchange-edit" onClick={() => onEdit(step)} aria-label={`Edit ${title.toLowerCase()}`}>
                  <Pencil aria-hidden="true" className="exchange-inline-icon" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="muted exchange-note">
          Lowering a limit doesn&rsquo;t take back requests already sent. New response times apply to sets sent from now on.
        </p>
      </section>
    </div>
  )
}
