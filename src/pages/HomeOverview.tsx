import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { CheckCircle2, ChevronRight, ClipboardList, Gavel, Inbox } from 'lucide-react'
import { PhaseSteps } from '../components/PhaseSteps'
import { useCourseService } from '../courses/CourseServiceContext'
import { PHASE_LABEL, shortDate } from '../courses/caseLabels'
import type { HomeOverview as Overview, HomeTodo } from '../courses/types'
import { ROLE_LABEL } from '../courses/worldLabel'
import '../components/CourseGrid.css'
import './HomeOverview.css'

/** Where a to-do item leads: the review queue, or the right tab of the student's case. */
function todoPath(t: HomeTodo) {
  if (t.kind === 'review') return `/courses/${t.courseId}/review`
  const tab = t.kind === 'task' ? 'tasks' : 'exchange'
  return `/courses/${t.courseId}/cases/${t.caseId}?tab=${tab}`
}

const TODO_ICON = { review: Gavel, task: ClipboardList, respond: Inbox, response: Inbox }

function todoWhen(t: HomeTodo) {
  if (!t.at) return null
  if (t.kind === 'task' || t.kind === 'respond') return `Due ${shortDate(t.at)}`
  return shortDate(t.at)
}

/**
 * The top of the main dashboard: the user's active cases across courses, and
 * a short list of what to do next (the instructor's reviews, or a student's
 * tasks and discovery) with how many there are in all.
 */
export function HomeOverview({ role }: { role: 'instructor' | 'student' }) {
  const service = useCourseService()
  const [overview, setOverview] = useState<Overview | null>(null)

  useEffect(() => {
    let cancelled = false
    service
      .getHomeOverview()
      .then((o) => !cancelled && setOverview(o))
      .catch(() => {}) // the courses below still work without it
    return () => {
      cancelled = true
    }
  }, [service])

  if (!overview) return null
  const instructor = role === 'instructor'
  const { count, latest } = overview.todos

  return (
    <div className="home-overview">
      <section className="home-todos" aria-labelledby="home-todos-title">
        <header>
          <h2 id="home-todos-title">{instructor ? 'To review' : 'To do'}</h2>
          {count > 0 && <span className="home-count">{count}</span>}
        </header>
        {count === 0 ? (
          <p className="home-uptodate">
            <CheckCircle2 aria-hidden="true" />
            You&rsquo;re all up to date.
          </p>
        ) : (
          <>
            <ul>
              {latest.map((t) => {
                const Icon = TODO_ICON[t.kind]
                const when = todoWhen(t)
                return (
                  <li key={`${t.kind}-${t.id}`}>
                    <Link to={todoPath(t)} className={`home-todo home-todo-${t.kind}`}>
                      <Icon aria-hidden="true" />
                      <span>
                        <strong>{t.title}</strong>
                        <small>
                          {t.detail}
                          {when && ` · ${when}`}
                        </small>
                      </span>
                      <ChevronRight aria-hidden="true" />
                    </Link>
                  </li>
                )
              })}
            </ul>
            {count > latest.length && (
              <p className="home-more">
                {count - latest.length} more {instructor ? 'in your review queues' : 'in your cases'}
              </p>
            )}
          </>
        )}
      </section>

      <section className="home-cases" aria-labelledby="home-cases-title">
        <h2 id="home-cases-title">Active cases</h2>
        {overview.activeCases.length === 0 ? (
          <p className="muted">
            {instructor ? 'Launch a case in one of your courses to see it here.' : "You're not on a team in an active case yet."}
          </p>
        ) : (
          <ul className="course-grid">
            {overview.activeCases.map((c) => (
              <li key={c.id}>
                <Link to={`/courses/${c.courseId}/cases/${c.id}`} className="course-card home-case-card" aria-label={c.title}>
                  <span className="course-code">{c.courseCode}</span>
                  <span className="course-title">{c.title}</span>
                  <span className="home-case-phase">{PHASE_LABEL[c.phase]} phase</span>
                  <PhaseSteps phase={c.phase} phases={c.phases} />
                  <span className="course-meta">
                    {instructor
                      ? `${c.worldCount ?? 0} case ${c.worldCount === 1 ? 'world' : 'worlds'} · ${c.teamCount ?? 0} teams`
                      : `${c.side ? ROLE_LABEL[c.side] : 'Side not set yet'} · Team ${c.teamNumber}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
