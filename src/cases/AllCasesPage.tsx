import { ArrowRight, Briefcase, ChevronRight, Plus } from 'lucide-react'
import { useCallback, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { errorMessage, useLoad } from '../api/useLoad'
import { useCourseService } from '../courses/CourseServiceContext'
import { PageFrame } from '../layout/PageFrame'
import { useCasesApi } from './CasesApiContext'
import type { Section } from './types'
import './Cases.css'

const SECTION_LABELS: Record<Section, string> = {
  documents: 'Files',
  characters: 'Characters',
  teams: 'Teams',
}

/** Every case across the instructor's courses (the sidebar's Cases page). */
export function AllCasesPage() {
  const api = useCasesApi()
  const courseService = useCourseService()
  const navigate = useNavigate()
  const cases = useLoad(useCallback(() => api.listAllCases(), [api]))
  const courses = useLoad(useCallback(() => courseService.listTaughtCourses(), [courseService]))
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [courseId, setCourseId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const created = await api.createCase(courseId, name.trim())
      navigate(`/courses/${courseId}/cases/${created.id}`)
    } catch (err) {
      setError(errorMessage(err))
      setSubmitting(false)
    }
  }

  const noCourses = courses.data?.length === 0
  const loadError = cases.error ?? courses.error

  return (
    <PageFrame crumbs={[{ label: 'Instructor workspace', to: '/' }, { label: 'Cases' }]}>
      <div className="ws-welcome case-page-head">
        <div>
          <h1 className="ws-title">Cases</h1>
          <p className="ws-subtle">
            Build each case’s files, characters, teams and match-ups, then release them to students.
          </p>
        </div>
        {!creating && (
          <button
            type="button"
            className="ws-btn ws-btn-primary"
            onClick={() => setCreating(true)}
            disabled={!courses.data || noCourses}
          >
            <Plus size={18} aria-hidden /> New case
          </button>
        )}
      </div>

      <div className="case-stack">
        {noCourses && (
          <p className="case-note">
            Create a course first, then add cases to it. <Link to="/courses?new=1">Create a course</Link>
          </p>
        )}

        {creating && (
          <form className="ws-panel case-form case-new-form" onSubmit={handleSubmit} aria-label="New case">
            <h2 className="case-panel-title">New case</h2>
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
            <label>
              Course
              <select value={courseId} onChange={(e) => setCourseId(e.target.value)} required>
                <option value="" disabled>
                  Choose a course
                </option>
                {courses.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code}: {c.title} ({c.term})
                  </option>
                ))}
              </select>
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="case-actions">
              <button
                type="button"
                className="ws-btn ws-btn-secondary"
                onClick={() => setCreating(false)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button type="submit" className="ws-btn ws-btn-primary" disabled={submitting}>
                <ArrowRight size={16} aria-hidden /> {submitting ? 'Creating…' : 'Create case'}
              </button>
            </div>
          </form>
        )}

        {loadError && (
          <p className="form-error" role="alert">
            {loadError}
          </p>
        )}

        {cases.data && cases.data.length > 0 && (
          <section className="ws-panel case-panel" aria-label="Case library">
            <ul className="case-rows">
              {cases.data.map((c) => (
                <li key={c.id}>
                  <span className="ws-icon-tile ws-tone-blue" aria-hidden>
                    <Briefcase size={18} />
                  </span>
                  <Link to={`/courses/${c.courseId}/cases/${c.id}`} className="case-row-main case-row-link">
                    <span>{c.name}</span>
                    <span>{c.courseName}</span>
                  </Link>
                  <span className="case-publish-badges">
                    {(Object.keys(SECTION_LABELS) as Section[]).map((s) => (
                      <span key={s} className={c.published[s] ? 'case-badge' : 'case-badge case-badge-muted'}>
                        {SECTION_LABELS[s]} {c.published[s] ? 'published' : 'draft'}
                      </span>
                    ))}
                  </span>
                  <ChevronRight size={18} className="muted" aria-hidden />
                </li>
              ))}
            </ul>
          </section>
        )}
        {cases.data?.length === 0 && !creating && !noCourses && (
          <p className="case-hint">No cases yet. Use New case to add one.</p>
        )}
      </div>
    </PageFrame>
  )
}
