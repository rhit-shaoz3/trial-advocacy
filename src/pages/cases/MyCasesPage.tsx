import { useEffect, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router'
import { useCourseService } from '../../courses/CourseServiceContext'
import type { MyCase, MyTeamMember } from '../../courses/types'
import { sideLabel, worldLabel } from '../../courses/worldLabel'
import type { WorkspaceContext } from '../../workspace/useWorkspace'
import { CaseStatusBadge } from './CaseStatusBadge'
import '../CoursePage.css'
import './Cases.css'

const names = (members: MyTeamMember[]) => members.map((m) => m.name ?? m.email).join(' and ')

/** The student's pairing, role, case world, and opposition in one case. */
function Assignment({ team, world, parties }: Pick<MyCase, 'team' | 'world' | 'parties'>) {
  const rows: [string, string][] = !team
    ? [['Pairing', 'Not assigned yet']]
    : world
      ? [
          ['Pairing', names(team.members)],
          ['Role', sideLabel(world.side, parties)],
          ['Case world', worldLabel(world.number)],
          ['Opposition', names(world.opponents.members)],
        ]
      : [
          ['Pairing', names(team.members)],
          ['Case world', 'Not assigned yet'],
        ]
  return (
    <dl className="my-case-assignment">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd className={value === 'Not assigned yet' ? 'muted' : undefined}>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * The student's "My cases" tab: the course's open and finished cases, with
 * their team and case world in each.
 */
export function MyCasesPage() {
  const { courseId = '' } = useParams()
  const service = useCourseService()
  const workspace = useOutletContext<WorkspaceContext | undefined>()
  const [cases, setCases] = useState<MyCase[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    service
      .listMyCases(courseId)
      .then((list) => !cancelled && setCases(list))
      .catch((err: Error) => !cancelled && setLoadError(err.message))
    return () => {
      cancelled = true
    }
  }, [service, courseId])

  return (
    <main className="page">
      <header className="course-header">
        <div>
          {workspace && <span className="ws-eyebrow">{workspace.home.course.code}</span>}
          <h1>My cases</h1>
          <p className="muted">Your instructor pairs you with a partner for each case.</p>
        </div>
      </header>

      {loadError ? (
        <p className="form-error" role="alert">
          Could not load your cases. {loadError}
        </p>
      ) : cases === null ? (
        <p className="muted">Loading cases…</p>
      ) : cases.length === 0 ? (
        <p className="muted">No cases yet. They appear here once your instructor opens one.</p>
      ) : (
        <ul className="case-list" aria-label="Cases">
          {cases.map((c) => (
            <li key={c.id} aria-label={c.title}>
              {/* The same case page the dashboard's "Enter case" opens. */}
              <Link
                to={`/courses/${courseId}/cases/${c.id}${workspace?.search ?? ''}`}
                className="case-row"
              >
                <div className="case-row-heading">
                  <h2>{c.title}</h2>
                  <CaseStatusBadge status={c.status} />
                </div>
                <Assignment team={c.team} world={c.world} parties={c.parties} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
