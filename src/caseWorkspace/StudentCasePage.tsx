import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Link, useOutletContext, useParams } from 'react-router'
import { useCourseService } from '../courses/CourseServiceContext'
import type { CaseWorkspace, ReviewResult } from '../courses/types'
import type { WorkspaceContext } from '../workspace/useWorkspace'
import { CaseWorkspaceView } from './CaseWorkspaceView'

/** A student's dashboard for one case, opened from "Enter case" or My cases. */
export function StudentCasePage() {
  const { courseId = '', caseId = '' } = useParams()
  const service = useCourseService()
  const workspace = useOutletContext<WorkspaceContext | undefined>()
  const [data, setData] = useState<CaseWorkspace | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reviews, setReviews] = useState<ReviewResult[] | undefined>(undefined)
  const myCasesPath = `/courses/${courseId}/cases${workspace?.search ?? ''}`

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    service
      .getMyCaseWorkspace(courseId, caseId)
      .then((w) => !cancelled && setData(w))
      .catch((err: Error) => !cancelled && setError(err.message))
    service
      .listMyReviews(courseId, caseId)
      .then((r) => !cancelled && setReviews(r))
      .catch(() => {}) // the case still works without its review results
    return () => {
      cancelled = true
    }
  }, [service, courseId, caseId])

  async function toggleTask(taskId: string, done: boolean) {
    try {
      setData(await service.setTaskDone(courseId, caseId, taskId, done))
      setError(null)
      workspace?.reloadHome()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  /** Opening the Reviews tab marks the results read, here and in the course notice. */
  function openReviews() {
    if (!reviews?.some((r) => !r.seen)) return
    setReviews((prev) => prev?.map((r) => ({ ...r, seen: true })))
    service
      .markReviewsSeen(courseId, caseId)
      .then(() => workspace?.reloadHome())
      .catch(() => {})
  }

  return (
    <main className="ws-page">
      <nav className="cw-breadcrumb" aria-label="Breadcrumb">
        <Link to={myCasesPath}>My cases</Link>
        <ChevronRight aria-hidden="true" />
        <span aria-current="page">{data?.case.title ?? 'Case'}</span>
      </nav>
      {error && !data ? (
        <>
          <h1 className="ws-title">{error === 'Case not found.' ? 'Case not found' : 'Something went wrong'}</h1>
          <p className="ws-subtle">
            {error === 'Case not found.'
              ? 'This case does not exist, or it has not been opened to students yet.'
              : `Could not load this case. ${error}`}
          </p>
        </>
      ) : !data ? (
        <p className="ws-subtle">Loading case…</p>
      ) : (
        <>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <CaseWorkspaceView
            workspace={data}
            downloadUrl={(id) => service.myMaterialDownloadUrl(courseId, caseId, id)}
            onToggleTask={toggleTask}
            interviewHref={(id) => `/courses/${courseId}/cases/${caseId}/witnesses/${id}${workspace?.search ?? ''}`}
            instructorName={workspace?.home.course.instructorName}
            instructorAvatarUrl={workspace?.home.course.instructorAvatarUrl}
            reviews={reviews ?? []}
            onOpenReviews={openReviews}
          />
        </>
      )}
    </main>
  )
}
