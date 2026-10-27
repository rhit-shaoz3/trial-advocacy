import { useEffect, useState } from 'react'
import { ArrowRight, CheckCheck, CircleHelp, Clock, Eye, Lock, Pencil, ScrollText, Share2, Users } from 'lucide-react'
import { useCourseService } from '../../../courses/CourseServiceContext'
import { worldLabel } from '../../../courses/worldLabel'
import type { CourseCase, ExchangeOverview, ExchangeSettings } from '../../../courses/types'
import { partSummary } from './exchangeLabels'
import './exchange.css'

const PARTS = [
  { icon: Users, name: 'Initial disclosures', detail: 'What each side must share' },
  { icon: ScrollText, name: 'Subpoenas', detail: 'Records from the other side' },
  { icon: CircleHelp, name: 'Interrogatories', detail: 'Written questions' },
  { icon: CheckCheck, name: 'Requests for admission', detail: 'Facts to agree on' },
]

/** Percent, for a bar. */
const share = (n: number, of: number) => (of === 0 ? 0 : Math.round((n / of) * 100))

/**
 * The first card on the case page. Until the information exchange is set up,
 * it explains it and opens the setup. In the introduction phase it counts the
 * students who have submitted their initial disclosures; after that, it shows
 * the class's requests and what's waiting for answers.
 */
