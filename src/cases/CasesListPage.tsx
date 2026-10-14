import { BriefcaseBusiness, ChevronRight, Plus } from 'lucide-react'
import { useCallback, useState, type FormEvent } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router'
import { errorMessage, useLoad } from '../api/useLoad'
import { useAuth } from '../auth/useAuth'
import type { WorkspaceContext } from '../workspace/useWorkspace'
import { useCasesApi } from './CasesApiContext'
import type { Section } from './types'
import './Cases.css'

const SECTION_LABELS: Record<Section, string> = {
  documents: 'Files',
  characters: 'Characters',
  teams: 'Teams',
}

/** The course workspace's Cases tab: every case for the instructor, released ones for students. */
export function CasesListPage() {
  const { courseId = '' } = useParams()
  const { user } = useAuth()
  const isInstructor = user?.role === 'instructor'
  // Present inside the course workspace, which shows the course name in the sidebar.
  const workspace = useOutletContext<WorkspaceContext | undefined>()
  const api = useCasesApi()
  const navigate = useNavigate()
  const { data: cases, error } = useLoad(useCallback(() => api.listCourseCases(courseId), [api, courseId]))
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setCreateError(null)
    setSubmitting(true)
    try {
      const created = await api.createCase(courseId, name.trim())
      workspace?.reloadHome()
      navigate(`/courses/${courseId}/cases/${created.id}`)
    } catch (err) {
      setCreateError(errorMessage(err))
      setSubmitting(false)
    }
  }

  return (
    <main className="ws-page case-page">
      <div className="ws-welcome">
        <div>
          {workspace && <span className="ws-eyebrow">{workspace.home.course.code}</span>}
          <h1 className="ws-title">{isInstructor ? 'All cases' : 'My cases'}</h1>
          <p className="ws-subtle">
            {isInstructor
              ? 'Build each case’s files, characters, teams and match-ups, then release them to students.'
              : 'Cases your instructor has released to you.'}
          </p>
        </div>
        {isInstructor && !creating && (
          <button type="button" className="ws-btn ws-btn-primary" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" /> New case
          </button>
        )}
      </div>

      {creating && (
        <form className="panel-form case-new-form" onSubmit={handleCreate} aria-label="New case">
          <label>
            Case name
            <input
              type="text"
              placeholder="e.g. Rivera v. Northstar Transit"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              required
            />
          </label>
          {createError && (
            <p className="form-error" role="alert">
              {createError}
            </p>
          )}
          <div className="panel-form-actions">
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create case'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setCreating(false)}
              disabled={submitting}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {cases?.length === 0 && !creating && (
        <div className="ws-empty">
          {isInstructor ? (
            <>
              <p>No cases yet.</p>
              <p className="ws-subtle">Use New case to set up the first one.</p>
            </>
          ) : (
            <>
              <p>Nothing has been released yet.</p>
              <p className="ws-subtle">Your cases show up here once your instructor releases them.</p>
            </>
          )}
        </div>
      )}

      {cases && cases.length > 0 && (
        <section className="ws-panel case-panel" aria-label="Cases">
          <ul className="case-rows">
            {cases.map((c) => (
              <li key={c.id}>
                <span className="ws-icon-tile ws-tone-blue" aria-hidden="true">
                  <BriefcaseBusiness />
                </span>
                <Link to={`/courses/${courseId}/cases/${c.id}`} className="case-row-main case-row-link">
                  <span>{c.name}</span>
                  <span>{c.courseName}</span>
                </Link>
                {isInstructor && (
                  <span className="case-publish-badges">
                    {(Object.keys(SECTION_LABELS) as Section[]).map((s) => (
                      <span key={s} className={c.published[s] ? 'case-badge' : 'case-badge case-badge-muted'}>
                        {SECTION_LABELS[s]} {c.published[s] ? 'published' : 'draft'}
                      </span>
                    ))}
                  </span>
                )}
                <ChevronRight className="muted" aria-hidden="true" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
