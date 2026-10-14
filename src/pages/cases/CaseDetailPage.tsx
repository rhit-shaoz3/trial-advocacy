import { useEffect, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router'
import { useCourseService } from '../../courses/CourseServiceContext'
import type { CourseCase } from '../../courses/types'
import type { WorkspaceContext } from '../../workspace/useWorkspace'
import { NotFoundPage } from '../NotFoundPage'
import { CaseForm } from './CaseForm'
import { CaseStatusBadge } from './CaseStatusBadge'
import { STATUS_HINT } from './caseStatus'
import { TeamsSection } from './TeamsSection'
import '../CoursePage.css'
import './Cases.css'

/** One case, as its instructor manages it: details, teams, and case worlds. */
export function CaseDetailPage() {
  const { courseId = '', caseId = '' } = useParams()
  const service = useCourseService()
  const workspace = useOutletContext<WorkspaceContext | undefined>()
  const allCasesPath = `/courses/${courseId}/cases${workspace?.search ?? ''}`
  const navigate = useNavigate()
  const [courseCase, setCourseCase] = useState<CourseCase | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setCourseCase(null)
    setLoadError(null)
    service
      .getCase(courseId, caseId)
      .then((c) => !cancelled && setCourseCase(c))
      .catch((err: Error) => !cancelled && setLoadError(err.message))
    return () => {
      cancelled = true
    }
  }, [service, courseId, caseId])

  async function handleDelete() {
    if (!courseCase) return
    const confirmed = window.confirm(`Delete ${courseCase.title}? This cannot be undone.`)
    if (!confirmed) return
    setDeleteError(null)
    setDeleting(true)
    try {
      await service.deleteCase(courseId, courseCase.id)
      workspace?.reloadHome()
      navigate(allCasesPath)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Something went wrong.')
      setDeleting(false)
    }
  }

  if (loadError === 'Case not found.' || loadError === 'Course not found.') {
    return <NotFoundPage message="That case does not exist, or you do not teach its course." />
  }

  return (
    <main className="page">
      <Link to={allCasesPath} className="case-back">
        <ChevronLeft aria-hidden="true" />
        All cases
      </Link>

      {loadError ? (
        <p className="form-error" role="alert">
          Could not load this case. {loadError}
        </p>
      ) : !courseCase ? (
        <p className="muted">Loading case…</p>
      ) : (
        <>
          {editing ? (
            <CaseForm
              initial={courseCase}
              label="Edit case"
              submitLabel="Save"
              submittingLabel="Saving…"
              onSubmit={async (input) => {
                setCourseCase(
                  await service.updateCase(courseId, courseCase.id, {
                    title: input.title,
                    summary: input.summary,
                    status: input.status ?? courseCase.status,
                  }),
                )
                setEditing(false)
                // The dashboard lists active and closed cases, so keep it current.
                workspace?.reloadHome()
              }}
              onCancel={() => {
                setEditing(false)
                setDeleteError(null)
              }}
            >
              <button
                type="button"
                className="btn-danger delete-course"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Delete case'}
              </button>
              {deleteError && (
                <p className="form-error" role="alert">
                  {deleteError}
                </p>
              )}
            </CaseForm>
          ) : (
            <header className="course-header case-header">
              <div>
                <span className="ws-eyebrow">Case</span>
                <h1>{courseCase.title}</h1>
                <p className="muted">
                  <CaseStatusBadge status={courseCase.status} /> {STATUS_HINT[courseCase.status]}
                  {' · '}
                  <button type="button" className="link-button" onClick={() => setEditing(true)}>
                    Edit case
                  </button>
                </p>
                {courseCase.summary && <p className="case-summary">{courseCase.summary}</p>}
              </div>
            </header>
          )}

          <TeamsSection
            courseId={courseId}
            caseId={courseCase.id}
            closed={courseCase.status === 'closed'}
            onChange={workspace?.reloadHome}
          />
        </>
      )}
    </main>
  )
}
