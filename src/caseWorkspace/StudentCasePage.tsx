import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Link, useOutletContext, useParams, useSearchParams } from 'react-router'
import { useCourseService } from '../courses/CourseServiceContext'
import type {
  CaseWorkspace,
  DisclosurePick,
  ExchangeKind,
  Investigation,
  ItemResponse,
  ReviewResult,
  StudentExchange,
} from '../courses/types'
import type { WorkspaceContext } from '../workspace/useWorkspace'
import { caseTab } from './caseTabs'
import { CaseWorkspaceView } from './CaseWorkspaceView'

/** How often the page checks for an investigator report while one is on its way. */
const INVESTIGATION_POLL_MS = 20000

/** A student's dashboard for one case, opened from "Enter case" or My cases. */
export function StudentCasePage() {
  const { courseId = '', caseId = '' } = useParams()
  const service = useCourseService()
  const workspace = useOutletContext<WorkspaceContext | undefined>()
  // A notice can link straight to a tab: ?tab=investigator.
  const [params] = useSearchParams()
  const initialTab = caseTab(params.get('tab'))
  const [data, setData] = useState<CaseWorkspace | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reviews, setReviews] = useState<ReviewResult[] | undefined>(undefined)
  const [investigations, setInvestigations] = useState<Investigation[] | undefined>(undefined)
  const [exchange, setExchange] = useState<StudentExchange | null>(null)
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
    service
      .listMyInvestigations(courseId, caseId)
      .then((i) => !cancelled && setInvestigations(i))
      .catch(() => {}) // nor its investigator reports
    setExchange(null)
    service
      .getMyExchange(courseId, caseId)
      .then((e) => !cancelled && setExchange(e))
      .catch(() => {}) // nor its information exchange
    return () => {
      cancelled = true
    }
  }, [service, courseId, caseId])

  /** The exchange's own tasks (initial disclosures, responding) complete with it, so the dashboard reloads too. */
  async function afterExchange(next: StudentExchange) {
    setExchange(next)
    service.getMyCaseWorkspace(courseId, caseId).then(setData, () => {})
    workspace?.reloadHome()
  }

  async function submitDisclosures(picks: DisclosurePick[], heldBackReason: string) {
    await afterExchange(await service.submitDisclosures(courseId, caseId, picks, heldBackReason))
  }

  async function sendRequest(kind: ExchangeKind, items: string[]) {
    setExchange(await service.sendExchangeRequest(courseId, caseId, kind, items))
  }

  async function respondToRequest(requestId: string, responses: ItemResponse[]) {
    await afterExchange(await service.respondToExchangeRequest(courseId, caseId, requestId, responses))
  }

  /** Opening the Information exchange tab marks the other team's responses read. */
  function openExchange() {
    setExchange((prev) =>
      prev && {
        ...prev,
        interrogatories: prev.interrogatories && {
          ...prev.interrogatories,
          requests: prev.interrogatories.requests.map((r) => ({ ...r, seen: true })),
        },
        rfas: prev.rfas && { ...prev.rfas, requests: prev.rfas.requests.map((r) => ({ ...r, seen: true })) },
      },
    )
    service.markExchangeSeen(courseId, caseId).catch(() => {})
  }

  // While a request is with the investigator or the instructor, check back for the report.
  const waiting = investigations?.some((i) => i.status === 'working') ?? false
  const reloadHome = workspace?.reloadHome
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => {
      service
        .listMyInvestigations(courseId, caseId)
        .then((next) => {
          setInvestigations(next)
          // The report may have unlocked files, and the course notice counts it.
          if (!next.some((i) => i.status === 'working')) {
            service.getMyCaseWorkspace(courseId, caseId).then(setData, () => {})
            reloadHome?.()
          }
        })
        .catch(() => {})
    }, INVESTIGATION_POLL_MS)
    return () => clearInterval(timer)
  }, [service, courseId, caseId, waiting, reloadHome])

  async function sendInvestigation(assignment: string) {
    setInvestigations(await service.sendInvestigation(courseId, caseId, assignment))
  }

  /** Opening the investigator (or a report) marks his reports read, here and in the course notice. */
  function openInvestigator() {
    if (!investigations?.some((i) => i.status === 'completed' && !i.seen)) return
    setInvestigations((prev) => prev?.map((i) => (i.status === 'completed' ? { ...i, seen: true } : i)))
    service
      .markInvestigationsSeen(courseId, caseId)
      .then(() => workspace?.reloadHome())
      .catch(() => {})
  }

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
            investigations={investigations ?? []}
            onSendInvestigation={sendInvestigation}
            onOpenInvestigator={openInvestigator}
            exchange={exchange}
            onSubmitDisclosures={submitDisclosures}
            onSendRequest={sendRequest}
            onRespondToRequest={respondToRequest}
            onOpenExchange={openExchange}
            initialTab={initialTab}
          />
        </>
      )}
    </main>
  )
}