export function ExchangeCard({
  courseId,
  courseCase,
  onSetUp,
  onOpenExchanges,
}: {
  courseId: string
  courseCase: CourseCase
  /** Opens the setup flow (to edit, once it's set up). */
  onSetUp(): void
  /** Opens the Information exchange tab. */
  onOpenExchanges(): void
}) {
  const service = useCourseService()
  const ready = courseCase.exchangeReady ?? false
  const [settings, setSettings] = useState<ExchangeSettings | null>(null)
  const [overview, setOverview] = useState<ExchangeOverview | null>(null)

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    service.getExchange(courseId, courseCase.id).then((e) => !cancelled && setSettings(e.settings), () => {})
    service.getExchangeOverview(courseId, courseCase.id).then((o) => !cancelled && setOverview(o), () => {})
    return () => {
      cancelled = true
    }
  }, [service, courseId, courseCase.id, ready, courseCase.phase])

  if (!ready) {
    return (
      <section className="exchange-card" aria-labelledby="exchange-card-title">
        <div className="exchange-card-head">
          <span className="ws-icon-tile ws-tone-blue" aria-hidden="true">
            <Share2 />
          </span>
          <div>
            <div className="exchange-eyebrow">
              <span className="ws-eyebrow">Information exchange</span>
              <span className="exchange-phase-badge exchange-phase-waiting">Not set up</span>
            </div>
            <h2 id="exchange-card-title">Set up how teams exchange information</h2>
            <p className="muted">
              Before the investigation, teams trade information and records: initial disclosures, subpoenas,
              interrogatories, and requests for admission. Choose what&rsquo;s included, the limits for each team, and how
              long the other side has to respond.
            </p>
          </div>
          <button type="button" className="btn-primary exchange-cta" onClick={onSetUp}>
            Set up information exchange <ArrowRight aria-hidden="true" />
          </button>
        </div>
        <ul className="exchange-parts">
          {PARTS.map(({ icon: Icon, name, detail }) => (
            <li key={name}>
              <strong>
                <Icon aria-hidden="true" className="exchange-part-icon" /> {name}
              </strong>
              <small>{detail}</small>
            </li>
          ))}
        </ul>
        <p className="muted exchange-note">
          <Lock aria-hidden="true" className="exchange-inline-icon" /> Students won&rsquo;t see information exchange until
          you finish setting it up.
        </p>
      </section>
    )
  }

  const introduction = courseCase.phase === 'introduction' || courseCase.status === 'draft'
  const counting = introduction && courseCase.status !== 'draft' && settings?.disclosures.enabled
  const phaseBadge =
    courseCase.status === 'draft'
      ? { label: 'Ready for launch', tone: '' }
      : introduction
        ? { label: 'Introduction phase', tone: '' }
        : { label: `${courseCase.phase === 'information_exchange' ? 'Information exchange' : 'Requests'} open`, tone: 'exchange-phase-open' }

  return (
    <section className="exchange-card" aria-labelledby="exchange-card-title">
      <div className="exchange-card-head">
        <span className="ws-icon-tile ws-tone-blue" aria-hidden="true">
          <Share2 />
        </span>
        <div>
          <div className="exchange-eyebrow">
            <span className="ws-eyebrow">Information exchange</span>
            <span className={`exchange-phase-badge ${phaseBadge.tone}`}>{phaseBadge.label}</span>
          </div>
          <h2 id="exchange-card-title">
            {counting ? 'Initial disclosures' : introduction ? 'Set up and ready' : 'Requests between teams'}
          </h2>
        </div>
        <div className="exchange-card-actions">
          <button type="button" className="btn-secondary" onClick={onSetUp}>
            <Pencil aria-hidden="true" className="exchange-inline-icon" /> Edit settings
          </button>
          {!introduction && (
            <button type="button" className="btn-primary" onClick={onOpenExchanges}>
              <Eye aria-hidden="true" className="exchange-inline-icon" /> See the exchanges
            </button>
          )}
        </div>
      </div>

      {counting && overview && (
        <div className="exchange-stats">
          <div className="exchange-stat">
            <span>Students who have submitted</span>
            <div className="exchange-stat-number" aria-label={`${overview.submissions.submitted} of ${overview.submissions.total} students`}>
              {overview.submissions.submitted}/{overview.submissions.total}
              <small>students</small>
            </div>
            <div className="exchange-bar" aria-hidden="true">
              <span style={{ width: `${share(overview.submissions.submitted, overview.submissions.total)}%` }} />
            </div>
            {overview.submissions.total > overview.submissions.submitted && (
              <p>{overview.submissions.total - overview.submissions.submitted} haven&rsquo;t submitted yet.</p>
            )}
          </div>
          {overview.submissions.byWorld.length > 0 && (
            <div className="exchange-stat">
              <span>By case world</span>
              <ul className="exchange-bars">
                {overview.submissions.byWorld.map((w) => (
                  <li key={w.number}>
                    Case world {worldLabel(w.number)}
                    <span className="exchange-bar" aria-hidden="true">
                      <span style={{ width: `${share(w.submitted, w.total)}%` }} />
                    </span>
                    <strong>
                      {w.submitted}/{w.total}
                    </strong>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {!introduction && overview && (
        <>
          <div className="exchange-stats">
            {settings?.interrogatories.enabled && (
              <div className="exchange-stat">
                <span>Interrogatories sent</span>
                <div className="exchange-stat-number">{overview.activity.interrogatoriesSent}</div>
                <p>Questions, whole class</p>
              </div>
            )}
            {settings?.rfas.enabled && (
              <div className="exchange-stat">
                <span>Requests for admission sent</span>
                <div className="exchange-stat-number">{overview.activity.rfasSent}</div>
                <p>Requests, whole class</p>
              </div>
            )}
            <div className="exchange-stat">
              <span>Teams that have sent at least one</span>
              <ul className="exchange-bars">
                {settings?.interrogatories.enabled && (
                  <li>
                    Interrogatories
                    <span className="exchange-bar" aria-hidden="true">
                      <span style={{ width: `${share(overview.activity.teamsSentInterrogatories, overview.activity.teams)}%` }} />
                    </span>
                    <strong>
                      {overview.activity.teamsSentInterrogatories}/{overview.activity.teams}
                    </strong>
                  </li>
                )}
                {settings?.rfas.enabled && (
                  <li>
                    Requests for admission
                    <span className="exchange-bar" aria-hidden="true">
                      <span style={{ width: `${share(overview.activity.teamsSentRfas, overview.activity.teams)}%` }} />
                    </span>
                    <strong>
                      {overview.activity.teamsSentRfas}/{overview.activity.teams}
                    </strong>
                  </li>
                )}
              </ul>
            </div>
          </div>
          <p className="exchange-waiting">
            <Clock aria-hidden="true" />
            <strong>
              {overview.activity.waiting} {overview.activity.waiting === 1 ? 'set' : 'sets'} waiting for answers
            </strong>
            {overview.activity.overdue > 0 && <span className="exchange-overdue">{overview.activity.overdue} overdue</span>}
          </p>
        </>
      )}

      {settings && (introduction || !overview) && (
        <ul className="exchange-parts" aria-label="Your settings">
          <li>
            <strong>Initial disclosures</strong>
            <small>
              {settings.disclosures.enabled
                ? `${settings.disclosures.materialIds.length + settings.disclosures.witnessIds.length} items`
                : 'Not included'}
            </small>
          </li>
          <li>
            <strong>Interrogatories</strong>
            <small>{settings.interrogatories.enabled ? partSummary(settings.interrogatories, 'questions') : 'Not included'}</small>
          </li>
          <li>
            <strong>Requests for admission</strong>
            <small>{settings.rfas.enabled ? partSummary(settings.rfas, 'requests') : 'Not included'}</small>
          </li>
          <li>
            <strong>Subpoenas</strong>
            <small>{settings.subpoenas.enabled ? partSummary(settings.subpoenas, 'subpoenas') : 'Not included'}</small>
          </li>
        </ul>
      )}
    </section>
  )
}
