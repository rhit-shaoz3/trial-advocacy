import { useEffect, useState } from 'react'
import { Clock, Gavel, Search } from 'lucide-react'
import { useCourseService } from '../../courses/CourseServiceContext'
import type { CourseCase, DepositionOverview, InvestigatorOverview } from '../../courses/types'
import { investigatorOf } from '../../courses/types'
import './exchange/exchange.css'

// The case dashboard's card for the investigate and deposition phases, in the
// style of the information exchange card. Once the case moves on, each card
// moves to its own tab.

/** Percent, for a bar. */
const share = (n: number, of: number) => (of === 0 ? 0 : Math.round((n / of) * 100))

function TeamsBar({ label, done, total }: { label: string; done: number; total: number }) {
  return (
    <div className="exchange-stat">
      <span>{label}</span>
      <div className="exchange-stat-number" aria-label={`${done} of ${total} teams`}>
        {done}/{total}
        <small>teams</small>
      </div>
      <div className="exchange-bar" aria-hidden="true">
        <span style={{ width: `${share(done, total)}%` }} />
      </div>
      {total > done && <p>{total - done} haven&rsquo;t yet.</p>}
    </div>
  )
}

function Count({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="exchange-stat">
      <span>{label}</span>
      <div className="exchange-stat-number">{value}</div>
      <p>{note}</p>
    </div>
  )
}

/** How teams have used the background investigator. */
export function InvestigatorCard({
  courseId,
  courseCase,
  inTab = false,
}: {
  courseId: string
  courseCase: CourseCase
  /** On the Investigator tab (after its phase): styled like the tab's settings card, and as wide. */
  inTab?: boolean
}) {
  const service = useCourseService()
  const [overview, setOverview] = useState<InvestigatorOverview | null>(null)
  const current = courseCase.phase === 'investigate'

  useEffect(() => {
    let cancelled = false
    service.getInvestigatorOverview(courseId, courseCase.id).then((o) => !cancelled && setOverview(o), () => {})
    return () => {
      cancelled = true
    }
  }, [service, courseId, courseCase.id, courseCase.phase])

  return (
    <section
      className={inTab ? 'exchange-card exchange-card-in-tab investigator-card-in-tab' : 'exchange-card'}
      aria-labelledby="investigator-card-title"
    >
      <div className="exchange-card-head">
        <span className="ws-icon-tile ws-tone-blue" aria-hidden="true">
          <Search />
        </span>
        <div>
          <div className="exchange-eyebrow">
            <span className="ws-eyebrow">Background investigator</span>
            <span className={current ? 'exchange-phase-badge exchange-phase-open' : 'exchange-phase-badge'}>
              {current ? 'Investigate phase' : 'Phase finished'}
            </span>
          </div>
          <h2 id="investigator-card-title">Assignments to {investigatorOf(courseCase).name}</h2>
        </div>
      </div>
      {overview && (
        <>
          <div className="exchange-stats">
            <TeamsBar label="Teams that have used him" done={overview.teamsUsed} total={overview.teams} />
            <Count label="Conversations" value={overview.requests} note="Assignments sent, whole class" />
          </div>
          {overview.waiting > 0 && (
            <p className="exchange-waiting">
              <Clock aria-hidden="true" />
              <strong>
                {overview.waiting} {overview.waiting === 1 ? 'report' : 'reports'} not back to the team yet
              </strong>
            </p>
          )}
        </>
      )}
    </section>
  )
}

/** How teams are deposing the other side's witnesses. */
export function DepositionCard({ courseId, courseCase }: { courseId: string; courseCase: CourseCase }) {
  const service = useCourseService()
  const [overview, setOverview] = useState<DepositionOverview | null>(null)

  useEffect(() => {
    let cancelled = false
    service.getDepositionOverview(courseId, courseCase.id).then((o) => !cancelled && setOverview(o), () => {})
    return () => {
      cancelled = true
    }
  }, [service, courseId, courseCase.id, courseCase.phase])

  return (
    <section className="exchange-card" aria-labelledby="deposition-card-title">
      <div className="exchange-card-head">
        <span className="ws-icon-tile ws-tone-blue" aria-hidden="true">
          <Gavel />
        </span>
        <div>
          <div className="exchange-eyebrow">
            <span className="ws-eyebrow">Depositions</span>
            <span className="exchange-phase-badge exchange-phase-open">Deposition phase</span>
          </div>
          <h2 id="deposition-card-title">Deposing the other side&rsquo;s witnesses</h2>
        </div>
      </div>
      {overview && (
        <>
          <div className="exchange-stats">
            <TeamsBar label="Teams that have deposed a witness" done={overview.teamsDeposed} total={overview.teams} />
            <Count label="Depositions" value={overview.depositions} note="Whole class" />
            <Count
              label="Questions asked"
              value={overview.questions}
              note={`${overview.objections} ${overview.objections === 1 ? 'objection' : 'objections'} from the witnesses' lawyers`}
            />
          </div>
          {overview.reviewsWaiting > 0 && (
            <p className="exchange-waiting">
              <Clock aria-hidden="true" />
              <strong>
                {overview.reviewsWaiting} {overview.reviewsWaiting === 1 ? 'interview' : 'interviews'} waiting for your review
              </strong>
            </p>
          )}
        </>
      )}
    </section>
  )
}
