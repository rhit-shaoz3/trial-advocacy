import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import {
  ArrowRight,
  CalendarClock,
  Check,
  ChevronRight,
  ClipboardList,
  Download,
  FileText,
  Image,
  FileAudio,
  FileVideo,
  Gavel,
  Lock,
  MessageSquare,
  Search,
  Users,
} from 'lucide-react'
import { Avatar } from '../components/Avatar'
import { WitnessAvatar } from '../components/WitnessAvatar'
import {
  AUDIENCE_LABEL,
  CATEGORY_HEADING,
  CATEGORY_LABEL,
  FILE_CATEGORIES,
  PHASE_LABEL,
  dueLabel,
  fileCategory,
  fileTypeLabel,
  formatSize,
  shortDate,
  type FileCategory,
} from '../courses/caseLabels'
import type { CaseMaterial, CaseWorkspace, MyTeamMember, ReviewResult, Side } from '../courses/types'
import { ROLE_LABEL, worldLabel } from '../courses/worldLabel'
import { caseInitials } from '../workspace/format'
import './caseWorkspace.css'

type Tab = 'overview' | 'case-file' | 'witnesses' | 'investigator' | 'tasks' | 'reviews'
type WorkspaceTask = CaseWorkspace['tasks'][number]

const CATEGORY_ICON: Record<FileCategory, typeof FileText> = {
  document: FileText,
  image: Image,
  audio: FileAudio,
  video: FileVideo,
}

const COUNSEL: Record<Side, string> = { plaintiff: 'Plaintiff counsel', defense: 'Defense counsel' }
const other = (side: Side): Side => (side === 'plaintiff' ? 'defense' : 'plaintiff')
const displayName = (m: MyTeamMember) => m.name ?? m.email

/**
 * One case's dashboard, as a student on a team sees it: an overview (progress,
 * fact pattern, next task, team, instructor note) and tabs for the case file,
 * witnesses, and tasks. The instructor's preview shows the same thing with
 * nothing to click that would change it.
 */
