import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Link, useOutletContext, useParams, useSearchParams } from 'react-router'
import { fetchBytes } from '../components/redaction/redactFile'
import { useCourseService } from '../courses/CourseServiceContext'
import type {
  CaseWorkspace,
  DisclosurePick,
  DiscoveryDraft,
  DraftKind,
  ExchangeKind,
  ExhibitListItem,
  ExhibitMove,
  ExhibitVersion,
  Investigation,
  ItemResponse,
  PacketFolder,
  ReviewResult,
  StudentExchange,
  StudentExhibits,
  SubpoenaInput,
  TeamFlag,
} from '../courses/types'
import type { WorkspaceContext } from '../workspace/useWorkspace'
import { caseTab } from './caseTabs'
import { CaseWorkspaceView } from './CaseWorkspaceView'
import type { DraftActions } from './exchange/useDraft'
import { FlagsContext, type FlagsContextValue } from './flagsContext'
import { AuthContext } from '../auth/AuthContext'
import { usePageTour } from '../tour/tourContext'
import { phaseTourKey, pickCaseTour } from '../tour/tours'
import { introKey, pickIntro, type CaseIntro } from './intro/caseIntro'

/** How often the page checks for an investigator report while one is on its way. */
const INVESTIGATION_POLL_MS = 20000

/** The exchange with one kind of the team's drafts changed. */
function withDrafts(exchange: StudentExchange, kind: DraftKind, change: (drafts: DiscoveryDraft[]) => DiscoveryDraft[]): StudentExchange {
  if (kind === 'subpoena') return exchange.subpoenas ? { ...exchange, subpoenas: { ...exchange.subpoenas, drafts: change(exchange.subpoenas.drafts) } } : exchange
  const part = exchange[kind]
  return part ? { ...exchange, [kind]: { ...part, drafts: change(part.drafts) } } : exchange
}

