import { useEffect, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { Link, useLocation, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router'
import { useCourseService } from '../../courses/CourseServiceContext'
import type { CourseCase } from '../../courses/types'
import type { WorkspaceContext } from '../../workspace/useWorkspace'
import { NotFoundPage } from '../NotFoundPage'
import { CaseForm } from './CaseForm'
import { CaseStatusBadge } from './CaseStatusBadge'
import { STATUS_HINT } from './caseStatus'
import { LaunchPanel } from './content/LaunchPanel'
import { MaterialsSection } from './content/MaterialsSection'
import { StudentViewSection } from './content/StudentViewSection'
import { TasksSection } from './content/TasksSection'
import { WitnessesSection } from './content/WitnessesSection'
import { PhasePanel } from './PhasePanel'
import { CaseSetupFlow } from './setup/CaseSetupFlow'
import { TeamsSection } from './TeamsSection'
import '../CoursePage.css'
import './Cases.css'

const TABS = [
  { id: 'teams', label: 'Teams & worlds' },
  { id: 'materials', label: 'Case file' },
  { id: 'witnesses', label: 'Witnesses' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'student-view', label: 'Student view' },
] as const
type TabId = (typeof TABS)[number]['id']

/**
 * One case, as its instructor manages it: details, launching the case worlds,
 * and tabs for teams and worlds, materials, witnesses, tasks, and a preview of
 * what students see. The tab is kept in the URL (?tab=materials).
 */
export function CaseDetailPage() {
  const { courseId = '', caseId = '' } = useParams()
  const service = useCourseService()
  const workspace = useOutletContext<WorkspaceContext | undefined>()
  const allCasesPath = `/courses/${courseId}/cases${workspace?.search ?? ''}`
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab: TabId = TABS.some((t) => t.id === params.get('tab')) ? (params.get('tab') as TabId) : 'teams'
  // A case just created by the guided setup comes with the navigation, so there's no loading flash.
  const handedOver = (useLocation().state as { courseCase?: CourseCase } | null)?.courseCase
  const initialCase = handedOver?.id === caseId ? handedOver : null
  const [courseCase, setCourseCase] = useState<CourseCase | null>(initialCase)
  /** Showing the guided setup: while it's unfinished, and on through its congratulations. */
  const [inSetup, setInSetup] = useState(initialCase?.setupCompletedAt === null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // Bumped whenever something the launch checklist depends on changes.
  const [checksKey, setChecksKey] = useState(0)

  useEffect(() => {
    if (initialCase) return
    let cancelled = false
    setCourseCase(null)
    setLoadError(null)
    service
      .getCase(courseId, caseId)
      .then((c) => {
        if (cancelled) return
        setCourseCase(c)
        setInSetup(c.setupCompletedAt === null)
      })
      .catch((err: Error) => !cancelled && setLoadError(err.message))
    return () => {
      cancelled = true
    }
    // `initialCase` only matters for the first load of this case.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, courseId, caseId])

  function selectTab(id: TabId) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (id === 'teams') next.delete('tab')
        else next.set('tab', id)
        return next
      },
      { replace: true },
    )
  }

  async function handleDelete() {
    if (!courseCase) return
    const confirmed = window.confirm(
      `Delete ${courseCase.title}? Its teams, case worlds, materials, witnesses, and tasks are ` +
        'deleted too. This cannot be undone.',
    )
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

  /** Pairing or materials changed: the dashboard and launch checklist may need updating. */
  function contentChanged() {
    workspace?.reloadHome()
    setChecksKey((k) => k + 1)
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
      ) : inSetup ? (
        <CaseSetupFlow
          courseId={courseId}
          courseCase={courseCase}
          onCaseChange={setCourseCase}
          onContentChange={contentChanged}
          onExit={(to) => {
            setInSetup(false)
            selectTab(to === 'student-view' ? 'student-view' : 'teams')
          }}
        />
      ) : (
        <>
          {editing ? (
            <CaseForm
              initial={courseCase}
              label="Edit case"
              submitLabel="Save"
              submittingLabel="Saving…"
              onSubmit={async (input, note) => {
                let saved = await service.updateCase(courseId, courseCase.id, {
                  title: input.title,
                  summary: input.summary,
                  status: input.status ?? courseCase.status,
                  importantFacts: input.importantFacts,
                })
                if (note.trim() !== courseCase.instructorNote) {
                  saved = await service.saveInstructorNote(courseId, courseCase.id, note)
                }
                setCourseCase(saved)
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
                {courseCase.instructorNote && (
                  <p className="case-note">
                    <strong>Note to students:</strong> {courseCase.instructorNote}
                  </p>
                )}
              </div>
            </header>
          )}

          <PhasePanel courseId={courseId} courseCase={courseCase} onChanged={setCourseCase} />

          {courseCase.status === 'draft' && (
            <LaunchPanel
              courseId={courseId}
              caseId={courseCase.id}
              refreshKey={checksKey}
              onLaunched={(launched) => {
                setCourseCase(launched)
                workspace?.reloadHome()
              }}
            />
          )}

          <div className="case-tabs" role="tablist" aria-label="Case setup">
            {/* The student view comes once the guided setup is finished. */}
            {TABS.filter((t) => t.id !== 'student-view' || courseCase.setupCompletedAt !== null).map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`case-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls="case-tab-panel"
                className="case-tab"
                onClick={() => selectTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div role="tabpanel" id="case-tab-panel" aria-labelledby={`case-tab-${tab}`}>
            {tab === 'teams' && (
              <TeamsSection
                courseId={courseId}
                caseId={courseCase.id}
                closed={courseCase.status === 'closed'}
                onChange={contentChanged}
              />
            )}
            {tab === 'materials' && (
              <MaterialsSection courseId={courseId} caseId={courseCase.id} onChange={contentChanged} />
            )}
            {tab === 'witnesses' && (
              <WitnessesSection courseId={courseId} courseCase={courseCase} onCaseChange={setCourseCase} />
            )}
            {tab === 'tasks' && <TasksSection courseId={courseId} caseId={courseCase.id} />}
            {tab === 'student-view' && (
              <StudentViewSection
                courseId={courseId}
                caseId={courseCase.id}
                instructorName={workspace?.home.course.instructorName}
                instructorAvatarUrl={workspace?.home.course.instructorAvatarUrl}
              />
            )}
          </div>
        </>
      )}
    </main>
  )
}
