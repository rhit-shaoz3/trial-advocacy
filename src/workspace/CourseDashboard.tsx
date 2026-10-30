import {
  ArrowRight,
  BadgeCheck,
  BriefcaseBusiness,
  CalendarDays,
  CircleCheck,
  ClipboardCheck,
  Clock,
  FileText,
  Gavel,
  Users,
} from 'lucide-react'
import { Link } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { Avatar } from '../components/Avatar'
import { PhaseSteps } from '../components/PhaseSteps'
import { Toast, Toasts } from '../components/Toasts'
import { PHASE_LABEL, shortDate } from '../courses/caseLabels'
import { sideLabel, worldLabel } from '../courses/worldLabel'
import {
  calendarDaysUntil,
  caseInitials,
  clockTime,
  greeting,
  inDays,
  longDate,
  shortMonth,
  timeAgo,
} from './format'
import { InstructorDashboard } from './InstructorDashboard'
import { StatCard } from './StatCard'
import type { ActivityItem, CaseStatus, CaseSummary, CourseHome, UpcomingItem } from './types'
import { useWorkspace } from './useWorkspace'
import { usePageTour } from '../tour/tourContext'
import { STUDENT_COURSE } from '../tour/tours'
import './workspace.css'

const MAX_CASES = 4
const MAX_AVATARS = 4
const MAX_ACTIVITY = 5
const MAX_UPCOMING = 4

const STATUS_LABEL: Record<CaseStatus, string> = {
  active: 'Active',
  'in-review': 'In review',
  closed: 'Closed',
}
const STATUS_ORDER: Record<CaseStatus, number> = { active: 0, 'in-review': 1, closed: 2 }

const ACTIVITY_ICON = { task: ClipboardCheck, document: FileText, approval: BadgeCheck }
const ACTIVITY_TONE = { task: 'blue', document: 'amber', approval: 'green' }

/**
 * The course home. Students get theirs here: greeting, stats, their cases,
 * recent activity, upcoming. The instructor gets their own (InstructorDashboard).
 */
export function CourseDashboard({ now = new Date() }: { now?: Date }) {
  const { user } = useAuth()
  const { home } = useWorkspace()
  if (user?.role === 'instructor' && home.instructor) return <InstructorDashboard now={now} />
  return <StudentDashboard now={now} />
}