/** A student's dashboard for one case, opened from "Enter case" or My cases. */
export function StudentCasePage() {
  const { courseId = '', caseId = '' } = useParams()
  const service = useCourseService()
  const workspace = useOutletContext<WorkspaceContext | undefined>()
  // A notice can link straight to a tab: ?tab=investigator.
  const [params, setParams] = useSearchParams()
  const initialTab = caseTab(params.get('tab'))
  // A draft open in the information exchange: ?tab=exchange&draft=…, so a refresh comes back to it.
  const [initialDraftId] = useState(() => params.get('draft') ?? undefined)
  const [data, setData] = useState<CaseWorkspace | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reviews, setReviews] = useState<ReviewResult[] | undefined>(undefined)
  const [investigations, setInvestigations] = useState<Investigation[] | undefined>(undefined)
  const [exchange, setExchange] = useState<StudentExchange | null>(null)
  /** Whether the exchange has loaded (it's null too when not set up), so a tour finds its tab. */
  const [exchangeLoaded, setExchangeLoaded] = useState(false)
  const [exhibits, setExhibits] = useState<StudentExhibits | null>(null)
  const [exhibitsLoaded, setExhibitsLoaded] = useState(false)
  const [flags, setFlags] = useState<TeamFlag[]>([])
  const flagsMarked = useRef(false)
  const myCasesPath = `/courses/${courseId}/cases${workspace?.search ?? ''}`
  // The case tour the first time in any case; after that, one per new phase.
  const auth = useContext(AuthContext)
  const user = auth?.user
  const phase = data?.case.phase
  const status = data?.case.status
  const caseSeen = Boolean(user?.toursSeen?.['student-case'])
  const phaseSeen = Boolean(phase && user?.toursSeen?.[phaseTourKey(caseId, phase)])
  // A phase with a welcome animation (played now or before) needs no "New phase!" step in its tour.
  const welcomed = Boolean(data && exchangeLoaded && pickIntro(data, exchange))
  const tours = useMemo(() => {
    if (!phase || !status) return null
    return pickCaseTour((key) => (key === 'student-case' ? caseSeen : phaseSeen), caseId, phase, status, welcomed)
  }, [caseId, phase, status, caseSeen, phaseSeen, welcomed])
  const loaded = Boolean(data) && exchangeLoaded && exhibitsLoaded

  // The phase's welcome (the case's launch, or a new phase) once each time the case enters a phase, before any tour.
  // Picked once per entry, and kept while it plays (marking it seen mustn't end it).
  const [intro, setIntro] = useState<{ key: string; intro: CaseIntro | null } | null>(null)
  const introKeyNow = phase ? introKey(caseId, phase, data?.case.phaseEnteredAt) : null
  if (loaded && introKeyNow && intro?.key !== introKeyNow && data) {
    const fresh = Boolean(user) && status === 'active' && !user?.toursSeen?.[introKeyNow]
    setIntro({ key: introKeyNow, intro: fresh ? pickIntro(data, exchange) : null })
  }
  const playing = intro?.intro ?? null
  useEffect(() => {
    if (playing && introKeyNow) void auth?.markTourSeen(introKeyNow)
  }, [playing, introKeyNow, auth])

  usePageTour(tours?.tour ?? null, { ready: loaded && intro !== null && !playing, startWith: tours?.startWith ?? null })

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
    service
      .listMyFlags(courseId, caseId)
      .then((f) => !cancelled && setFlags(f))
      .catch(() => {}) // nor its flags
    setExchange(null)
    setExchangeLoaded(false)
    service
      .getMyExchange(courseId, caseId)
      .then((e) => !cancelled && setExchange(e))
      .catch(() => {}) // nor its information exchange
      .finally(() => !cancelled && setExchangeLoaded(true))
    setExhibits(null)
    setExhibitsLoaded(false)
    service
      .getMyExhibits(courseId, caseId)
      .then((x) => !cancelled && setExhibits(x))
      .catch(() => {}) // nor its exhibit list
      .finally(() => !cancelled && setExhibitsLoaded(true))
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

  async function sendRequest(kind: ExchangeKind, items: string[], checkId?: string, draftId?: string) {
    setExchange(await service.sendExchangeRequest(courseId, caseId, kind, items, checkId, draftId))
  }

  async function respondToRequest(requestId: string, responses: ItemResponse[], checkId?: string) {
    await afterExchange(await service.respondToExchangeRequest(courseId, caseId, requestId, responses, checkId))
  }

  async function serveSubpoena(subpoena: SubpoenaInput, checkId?: string, draftId?: string) {
    setExchange(await service.serveSubpoena(courseId, caseId, subpoena, checkId, draftId))
  }

  /** Saving a draft updates the team's list of drafts here, without reloading the exchange. */
  const exchangeDrafts = useMemo<DraftActions>(
    () => ({
      async save(kind, id, content, lastCheck, options) {
        const draft = id
          ? await service.updateExchangeDraft(courseId, caseId, id, content, lastCheck, options)
          : await service.createExchangeDraft(courseId, caseId, kind, content, lastCheck)
        setExchange((prev) => prev && withDrafts(prev, draft.kind, (list) => [draft, ...list.filter((d) => d.id !== draft.id)]))
        return draft
      },
      async remove(id) {
        await service.deleteExchangeDraft(courseId, caseId, id)
        setExchange((prev) => prev && (['subpoena', 'interrogatories', 'rfas'] as const).reduce((e, k) => withDrafts(e, k, (list) => list.filter((d) => d.id !== id)), prev))
      },
    }),
    [service, courseId, caseId],
  )

  const openDraft = useCallback(
    (draftId: string | null) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (draftId) {
            next.set('tab', 'exchange')
            next.set('draft', draftId)
          } else {
            next.delete('draft')
            if (next.get('tab') === 'exchange') next.delete('tab')
          }
          return next
        },
        { replace: true },
      ),
    [setParams],
  )

  /** Opening the Information exchange tab marks the other team's responses, and subpoena answers, read. */
  function openExchange() {
    setExchange((prev) =>
      prev && {
        ...prev,
        subpoenas: prev.subpoenas && {
          ...prev.subpoenas,
          served: prev.subpoenas.served.map((s) => ({ ...s, seen: true })),
          notices: prev.subpoenas.notices.map((n) => ({ ...n, seen: true })),
        },
        interrogatories: prev.interrogatories && {
          ...prev.interrogatories,
          requests: prev.interrogatories.requests.map((r) => ({ ...r, seen: true })),
        },
        rfas: prev.rfas && { ...prev.rfas, requests: prev.rfas.requests.map((r) => ({ ...r, seen: true })) },
      },
    )
    service.markExchangeSeen(courseId, caseId).catch(() => {})
  }

  /** The joint exhibit list's actions; each returns the list as it now stands. */
  const packetActions = useMemo(
    () => ({
      load: () => service.getMyPacket(courseId, caseId),
      save: (folders: PacketFolder[]) => service.saveMyPacketFolders(courseId, caseId, folders),
      zipUrl: service.myPacketUrl(courseId, caseId),
      pdfUrl: service.myPacketPdfUrl(courseId, caseId),
    }),
    [service, courseId, caseId],
  )

  const exhibitActions = useMemo(
    () => ({
      async save(items: ExhibitListItem[]) {
        setExhibits(await service.saveExhibitList(courseId, caseId, items))
      },
      async submit(items: ExhibitListItem[]) {
        setExhibits(await service.submitExhibitList(courseId, caseId, items))
      },
      async move(exhibitId: string, move: ExhibitMove) {
        setExhibits(await service.moveExhibit(courseId, caseId, exhibitId, move))
      },
      fileUrl: (exhibitId: string, version?: ExhibitVersion) => service.myExhibitFileUrl(courseId, caseId, exhibitId, version),
      loadText: (exhibitId: string) => service.myExhibitText(courseId, caseId, exhibitId),
      copy: {
        loadFile: (materialId: string) => fetchBytes(service.myExhibitSourceUrl(courseId, caseId, materialId)),
        upload: (materialId: string, file: Blob) => service.uploadExhibitCopy(courseId, caseId, materialId, file),
      },
      proposal: {
        marking: (exhibitId: string) => service.getMyExhibitMarking(courseId, caseId, exhibitId),
        loadFile: (exhibitId: string) => fetchBytes(service.myExhibitBytesUrl(courseId, caseId, exhibitId)),
        upload: (exhibitId: string, file: Blob) => service.uploadProposedExhibit(courseId, caseId, exhibitId, file),
      },
    }),
    [service, courseId, caseId],
  )

  /** Opening the Final steps tab marks what changed in the exhibit list read. */
  const openExhibits = useCallback(() => {
    setExhibits((prev) => prev && { ...prev, notices: { exchanged: false, objections: 0, rulings: 0, finalized: false } })
    service.markExhibitsSeen(courseId, caseId).catch(() => {})
  }, [service, courseId, caseId])

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

  /** Flagging is for an active case; the instructor's answers are marked read once shown. */
  const flagging: FlagsContextValue | null =
    data?.case.status === 'active'
      ? {
          flags,
          async raise(input) {
            setFlags(await service.raiseFlag(courseId, caseId, input))
            workspace?.reloadHome()
          },
          markSeen() {
            // Once per visit; the New badges stay up until the flags are loaded again.
            if (flagsMarked.current) return
            flagsMarked.current = true
            service.markFlagsSeen(courseId, caseId).catch(() => {})
          },
        }
      : null
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
          <FlagsContext.Provider value={flagging}>
            <CaseWorkspaceView
              workspace={data}
              intro={playing && intro ? { intro: playing, onDone: () => setIntro({ key: intro.key, intro: null }) } : undefined}
              downloadUrl={(id) => service.myMaterialDownloadUrl(courseId, caseId, id)}
              loadText={(id) => service.myMaterialText(courseId, caseId, id)}
              onToggleTask={toggleTask}
              interviewHref={(id) => `/courses/${courseId}/cases/${caseId}/witnesses/${id}${workspace?.search ?? ''}`}
              instructorName={workspace?.home.course.instructorName}
              instructorAvatarUrl={workspace?.home.course.instructorAvatarUrl}
              reviews={reviews ?? []}
              onOpenReviews={openReviews}
              loadTranscript={(reviewId) => service.getMyReviewTranscript(courseId, caseId, reviewId)}
              investigations={investigations ?? []}
              onSendInvestigation={sendInvestigation}
              onOpenInvestigator={openInvestigator}
              exchange={exchange}
              onSubmitDisclosures={submitDisclosures}
              onSendRequest={sendRequest}
              onRespondToRequest={respondToRequest}
              onServeSubpoena={serveSubpoena}
              onCheckDiscovery={(input, onProgress) => service.checkDiscovery(courseId, caseId, input, onProgress)}
              onWarmCheck={(input) => void service.warmDiscoveryCheck(courseId, caseId, input).catch(() => {})}
              onOpenExchange={openExchange}
              exchangeDrafts={exchangeDrafts}
              initialDraftId={initialDraftId}
              onOpenDraft={openDraft}
              exhibits={exhibits}
              exhibitActions={exhibitActions}
              packetActions={packetActions}
              onOpenExhibits={openExhibits}
              initialTab={initialTab}
            />
          </FlagsContext.Provider>
        </>
      )}
    </main>
  )
}
