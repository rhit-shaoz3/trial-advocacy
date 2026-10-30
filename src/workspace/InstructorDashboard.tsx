import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BriefcaseBusiness,
  CalendarDays,
  ClipboardCheck,
  Gavel,
  MessageSquare,
  Plus,
  SquareDashed,
  UserPlus,
  Users,
} from 'lucide-react'
import { Link } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { PhaseSteps } from '../components/PhaseSteps'
import { PHASE_LABEL, shortDate } from '../courses/caseLabels'
import { casePhases } from '../courses/types'
import { caseInitials, greeting, longDate, timeAgo } from './format'
import { StatCard } from './StatCard'
import type { AttentionItem, AttentionTarget, CaseMonitor, DeadlineProgress, InstructorActivity } from './types'
import { useWorkspace } from './useWorkspace'
import { usePageTour } from '../tour/tourContext'
import { INSTRUCTOR_COURSE } from '../tour/tours'
import './workspace.css'


const ATTENTION_ICON = {
  reviews: Gavel,
  failedReviews: AlertTriangle,
  transcription: AlertTriangle,
  roster: UserPlus,
  launch: SquareDashed,
}
const ATTENTION_ACTION = {
  reviews: 'Review now',
  failedReviews: 'Open Review',
  transcription: 'Open case file',
  roster: 'Manage course',
  launch: 'Set up case',
}

const ACTIVITY_ICON = { interview: MessageSquare, task: ClipboardCheck, review: BadgeCheck, join: UserPlus }
const ACTIVITY_TONE = { interview: 'blue', task: 'amber', review: 'purple', join: 'orange' }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * The instructor's course home: how the course is doing, every case and how
 * ready it is for its next step, what's waiting on them, upcoming deadlines
 * with how many teams finished, and what teams have been doing. Unlike the
 * student dashboard, it's about the whole class, not one team's to-do list.
 */
