import { useEffect, useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router'
import { useCourseService } from '../../courses/CourseServiceContext'
import { caseOverview } from '../../courses/caseLabels'
import type { CourseCase } from '../../courses/types'
import type { WorkspaceContext } from '../../workspace/useWorkspace'
import { CaseForm } from './CaseForm'
import { CaseStatusBadge } from './CaseStatusBadge'
import '../CoursePage.css'
import './Cases.css'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** The instructor's "All cases" tab: every case in the course, and creating new ones. */
export function CasesPage() {
  const { courseId = '' } = useParams()
  const service = useCourseService()
  const workspace = useOutletContext<WorkspaceContext | undefined>()
  const search = workspace?.search ?? ''
  const navigate = useNavigate()
  const [cases, setCases] = useState<CourseCase[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let cancelled = false
    setCases(null)
    setLoadError(null)
    service
      .listCases(courseId)
      .then((list) => !cancelled && setCases(list))
      .catch((err: Error) => !cancelled && setLoadError(err.message))
    return () => {
      cancelled = true
    }
  }, [service, courseId])

  const casePath = (id: string) => `/courses/${courseId}/cases/${id}${search}`

  return (
    <main className="page">
      <header className="course-header">
        <div>
          {workspace && <span className="ws-eyebrow">{workspace.home.course.code}</span>}
          <h1>All cases</h1>
          <p className="muted">
            Each case is shared by the whole class. Students are paired into teams per case.
          </p>
        </div>
        {!creating && (
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            New case
          </button>
        )}
      </header>

      {creating && (
        <CaseForm
          label="New case"
          submitLabel="Create case"
          submittingLabel="Creating…"
          onSubmit={async (input) => {
            const created = await service.createCase(courseId, input)
            navigate(casePath(created.id))
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {loadError ? (
        <p className="form-error" role="alert">
          Could not load the cases. {loadError}
        </p>
      ) : cases === null ? (
        <p className="muted">Loading cases…</p>
      ) : cases.length === 0 ? (
        !creating && <p className="muted">No cases yet. Create one to start pairing students.</p>
      ) : (
        <ul className="case-list" aria-label="Cases">
          {cases.map((c) => (
            <li key={c.id}>
              <Link to={casePath(c.id)} className="case-row">
                <div className="case-row-heading">
                  <h2>{c.title}</h2>
                  <CaseStatusBadge status={c.status} />
                </div>
                {c.summary && <p className="case-row-summary">{caseOverview(c.summary)}</p>}
                <small className="muted">Created {formatDate(c.createdAt)}</small>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
