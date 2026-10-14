import { Briefcase, ChevronRight } from 'lucide-react'
import { useCallback } from 'react'
import { Link } from 'react-router'
import { useLoad } from '../api/useLoad'
import { PageFrame } from '../layout/PageFrame'
import { useCasesApi } from './CasesApiContext'
import './Cases.css'

/** Released cases across the student's courses (the sidebar's My cases page). */
export function StudentCasesPage() {
  const api = useCasesApi()
  const { data: cases, error } = useLoad(useCallback(() => api.listAllCases(), [api]))

  return (
    <PageFrame crumbs={[{ label: 'Student workspace', to: '/' }, { label: 'My cases' }]}>
      <div className="ws-welcome case-page-head">
        <div>
          <h1 className="ws-title">My cases</h1>
          <p className="ws-subtle">Cases your instructors have released to you.</p>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {cases?.length === 0 && (
        <div className="ws-empty">
          <p>Nothing has been released yet.</p>
          <p className="ws-subtle">Your cases show up here once your instructor releases them.</p>
        </div>
      )}
      {cases && cases.length > 0 && (
        <section className="ws-panel case-panel" aria-label="Cases">
          <ul className="case-rows">
            {cases.map((c) => (
              <li key={c.id}>
                <span className="ws-icon-tile ws-tone-blue" aria-hidden>
                  <Briefcase size={18} />
                </span>
                <Link to={`/courses/${c.courseId}/cases/${c.id}`} className="case-row-main case-row-link">
                  <span>{c.name}</span>
                  <span>{c.courseName}</span>
                </Link>
                <ChevronRight size={18} className="muted" aria-hidden />
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageFrame>
  )
}
