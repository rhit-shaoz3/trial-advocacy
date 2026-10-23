import { ChevronLeft } from 'lucide-react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router'
import type { WorkspaceContext } from '../../../workspace/useWorkspace'
import { CaseSetupFlow } from './CaseSetupFlow'
import '../../CoursePage.css'
import '../Cases.css'

/**
 * The guided setup's first step, before the case exists. Once the details
 * create it, the setup carries on at the case's own address (CaseDetailPage),
 * so a refresh or a later visit picks up where the instructor left off.
 */
export function NewCasePage() {
  const { courseId = '' } = useParams()
  const workspace = useOutletContext<WorkspaceContext | undefined>()
  const search = workspace?.search ?? ''
  const navigate = useNavigate()

  return (
    <main className="page">
      <Link to={`/courses/${courseId}/cases${search}`} className="case-back">
        <ChevronLeft aria-hidden="true" />
        All cases
      </Link>
      <CaseSetupFlow
        courseId={courseId}
        courseCase={null}
        onCaseChange={(created) =>
          navigate(`/courses/${courseId}/cases/${created.id}${search}`, { replace: true, state: { courseCase: created } })
        }
        onExit={() => {}}
      />
    </main>
  )
}
