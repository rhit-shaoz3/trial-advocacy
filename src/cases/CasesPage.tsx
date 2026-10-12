import { ArrowRight, Briefcase, ChevronRight, Plus } from 'lucide-react'
import { useCallback, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { useLoad } from '../api/useLoad'
import { useClassesApi } from '../classes/ClassesApiContext'
import { errorMessage } from '../dashboard/errorMessage'
import { PageFrame } from '../layout/PageFrame'
import { useCasesApi } from './CasesApiContext'
import type { Section } from './types'
import './Cases.css'

const SECTION_LABELS: Record<Section, string> = {
  documents: 'Files',
  characters: 'Characters',
  teams: 'Teams',
}

export function CasesPage() {
  const api = useCasesApi()
  const classesApi = useClassesApi()
  const navigate = useNavigate()
  const cases = useLoad(useCallback(() => api.listInstructorCases(), [api]))
  const classes = useLoad(useCallback(() => classesApi.listInstructorClasses(), [classesApi]))
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [classId, setClassId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const created = await api.createCase({ name: name.trim(), classId })
      navigate(`/cases/${created.id}`)
    } catch (err) {
      setError(errorMessage(err))
      setSubmitting(false)
    }
  }

  const noClasses = classes.data?.length === 0
  const loadError = cases.error ?? classes.error

  return (
    <PageFrame crumbs={[{ label: 'Instructor workspace', to: '/' }, { label: 'Cases' }]}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Cases</h1>
          <p className="page-lede">
            Build each case's files, characters, teams and match-ups, then release them to students.
          </p>
        </div>
        {!creating && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setCreating(true)}
            disabled={!classes.data || noClasses}
          >
            <Plus size={18} aria-hidden /> New case
          </button>
        )}
      </div>

      <div className="page-stack">
        {noClasses && (
          <p className="note">
            Create a class first, then add cases to it.{' '}
            <Link to="/classes?new=1">Create a class</Link>
          </p>
        )}

        {creating && (
          <form className="panel form new-case-form" onSubmit={handleSubmit} aria-label="New case">
            <h2 className="panel-title">New case</h2>
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
              Class
              <select value={classId} onChange={(e) => setClassId(e.target.value)} required>
                <option value="" disabled>
                  Choose a class
                </option>
                {classes.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="actions form-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setCreating(false)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
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
          <section className="panel" aria-label="Case library">
            <ul className="rows">
              {cases.data.map((c) => (
                <li key={c.id}>
                  <span className="icon-tile" aria-hidden>
                    <Briefcase size={18} />
                  </span>
                  <Link to={`/cases/${c.id}`} className="row-main row-link">
                    <span>{c.name}</span>
                    <span>{c.className}</span>
                  </Link>
                  <span className="publish-badges">
                    {(Object.keys(SECTION_LABELS) as Section[]).map((s) => (
                      <span key={s} className={c.published[s] ? 'badge' : 'badge badge-muted'}>
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
        {cases.data?.length === 0 && !creating && !noClasses && (
          <p className="hint">No cases yet. Use New case to add one.</p>
        )}
      </div>
    </PageFrame>
  )
}
