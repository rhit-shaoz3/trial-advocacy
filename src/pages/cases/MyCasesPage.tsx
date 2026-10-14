import { useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router'
import { useCourseService } from '../../courses/CourseServiceContext'
import type { MyCase } from '../../courses/types'
import type { WorkspaceContext } from '../../workspace/useWorkspace'
import { CaseStatusBadge } from './CaseStatusBadge'
import '../CoursePage.css'
import './Cases.css'

function TeamLine({ team }: { team: MyCase['team'] }) {
  if (!team) return <p className="muted my-case-team">Not on a team yet.</p>
  const teammates = team.members.filter((m) => !m.you)
  return (
    <p className="my-case-team">
      <strong>Team {team.number}</strong>
      {teammates.length === 0
        ? ': you are working solo.'
        : `: you and ${teammates.map((m) => m.name ?? m.email).join(' and ')}`}
    </p>
  )
}

/** The student's "My cases" tab: the course's open and finished cases, with their team in each. */
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
            <li key={c.id} className="case-row" aria-label={c.title}>
              <div className="case-row-heading">
                <h2>{c.title}</h2>
                <CaseStatusBadge status={c.status} />
              </div>
              {c.summary && <p className="case-row-summary">{c.summary}</p>}
              <TeamLine team={c.team} />
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