function StudentDashboard({ now }: { now: Date }) {
  const { user } = useAuth()
  const { home, search } = useWorkspace()
  usePageTour(STUDENT_COURSE)
  const base = `/courses/${home.course.id}`

  const upcoming = home.upcoming
    .filter((u) => new Date(u.at) >= now)
    .sort((a, b) => a.at.localeCompare(b.at))
  const deadlines = upcoming.filter((u) => u.kind === 'deadline')
  const daysToDeadline = deadlines[0] ? calendarDaysUntil(new Date(deadlines[0].at), now) : null
  const activeCases = home.cases.filter((c) => c.status === 'active').length
  const cases = [...home.cases]
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
    .slice(0, MAX_CASES)
  const firstName = user?.name.split(/\s+/)[0] ?? ''
  const isInstructor = user?.role === 'instructor'

  return (
    <main className="ws-page">
      <div className="ws-welcome">
        <div>
          <span className="ws-eyebrow">{longDate(now)}</span>
          <h1 className="ws-title">
            {greeting(now)}, {firstName}.
          </h1>
          <p className="ws-subtle">
            {daysToDeadline === null
              ? 'No case deadlines coming up.'
              : `Your next case deadline is ${inDays(daysToDeadline)}.`}{' '}
            Here’s where things stand.
          </p>
        </div>
        <Link to={`${base}/calendar${search}`} className="ws-btn ws-btn-secondary">
          <CalendarDays aria-hidden="true" />
          View schedule
        </Link>
      </div>

      <Toasts>
        {isInstructor && home.reviewCount ? (
          <Toast
            icon={<Gavel />}
            title={home.reviewCount === 1 ? '1 review waiting' : `${home.reviewCount} reviews waiting`}
            action={{ label: 'Review now', to: `${base}/review${search}` }}
          />
        ) : null}
        {!isInstructor && home.newReviewResults ? (
          <Toast
            icon={<Gavel />}
            title={home.newResultsAt?.kind === 'investigation' ? 'New investigator report' : 'New review results'}
            action={{
              label: !home.newResultsAt ? 'Open my cases' : home.newResultsAt.kind === 'investigation' ? 'Read report' : 'See results',
              to: newResultsPath(base, search, home.newResultsAt),
            }}
          />
        ) : null}
      </Toasts>

      <section className="ws-stats" aria-label="Summary">
        <StatCard
          icon={<BriefcaseBusiness />}
          tone="blue"
          value={activeCases}
          label="Active cases"
          note={home.course.term}
        />
        <StatCard
          icon={<CircleCheck />}
          tone="amber"
          value={home.stats.tasksCompleted}
          label="Tasks completed"
          note={
            home.stats.tasksCompletedThisWeek > 0
              ? `+${home.stats.tasksCompletedThisWeek} this week`
              : undefined
          }
        />
        <StatCard
          icon={<Clock />}
          tone="purple"
          value={deadlines.length}
          label="Upcoming deadlines"
          note={daysToDeadline === null ? undefined : `Next ${inDays(daysToDeadline)}`}
          urgent={daysToDeadline !== null && daysToDeadline <= 3}
        />
      </section>

      <section aria-labelledby="ws-cases-heading">
        <div className="ws-section-heading">
          <div>
            <h2 id="ws-cases-heading">{isInstructor ? 'All cases' : 'Your cases'}</h2>
            <p>{isInstructor ? 'Every team’s case in this course' : 'Continue where you left off'}</p>
          </div>
          {home.cases.length > 0 && (
            <Link to={`${base}/cases${search}`} className="ws-link">
              View all cases
              <ArrowRight aria-hidden="true" />
            </Link>
          )}
        </div>
        {cases.length === 0 ? (
          <div className="ws-empty">
            {isInstructor ? (
              <>
                <p>No cases yet.</p>
                <p className="ws-subtle">
                  Cases you set up and assign to student teams will show up here.
                </p>
              </>
            ) : (
              <>
                <p>You haven’t been assigned to a case yet.</p>
                <p className="ws-subtle">
                  Once your instructor puts you on a team, your cases will show up here.
                </p>
              </>
            )}
          </div>
        ) : (
          <ul className="ws-cases">
            {cases.map((c) => (
              <li key={c.id}>
                <CaseCard caseSummary={c} href={`${base}/cases/${c.id}${search}`} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="ws-bottom-grid">
        <section className="ws-panel" aria-labelledby="ws-activity-heading">
          <h2 id="ws-activity-heading">Recent activity</h2>
          <p className="ws-panel-sub">Updates from your case worlds</p>
          {home.activity.length === 0 ? (
            <p className="ws-subtle ws-panel-empty">No activity yet.</p>
          ) : (
            <ul className="ws-activity">
              {home.activity.slice(0, MAX_ACTIVITY).map((a) => (
                <ActivityRow key={a.id} item={a} now={now} />
              ))}
            </ul>
          )}
        </section>

        <section className="ws-panel" aria-labelledby="ws-upcoming-heading">
          <h2 id="ws-upcoming-heading">Upcoming</h2>
          <p className="ws-panel-sub">Deadlines &amp; events</p>
          {upcoming.length === 0 ? (
            <p className="ws-subtle ws-panel-empty">Nothing scheduled.</p>
          ) : (
            <ul className="ws-upcoming">
              {upcoming.slice(0, MAX_UPCOMING).map((u) => (
                <UpcomingRow key={u.id} item={u} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}

/** Top-left of a case card: the student's world, a docket number, or the instructor's world count. */
function caseLabel(c: CaseSummary) {
  if (c.world) return `Case world ${worldLabel(c.world.number)}`
  if (c.caseNumber) return `Case ${c.caseNumber}`
  if (c.worldCount != null) return c.worldCount === 1 ? '1 case world' : `${c.worldCount} case worlds`
  return 'Case world not assigned yet'
}

/** Under the title: the student's role, or the sample data's case type. */
function caseSubtitle(c: CaseSummary) {
  if (c.world) return `Role: ${sideLabel(c.world.side, c.parties)}`
  if (c.caseType) return c.caseType
  if (c.worldCount == null) return 'Awaiting opposition'
  return null
}

function CaseCard({ caseSummary: c, href }: { caseSummary: CaseSummary; href: string }) {
  const subtitle = caseSubtitle(c)
  const milestone =
    c.nextMilestone ??
    (c.nextTask
      ? `${c.nextTask.title}${c.nextTask.dueAt ? ` · due ${shortDate(c.nextTask.dueAt)}` : ''}`
      : null)
  const shown = c.participants.slice(0, MAX_AVATARS)
  const hidden = c.participants.length - shown.length
  return (
    <article className={`ws-case ws-case-${c.status}`} aria-label={c.title}>
      <div className="ws-case-top">
        <span className="ws-case-number">{caseLabel(c)}</span>
        <span className={`ws-status ws-status-${c.status}`}>
          <i aria-hidden="true" />
          {STATUS_LABEL[c.status]}
        </span>
      </div>

      <div className="ws-case-title">
        <span className="ws-case-emblem" aria-hidden="true">
          {caseInitials(c.title)}
        </span>
        <div>
          <h3>{c.title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>

      {c.phase && c.phases && c.status === 'active' && (
        <div className="ws-case-phase">
          <div className="ws-progress-header">
            <span>Current phase</span>
            <strong>{PHASE_LABEL[c.phase]}</strong>
          </div>
          <PhaseSteps phase={c.phase} phases={c.phases} />
        </div>
      )}

      <div className="ws-case-meta">
        {milestone && (
          <span>
            <Clock aria-hidden="true" />
            {milestone}
          </span>
        )}
        <span>
          <Users aria-hidden="true" />
          {c.participants.length} participant{c.participants.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="ws-case-footer">
        <span className="ws-avatar-stack" aria-label={c.participants.map((p) => p.name).join(', ')}>
          {shown.map((p) => (
            <Avatar key={p.name} name={p.name} src={p.avatarUrl} size="sm" />
          ))}
          {hidden > 0 && <span className="ws-avatar-more">+{hidden}</span>}
        </span>
        <Link
          to={href}
          className={`ws-btn ${c.status === 'active' ? 'ws-btn-primary' : 'ws-btn-secondary'}`}
          aria-label={`${c.status === 'in-review' ? 'View submission' : 'Enter case'}: ${c.title}`}
        >
          {c.status === 'in-review' ? 'View submission' : c.status === 'closed' ? 'View case' : 'Enter case'}
          <ArrowRight aria-hidden="true" />
        </Link>
      </div>
    </article>
  )
}

function ActivityRow({ item, now }: { item: ActivityItem; now: Date }) {
  const Icon = ACTIVITY_ICON[item.kind]
  return (
    <li className="ws-activity-row">
      <span className={`ws-icon-tile ws-icon-tile-sm ws-tone-${ACTIVITY_TONE[item.kind]}`} aria-hidden="true">
        <Icon />
      </span>
      <div>
        <p>
          {item.actor && <strong>{item.actor} </strong>}
          {item.action}
        </p>
        <small>
          {item.caseTitle} · {timeAgo(item.at, now)}
        </small>
      </div>
    </li>
  )
}

function UpcomingRow({ item }: { item: UpcomingItem }) {
  const date = new Date(item.at)
  return (
    <li className="ws-upcoming-row">
      <span className={`ws-date-box ws-date-${item.kind}`}>
        <strong>{date.getDate()}</strong>
        <small>{shortMonth(item.at)}</small>
      </span>
      <div>
        <h3>{item.title}</h3>
        <p>{item.caseTitle}</p>
        <time dateTime={item.at} className={item.kind === 'deadline' ? 'ws-urgent' : undefined}>
          {clockTime(item.at)}
        </time>
      </div>
    </li>
  )
}

/** Straight to the tab holding the student's newest unread result, or to My cases when we don't know which. */
function newResultsPath(base: string, search: string, at: CourseHome['newResultsAt']) {
  if (!at) return `${base}/cases${search}`
  const params = new URLSearchParams(search)
  params.set('tab', at.kind === 'investigation' ? 'investigator' : 'reviews')
  return `${base}/cases/${at.caseId}?${params}`
}