export function InstructorDashboard({ now = new Date() }: { now?: Date }) {
  const { user } = useAuth()
  const { home, search } = useWorkspace()
  const { stats, cases, attention, deadlines, activity } = home.instructor!
  usePageTour(INSTRUCTOR_COURSE)
  const base = `/courses/${home.course.id}`
  const firstName = user?.name.split(/\s+/)[0] ?? ''
  const hrefFor = (target: AttentionTarget) =>
    target.page === 'case'
      ? `${base}/cases/${target.caseId}${target.tab ? `?tab=${target.tab}` : search}`
      : `${base}/${target.page}${search}`

  return (
    <main className="ws-page">
      <div className="ws-welcome">
        <div>
          <span className="ws-eyebrow">{longDate(now)}</span>
          <h1 className="ws-title">
            {greeting(now)}, {firstName}.
          </h1>
          <p className="ws-subtle">
            {attention.length === 0
              ? `Nothing needs you right now. Here’s how ${home.course.title} is doing.`
              : `${plural(attention.length, 'thing needs', 'things need')} your attention. Here’s how ${home.course.title} is doing.`}
          </p>
        </div>
        <div className="ws-welcome-actions">
          <Link to={`${base}/calendar${search}`} className="ws-btn ws-btn-secondary">
            <CalendarDays aria-hidden="true" />
            View schedule
          </Link>
          <Link to={`${base}/cases/new${search}`} className="ws-btn ws-btn-primary">
            <Plus aria-hidden="true" />
            Add case
          </Link>
        </div>
      </div>

      <section className="ws-stats" aria-label="Course summary">
        <StatCard
          icon={<Users />}
          tone="blue"
          value={`${stats.studentsJoined}/${stats.studentsOnRoster}`}
          label="Students signed up"
          note={stats.studentsJoined < stats.studentsOnRoster ? `${stats.studentsOnRoster - stats.studentsJoined} pending` : undefined}
        />
        <StatCard
          icon={<BriefcaseBusiness />}
          tone="amber"
          value={stats.activeCases}
          label={stats.activeCases === 1 ? 'Active case' : 'Active cases'}
          note={stats.draftCases > 0 ? `+${plural(stats.draftCases, 'draft')}` : undefined}
        />
        <StatCard
          icon={<Gavel />}
          tone="purple"
          value={stats.reviewsWaiting}
          label={stats.reviewsWaiting === 1 ? 'Review waiting' : 'Reviews waiting'}
          urgent={stats.reviewsWaiting > 0}
          note={stats.reviewsWaiting > 0 ? 'Needs your ruling' : undefined}
        />
      </section>

      {attention.length > 0 && (
        <section className="ws-panel ws-attention" aria-labelledby="ws-attention-heading">
          <h2 id="ws-attention-heading">Needs your attention</h2>
          <ul>
            {attention.map((item) => (
              <AttentionRow key={item.id} item={item} href={hrefFor(item.target)} />
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="ws-monitor-heading">
        <div className="ws-section-heading">
          <div>
            <h2 id="ws-monitor-heading">Case monitor</h2>
            <p>Where each case stands, and whether it’s ready for its next step</p>
          </div>
          {cases.length > 0 && (
            <Link to={`${base}/cases${search}`} className="ws-link">
              View all cases
              <ArrowRight aria-hidden="true" />
            </Link>
          )}
        </div>
        {cases.length === 0 ? (
          <div className="ws-empty">
            <p>No cases yet.</p>
            <p className="ws-subtle">Create a case and pair your students into teams to get started.</p>
            <Link to={`${base}/cases/new${search}`} className="ws-btn ws-btn-primary">
              <Plus aria-hidden="true" />
              Add your first case
            </Link>
          </div>
        ) : (
          <ul className="ws-cases">
            {cases.map((c) => (
              <li key={c.id}>
                <CaseMonitorCard caseMonitor={c} href={`${base}/cases/${c.id}${search}`} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="ws-bottom-grid">
        <section className="ws-panel" aria-labelledby="ws-activity-heading">
          <h2 id="ws-activity-heading">Recent activity</h2>
          <p className="ws-panel-sub">What teams and students have been doing</p>
          {activity.length === 0 ? (
            <p className="ws-subtle ws-panel-empty">No activity yet.</p>
          ) : (
            <ul className="ws-activity">
              {activity.map((a) => (
                <ActivityRow key={a.id} item={a} now={now} />
              ))}
            </ul>
          )}
        </section>

        <section className="ws-panel" aria-labelledby="ws-deadlines-heading">
          <h2 id="ws-deadlines-heading">Upcoming deadlines</h2>
          <p className="ws-panel-sub">How many teams have finished each one</p>
          {deadlines.length === 0 ? (
            <p className="ws-subtle ws-panel-empty">No upcoming task deadlines.</p>
          ) : (
            <ul className="ws-upcoming">
              {deadlines.map((d) => (
                <DeadlineRow key={d.id} deadline={d} href={`${base}/cases/${d.caseId}?tab=tasks`} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}

function AttentionRow({ item, href }: { item: AttentionItem; href: string }) {
  const Icon = ATTENTION_ICON[item.kind]
  return (
    <li className={`ws-attention-row ws-attention-${item.kind}`}>
      <Icon aria-hidden="true" />
      <p>{item.text}</p>
      <Link to={href} className="ws-link">
        {ATTENTION_ACTION[item.kind]}
        <ArrowRight aria-hidden="true" />
      </Link>
    </li>
  )
}

/** A case's status, its phase, and the signal for its next step (launch, or moving on a phase). */
function CaseMonitorCard({ caseMonitor: c, href }: { caseMonitor: CaseMonitor; href: string }) {
  const statusTone = c.status === 'draft' ? 'in-review' : c.status
  const statusLabel = c.status === 'draft' ? 'Draft' : c.status === 'active' ? 'Active' : 'Closed'
  return (
    <article className={`ws-case ws-case-${statusTone} ws-monitor`} aria-label={c.title}>
      <div className="ws-case-top">
        <span className="ws-case-number">{plural(c.worldCount, 'case world')}</span>
        <span className={`ws-status ws-status-${statusTone}`}>
          <i aria-hidden="true" />
          {statusLabel}
        </span>
      </div>

      <div className="ws-case-title">
        <span className="ws-case-emblem" aria-hidden="true">
          {caseInitials(c.title)}
        </span>
        <div>
          <h3>{c.title}</h3>
          <p>{c.status === 'draft' ? 'Not launched yet' : `${PHASE_LABEL[c.phase]} phase`}</p>
        </div>
      </div>

      {c.status !== 'draft' && <PhaseSteps phase={c.phase} phases={casePhases(c.investigatorEnabled !== false, c.exchangeReady ?? false)} />}

      {c.launch && (
        <Meter
          label="Launch checklist"
          value={c.launch.ready}
          total={c.launch.total}
          text={`${c.launch.ready} of ${c.launch.total} ready`}
          note={c.launch.next ?? 'Ready to launch.'}
        />
      )}
      {c.tasks && <TaskSignal tasks={c.tasks} />}

      <div className="ws-case-footer ws-monitor-footer">
        <Link
          to={href}
          className={`ws-btn ${c.status === 'closed' ? 'ws-btn-secondary' : 'ws-btn-primary'}`}
          aria-label={`${c.status === 'draft' ? 'Set up case' : 'Open case'}: ${c.title}`}
        >
          {c.status === 'draft' ? 'Set up case' : 'Open case'}
          <ArrowRight aria-hidden="true" />
        </Link>
      </div>
    </article>
  )
}

/**
 * Introduction → Information exchange → Investigate → Deposition (each middle
 * phase only when the case has it), with the current phase marked.
 */
/** Whether teams have done what's due: the instructor's cue to move the case on. */
function TaskSignal({ tasks }: { tasks: NonNullable<CaseMonitor['tasks']> }) {
  if (tasks.teams === 0) return <p className="ws-subtle ws-monitor-note">No teams are in a case world yet.</p>
  if (tasks.assigned === 0) return <p className="ws-subtle ws-monitor-note">No tasks assigned yet.</p>
  if (tasks.due === 0) {
    return (
      <Meter
        label="Teams done with every task"
        value={tasks.teamsDoneAll}
        total={tasks.teams}
        text={`${tasks.teamsDoneAll} of ${tasks.teams} teams`}
        note={`No tasks due yet · ${plural(tasks.assigned, 'task')} assigned`}
      />
    )
  }
  return (
    <Meter
      label="Teams done with tasks due so far"
      value={tasks.teamsDoneDue}
      total={tasks.teams}
      text={`${tasks.teamsDoneDue} of ${tasks.teams} teams`}
      note={
        tasks.teamsDoneDue === tasks.teams
          ? 'Every team is caught up. Consider moving to the next phase.'
          : `${plural(tasks.due, 'task')} due so far`
      }
    />
  )
}

function Meter({ label, value, total, text, note }: { label: string; value: number; total: number; text: string; note: string }) {
  const percent = total === 0 ? 0 : Math.round((value / total) * 100)
  return (
    <div className="ws-monitor-meter">
      <div className="ws-progress-header">
        <span>{label}</span>
        <strong>{text}</strong>
      </div>
      <div className="ws-progress" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={total}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="ws-subtle ws-monitor-note">{note}</p>
    </div>
  )
}

function DeadlineRow({ deadline: d, href }: { deadline: DeadlineProgress; href: string }) {
  const date = new Date(d.dueAt)
  return (
    <li className="ws-upcoming-row">
      <span className="ws-date-box ws-date-deadline">
        <strong>{date.getDate()}</strong>
        <small>{date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</small>
      </span>
      <div className="ws-deadline-body">
        <h3>
          <Link to={href}>{d.title}</Link>
        </h3>
        <p>
          {d.caseTitle} · due {shortDate(d.dueAt)}
        </p>
        <div
          className="ws-progress ws-progress-thin"
          role="progressbar"
          aria-label={`${d.title}: teams done`}
          aria-valuenow={d.teamsDone}
          aria-valuemin={0}
          aria-valuemax={d.teams}
        >
          <span style={{ width: `${d.teams === 0 ? 0 : Math.round((d.teamsDone / d.teams) * 100)}%` }} />
        </div>
      </div>
      <strong className="ws-deadline-count">
        {d.teamsDone}/{d.teams}
        <small>teams done</small>
      </strong>
    </li>
  )
}

function ActivityRow({ item, now }: { item: InstructorActivity; now: Date }) {
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
          {item.caseTitle ? `${item.caseTitle} · ` : ''}
          {timeAgo(item.at, now)}
        </small>
      </div>
    </li>
  )
}
