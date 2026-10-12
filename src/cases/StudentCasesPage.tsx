import { Briefcase, ChevronRight } from 'lucide-react'
import { useCallback } from 'react'
import { Link } from 'react-router'
import { useLoad } from '../api/useLoad'
import { PageFrame } from '../layout/PageFrame'
import { useCasesApi } from './CasesApiContext'

export function StudentCasesPage() {
  const api = useCasesApi()
  const { data: cases, error } = useLoad(useCallback(() => api.listStudentCases(), [api]))

  return (
    <PageFrame crumbs={[{ label: 'Student workspace', to: '/' }, { label: 'My cases' }]}>
      <div className="page-header">
        <div>
          <h1 className="page-title">My cases</h1>
          <p className="page-lede">Cases your instructors have released to you.</p>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <section className="panel" aria-label="Cases">
        {cases?.length === 0 && <p className="hint">No cases have been released to you yet.</p>}
        <ul className="rows">
          {cases?.map((c) => (
            <li key={c.id}>
              <span className="icon-tile" aria-hidden>
                <Briefcase size={18} />
              </span>
              <Link to={`/cases/${c.id}`} className="row-main row-link">
                <span>{c.name}</span>
                <span>{c.className}</span>
              </Link>
              <ChevronRight size={18} className="muted" aria-hidden />
            </li>
          ))}
        </ul>
      </section>
    </PageFrame>
  )
}
