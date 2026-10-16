import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Link, useOutletContext, useParams } from 'react-router'
import { useCourseService } from '../courses/CourseServiceContext'
import type { CaseWorkspace } from '../courses/types'
import type { WorkspaceContext } from '../workspace/useWorkspace'
import { CaseWorkspaceView } from './CaseWorkspaceView'

/** A student's dashboard for one case, opened from "Enter case" or My cases. */
export function StudentCasePage() {
  const { courseId = '', caseId = '' } = useParams()
  const service = useCourseService()
  const workspace = useOutletContext<WorkspaceContext | undefined>()
  const [data, setData] = useState<CaseWorkspace | null>(null)
  const [error, setError] = useState<string | null>(null)
  const myCasesPath = `/courses/${courseId}/cases${workspace?.search ?? ''}`

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    service
      .getMyCaseWorkspace(courseId, caseId)
      .then((w) => !cancelled && setData(w))
      .catch((err: Error) => !cancelled && setError(err.message))
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
          />
        </>
      )}
    </main>
  )
}