export function CaseWorkspaceView({
  workspace,
  downloadUrl,
  onToggleTask,
  interviewHref,
  instructorName,
  instructorAvatarUrl,
  reviews,
  onOpenReviews,
  now = new Date(),
}: {
  workspace: CaseWorkspace
  downloadUrl(materialId: string): string
  /** Where a team interviews an AI witness; leave out (the preview) and the Interview buttons do nothing. */
  interviewHref?(witnessId: string): string
  /** Marks a task done or not done for the team; leave out to make tasks read-only. */
  onToggleTask?(taskId: string, done: boolean): Promise<void>
  instructorName?: string | null
  instructorAvatarUrl?: string | null
  /** The team's completed reviews; leave out (the preview) to hide the Reviews tab. */
  reviews?: ReviewResult[]
  /** Called when the student opens the Reviews tab, to mark the results read. */
  onOpenReviews?(): void
  now?: Date
}) {
  const [tab, setTabState] = useState<Tab>('overview')
  const unseen = reviews?.filter((r) => !r.seen).length ?? 0
  function setTab(next: Tab) {
    setTabState(next)
    if (next === 'reviews') onOpenReviews?.()
  }
  const { case: c, team, world, materials, witnesses, tasks } = workspace
  const initialFile = materials.find((m) => m.initial)
  const byCategory = FILE_CATEGORIES.map((category) => ({
    category,
    files: materials.filter((m) => fileCategory(m.contentType) === category),
  })).filter((g) => g.files.length > 0)
  const openTasks = tasks.filter((t) => !t.completedAt)
  // Only a team member can tick tasks, and only while the case is running.
  const canToggle = Boolean(onToggleTask && team && c.status === 'active')

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'case-file', label: 'Case file', count: materials.length },
    { id: 'witnesses', label: 'Witnesses', count: witnesses.length },
    { id: 'investigator', label: 'Investigator' },
    { id: 'tasks', label: 'Tasks', count: openTasks.length },
    ...(reviews ? [{ id: 'reviews' as const, label: 'Reviews', count: unseen }] : []),
  ]

  return (
    <div className="cw">
      <header className="cw-header">
        <span className="ws-case-emblem cw-emblem" aria-hidden="true">
          {caseInitials(c.title)}
        </span>
        <div>
          <div className="cw-tags">
            <StatusPill status={c.status} />
            <span className="cw-chip">{PHASE_LABEL[c.phase]} phase</span>
            {world && <span className="cw-chip">Case world {worldLabel(world.number)}</span>}
          </div>
          <h1 className="cw-title">{c.title}</h1>
          <p className="cw-subtitle">{assignmentLine(workspace)}</p>
        </div>
      </header>

      {unseen > 0 && tab !== 'reviews' && <NewResultsBanner onOpen={() => setTab('reviews')} />}

      <div className="cw-tabs" role="tablist" aria-label="Case sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`cw-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`cw-panel-${t.id}`}
            aria-label={t.count ? `${t.label}, ${t.count}` : t.label}
            className="cw-tab"
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && <span className="cw-tab-count">{t.count}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`cw-panel-${tab}`} aria-labelledby={`cw-tab-${tab}`} className="cw-panel">
        {tab === 'overview' && (
          <div className="cw-overview">
            <div className="cw-main">
              <ProgressBanner workspace={workspace} />

              <section className="cw-card" aria-labelledby="cw-start-here">
                <span className="ws-eyebrow">Start here</span>
                <h2 id="cw-start-here">Case background</h2>
                {initialFile ? (
                  <>
                    <p className="cw-summary">
                      Every team begins with this file. Read it first, then ask your instructor for the
                      evidence you need as you build your case.
                    </p>
                    <ul className="cw-files">
                      <li>
                        <MaterialLink material={initialFile} href={downloadUrl(initialFile.id)} now={now} />
                      </li>
                    </ul>
                  </>
                ) : (
                  <p className="cw-empty">The case background hasn&rsquo;t been posted yet.</p>
                )}
              </section>

              <section aria-labelledby="cw-workbench">
                <h2 id="cw-workbench" className="cw-section-title">
                  Case workbench
                </h2>
                <p className="cw-section-sub">Explore the case file and witnesses, and work through your tasks.</p>
                <ul className="cw-workbench">
                  <WorkbenchRow
                    icon={<FileText />}
                    tone="blue"
                    title="Case file"
                    detail={caseFileSummary(byCategory)}
                    onOpen={() => setTab('case-file')}
                  />
                  <WorkbenchRow
                    icon={<Users />}
                    tone="amber"
                    title="Witnesses"
                    detail={count(witnesses.length, 'person', 'people')}
                    onOpen={() => setTab('witnesses')}
                  />
                  <WorkbenchRow
                    icon={<ClipboardList />}
                    tone="rose"
                    title="Tasks"
                    detail={tasks.length === 0 ? 'None yet' : `${openTasks.length} of ${tasks.length} open`}
                    onOpen={() => setTab('tasks')}
                  />
                </ul>
              </section>
            </div>

            <aside className="cw-side">
              <NextTask
                task={openTasks[0]}
                hasTasks={tasks.length > 0}
                canToggle={canToggle}
                onToggleTask={onToggleTask}
                onViewAll={() => setTab('tasks')}
                now={now}
              />
              <CaseTeam workspace={workspace} />
              {c.instructorNote && (
                <section className="cw-note" aria-labelledby="cw-note">
                  <span id="cw-note" className="cw-note-label">
                    Instructor note
                  </span>
                  <blockquote>{c.instructorNote}</blockquote>
                  {instructorName && (
                    <span className="cw-note-by">
                      <Avatar name={instructorName} src={instructorAvatarUrl} size="sm" />
                      {instructorName}
                    </span>
                  )}
                </section>
              )}
            </aside>
          </div>
        )}

        {tab === 'case-file' && (
          <section className="cw-card" aria-labelledby="cw-list-title">
            <span className="ws-eyebrow">Case workspace</span>
            <h2 id="cw-list-title">Case file</h2>
            <p className="cw-section-sub">
              The case background, and the evidence in {c.title} your instructor has given your team. Ask
              your instructor for anything else you need.
            </p>
            {byCategory.length === 0 ? (
              <p className="cw-empty">The case file hasn&rsquo;t been posted yet.</p>
            ) : (
              byCategory.map((g) => (
                <section key={g.category} className="cw-group" aria-labelledby={`cw-group-${g.category}`}>
                  <h3 id={`cw-group-${g.category}`}>
                    {CATEGORY_HEADING[g.category]} <span>{g.files.length}</span>
                  </h3>
                  <ul className="cw-list">
                    {g.files.map((m) => (
                      <li key={m.id}>
                        <MaterialLink material={m} href={downloadUrl(m.id)} now={now} row />
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </section>
        )}

        {tab === 'witnesses' && (
          <ListPanel
            title="Witnesses"
            sub={
              c.phase === 'deposition'
                ? `People in ${c.title}. Interview your side's AI witnesses with your partner, and depose the other side's.`
                : `People in ${c.title}. Interview your side's AI witnesses with your partner. The other side's witnesses are revealed in the deposition phase.`
            }
            empty="No witnesses have been added yet."
          >
            {witnesses.map((w) => {
              // A witness for the other side: shown only once the deposition phase reveals them.
              const theirs = Boolean(workspace.side && w.side && w.side !== workspace.side)
              const action = theirs ? 'Depose' : 'Interview'
              return (
              <li key={w.id} className="cw-row">
                <WitnessAvatar src={w.avatarUrl} />
                <div className="cw-row-body">
                  <strong>{w.name}</strong>
                  {w.role && <small>{w.role}</small>}
                  {w.description && <p>{w.description}</p>}
                </div>
                {theirs && <span className="cw-badge cw-badge-theirs">{WITNESS_FOR[w.side!]}</span>}
                {w.audience !== 'all' && <span className="cw-badge">{AUDIENCE_LABEL[w.audience]}</span>}
                {w.canInterview &&
                  (interviewHref ? (
                    <Link to={interviewHref(w.id)} className="cw-interview" aria-label={`${action} ${w.name}`}>
                      <MessageSquare aria-hidden="true" />
                      {action}
                    </Link>
                  ) : (
                    // The instructor's preview: shown as the team sees it, but nothing opens.
                    <span className="cw-interview cw-interview-off" aria-disabled="true">
                      <MessageSquare aria-hidden="true" />
                      {action}
                    </span>
                  ))}
              </li>
              )
            })}
          </ListPanel>
        )}

        {tab === 'investigator' && <InvestigatorPanel available={workspace.investigatorAvailable} />}

        {tab === 'reviews' && reviews && <ReviewsPanel reviews={reviews} />}

        {tab === 'tasks' && (
          <ListPanel title="Tasks" sub={`Everything assigned in ${c.title}.`} empty="No tasks have been assigned yet.">
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} canToggle={canToggle} onToggleTask={onToggleTask} now={now} />
            ))}
          </ListPanel>
        )}
      </div>
    </div>
  )
}

/** The instructor's rulings on new facts from the team's interviews: what stands and what doesn't. */
function ReviewsPanel({ reviews }: { reviews: ReviewResult[] }) {
  return (
    <section className="cw-card" aria-labelledby="cw-reviews-title">
      <span className="ws-eyebrow">Case workspace</span>
      <h2 id="cw-reviews-title">Reviews</h2>
      <p className="cw-section-sub">
        When your team ends an interview, your instructor rules on any new facts the witness added. Rely on the
        accepted facts; don&rsquo;t rely on the denied ones.
      </p>
      {reviews.length === 0 ? (
        <p className="cw-empty">No reviewed interviews yet. End an interview to send it for review.</p>
      ) : (
        <ul className="cw-reviews">
          {reviews.map((r) => (
            <li key={r.id} aria-label={`Review of ${r.witness.name}`}>
              <div className="cw-review-head">
                <strong>Interview of {r.witness.name}</strong>
                {!r.seen && <span className="cw-badge cw-badge-new">New</span>}
                <small>Reviewed {shortDate(r.completedAt)}</small>
              </div>
              {r.accepted.length === 0 && r.denied.length === 0 ? (
                <p className="cw-empty">No new facts: the witness kept to the record.</p>
              ) : (
                <div className="cw-review-lists">
                  <FactList title="Accepted" tone="accepted" facts={r.accepted} />
                  <FactList title="Denied" tone="denied" facts={r.denied} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function FactList({ title, tone, facts }: { title: string; tone: 'accepted' | 'denied'; facts: string[] }) {
  if (facts.length === 0) return null
  return (
    <div className={`cw-fact-list cw-fact-list-${tone}`}>
      <h3>
        {title} ({facts.length})
      </h3>
      <ul aria-label={title}>
        {facts.map((f, i) => (
          <li key={i}>{f}</li>
        ))}
      </ul>
    </div>
  )
}

/** Shown above the tabs while the team has review results it hasn't opened. */
function NewResultsBanner({ onOpen }: { onOpen(): void }) {
  return (
    <div className="ws-notice cw-new-results" role="status">
      <Gavel aria-hidden="true" />
      <p>
        <strong>New review results.</strong> Your instructor ruled on facts from your interviews.
      </p>
      <button type="button" className="ws-btn ws-btn-primary" onClick={onOpen}>
        See results
      </button>
    </div>
  )
}

function count(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`
}

/** "2 documents · 3 images · 1 audio" */
function caseFileSummary(groups: { category: FileCategory; files: unknown[] }[]) {
  if (groups.length === 0) return 'No files yet'
  return groups
    .map((g) =>
      count(g.files.length, CATEGORY_LABEL[g.category].toLowerCase(), CATEGORY_HEADING[g.category].toLowerCase()),
    )
    .join(' · ')
}

/** "Role: Defendant · Team 2", or where the student is in getting assigned. */
function assignmentLine({ team, world, side, preview }: CaseWorkspace) {
  if (world) return `Role: ${ROLE_LABEL[world.side]} · Team ${team!.number}`
  if (team) return `Team ${team.number} · Case world not assigned yet`
  if (preview && side) return `Previewing as any ${side} team`
  return 'Not on a team yet'
}

function StatusPill({ status }: { status: CaseWorkspace['case']['status'] }) {
  const label = status === 'active' ? 'Active case' : status === 'closed' ? 'Closed case' : 'Draft'
  const tone = status === 'draft' ? 'in-review' : status
  return (
    <span className={`ws-status ws-status-${tone}`}>
      <i aria-hidden="true" />
      {label}
    </span>
  )
}

function ProgressBanner({ workspace }: { workspace: CaseWorkspace }) {
  const { case: c, tasks } = workspace
  const done = tasks.filter((t) => t.completedAt).length
  const percent = tasks.length === 0 ? 0 : Math.round((done / tasks.length) * 100)
  const heading =
    c.status === 'draft' ? 'Not launched yet' : c.status === 'closed' ? 'Case closed' : 'Case in progress'
  const text =
    c.status === 'draft'
      ? 'Students see this once the instructor launches the case worlds.'
      : c.status === 'closed'
        ? 'This case is finished. Its material stays here for reference.'
        : 'Start with the case background, review the witnesses, and work through the tasks with your partner.'
  return (
    <section className="cw-banner" aria-label="Case progress">
      <span className="cw-banner-eyebrow">Current phase</span>
      <h2>{heading}</h2>
      <p>{text}</p>
      <div className="cw-banner-progress">
        <span>Overall progress</span>
        <strong>{percent}%</strong>
      </div>
      <div
        className="cw-banner-bar"
        role="progressbar"
        aria-label="Tasks complete"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <small>{tasks.length === 0 ? 'No tasks assigned yet' : `${done} of ${tasks.length} tasks complete`}</small>
    </section>
  )
}

function MaterialLink({
  material: m,
  href,
  now,
  row = false,
}: {
  material: CaseMaterial
  href: string
  now: Date
  row?: boolean
}) {
  const Icon = CATEGORY_ICON[fileCategory(m.contentType)]
  return (
    <a href={href} download className={row ? 'cw-row cw-row-link' : 'cw-file'}>
      <span className="ws-icon-tile ws-icon-tile-sm ws-tone-blue" aria-hidden="true">
        <Icon />
      </span>
      <span className="cw-row-body">
        <strong>{m.filename}</strong>
        <small>
          {fileTypeLabel(m.contentType)} · Added {shortDate(m.uploadedAt, now)} · {formatSize(m.sizeBytes)}
        </small>
        {m.description && <span className="cw-row-desc">{m.description}</span>}
      </span>
      {m.initial && row && <span className="cw-badge">Start here</span>}
      {m.audience !== 'all' && <span className="cw-badge">{AUDIENCE_LABEL[m.audience]}</span>}
      <Download className="cw-row-end" aria-hidden="true" />
    </a>
  )
}

function WorkbenchRow({
  icon,
  tone,
  title,
  detail,
  onOpen,
}: {
  icon: ReactNode
  tone: string
  title: string
  detail: string
  onOpen(): void
}) {
  return (
    <li>
      <button type="button" className="cw-row cw-row-link" onClick={onOpen}>
        <span className={`ws-icon-tile ws-icon-tile-sm ws-tone-${tone}`} aria-hidden="true">
          {icon}
        </span>
        <span className="cw-row-body">
          <strong>{title}</strong>
          <small>{detail}</small>
        </span>
        <ChevronRight className="cw-row-end" aria-hidden="true" />
      </button>
    </li>
  )
}

const WITNESS_FOR: Record<Side, string> = { plaintiff: "Plaintiff's witness", defense: "Defense's witness" }

/** The background investigator: locked until the investigate phase, and still being built after that. */
function InvestigatorPanel({ available }: { available: boolean }) {
  return (
    <section className="cw-card cw-investigator" aria-labelledby="cw-investigator-title">
      <span className="ws-eyebrow">Case workspace</span>
      <h2 id="cw-investigator-title">Background investigator</h2>
      <div className="cw-investigator-body">
        <span className="ws-icon-tile ws-tone-blue" aria-hidden="true">
          {available ? <Search /> : <Lock />}
        </span>
        <p>
          {available
            ? 'Your background investigator is on the way. Check back soon.'
            : 'Your background investigator becomes available in the investigate phase.'}
        </p>
      </div>
    </section>
  )
}

function ListPanel({
  title,
  sub,
  empty,
  children,
}: {
  title: string
  sub: string
  empty: string
  children: ReactNode[]
}) {
  return (
    <section className="cw-card" aria-labelledby="cw-list-title">
      <span className="ws-eyebrow">Case workspace</span>
      <h2 id="cw-list-title">{title}</h2>
      <p className="cw-section-sub">{sub}</p>
      {children.length === 0 ? <p className="cw-empty">{empty}</p> : <ul className="cw-list">{children}</ul>}
    </section>
  )
}

function isOverdue(task: WorkspaceTask, now: Date) {
  return !task.completedAt && task.dueAt !== null && new Date(task.dueAt) < now
}

function TaskRow({
  task: t,
  canToggle,
  onToggleTask,
  now,
}: {
  task: WorkspaceTask
  canToggle: boolean
  onToggleTask?(taskId: string, done: boolean): Promise<void>
  now: Date
}) {
  const [saving, setSaving] = useState(false)
  const done = Boolean(t.completedAt)
  const overdue = isOverdue(t, now)

  async function toggle() {
    setSaving(true)
    try {
      await onToggleTask!(t.id, !done)
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className={`cw-row ${done ? 'cw-task-done' : ''}`}>
      {canToggle ? (
        <button
          type="button"
          className="cw-check"
          role="checkbox"
          aria-checked={done}
          aria-label={`${t.title}: ${done ? 'mark as not done' : 'mark as done'}`}
          onClick={toggle}
          disabled={saving}
        >
          {done && <Check aria-hidden="true" />}
        </button>
      ) : (
        <span className={`cw-check cw-check-static ${done ? 'cw-check-on' : ''}`} aria-hidden="true">
          {done && <Check />}
        </span>
      )}
      <div className="cw-row-body">
        <strong>{t.title}</strong>
        <small className={overdue ? 'cw-overdue' : undefined}>
          {t.dueAt ? `Due ${dueLabel(t.dueAt, now)}` : 'No due date'}
          {done && t.completedBy && ` · Completed by ${t.completedBy}`}
        </small>
        {t.description && <p>{t.description}</p>}
      </div>
      {t.audience !== 'all' && <span className="cw-badge">{AUDIENCE_LABEL[t.audience]}</span>}
      <span className={`cw-badge ${done ? 'cw-badge-done' : overdue ? 'cw-badge-overdue' : ''}`}>
        {done ? 'Complete' : overdue ? 'Overdue' : 'To do'}
      </span>
    </li>
  )
}

function NextTask({
  task,
  hasTasks,
  canToggle,
  onToggleTask,
  onViewAll,
  now,
}: {
  task: WorkspaceTask | undefined
  hasTasks: boolean
  canToggle: boolean
  onToggleTask?(taskId: string, done: boolean): Promise<void>
  onViewAll(): void
  now: Date
}) {
  const [saving, setSaving] = useState(false)
  return (
    <section className="cw-card cw-next" aria-labelledby="cw-next-task">
      <span id="cw-next-task" className="ws-eyebrow">
        Next task
      </span>
      {!task ? (
        <p className="cw-empty">{hasTasks ? 'All tasks are complete.' : 'No tasks have been assigned yet.'}</p>
      ) : (
        <>
          <h3>{task.title}</h3>
          {task.description && <p className="cw-next-desc">{task.description}</p>}
          <p className={`cw-next-due ${isOverdue(task, now) ? 'cw-overdue' : ''}`}>
            <CalendarClock aria-hidden="true" />
            {task.dueAt ? `Due ${dueLabel(task.dueAt, now)}` : 'No due date'}
          </p>
          {canToggle ? (
            <button
              type="button"
              className="ws-btn ws-btn-primary cw-next-btn"
              disabled={saving}
              onClick={async () => {
                setSaving(true)
                try {
                  await onToggleTask!(task.id, true)
                } finally {
                  setSaving(false)
                }
              }}
            >
              Mark complete
              <Check aria-hidden="true" />
            </button>
          ) : (
            <button type="button" className="ws-btn ws-btn-secondary cw-next-btn" onClick={onViewAll}>
              View all tasks
              <ArrowRight aria-hidden="true" />
            </button>
          )}
        </>
      )}
    </section>
  )
}

/** The student's own team and side, and (once matched) the opposing team in their case world. */
function CaseTeam({ workspace: { team, world } }: { workspace: CaseWorkspace }) {
  return (
    <section className="cw-card" aria-labelledby="cw-team">
      <h2 id="cw-team" className="cw-card-title">
        Your team
      </h2>
      <p className="cw-section-sub">
        {!team
          ? 'Not on a team yet.'
          : world
            ? `${ROLE_LABEL[world.side]} · Team ${team.number}`
            : `Team ${team.number} · Waiting for a case world`}
      </p>
      {team && <People members={team.members} role={world ? COUNSEL[world.side] : 'Teammate'} />}

      {team && (
        <div className="cw-opponents">
          <h3 id="cw-opponents" className="cw-team-heading">
            Opposing team
          </h3>
          {world ? (
            <>
              <p className="cw-section-sub">
                {ROLE_LABEL[other(world.side)]} · Team {world.opponents.number}
              </p>
              <People members={world.opponents.members} role={COUNSEL[other(world.side)]} />
            </>
          ) : (
            <p className="cw-section-sub">Your opponents appear once your team is matched.</p>
          )}
        </div>
      )}
    </section>
  )
}

function People({ members, role }: { members: MyTeamMember[]; role: string }) {
  return (
    <ul className="cw-people">
      {members.map((m) => (
        <li key={m.email}>
          <Avatar name={displayName(m)} src={m.avatarUrl} size="sm" />
          <span className="cw-person-text">
            <strong>
              {displayName(m)}
              {m.you && <span className="cw-you"> (you)</span>}
            </strong>
            <small>{role}</small>
          </span>
        </li>
      ))}
    </ul>
  )
}
