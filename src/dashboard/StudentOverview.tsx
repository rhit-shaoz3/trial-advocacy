import { ArrowRight, Briefcase } from 'lucide-react'
import { useCallback } from 'react'
import { Link } from 'react-router'
import { useLoad } from '../api/useLoad'
import { useAuth } from '../auth/useAuth'
import { useCasesApi } from '../cases/CasesApiContext'
import { firstName } from '../layout/initials'
import { PageFrame } from '../layout/PageFrame'
import { StudentClassList } from './StudentClassList'
import { StudentNotices } from './StudentNotices'
import { todayLabel } from './todayLabel'
import { useStudentHome } from './useStudentHome'
import './Dashboard.css'

export function StudentOverview() {
  const { user } = useAuth()
  const home = useStudentHome()
  const casesApi = useCasesApi()
  const cases = useLoad(useCallback(() => casesApi.listStudentCases(), [casesApi]))

  return (
    <PageFrame crumbs={[{ label: 'Student workspace' }, { label: 'Overview' }]}>
      <div className="page-header">
        <div>
          <p className="eyebrow">{todayLabel()}</p>
          <h1 className="page-title">Welcome, {firstName(user?.name ?? '')}.</h1>
          <p className="page-lede">Your cases and classes, all in one place.</p>
        </div>
      </div>

      <div className="page-stack">
        <StudentNotices inbox={home.inbox} api={home.api} act={home.act} />
        {(home.error || cases.error) && (
          <p className="form-error" role="alert">
            {home.error ?? cases.error}
          </p>
        )}

        <div className="two-col">
          <section aria-labelledby="student-cases-heading">
            <div className="section-head">
              <h2 id="student-cases-heading">Your cases</h2>
              <Link to="/cases" className="link-arrow">
                All cases <ArrowRight size={16} aria-hidden />
              </Link>
            </div>
            {cases.data?.length === 0 && (
              <div className="panel empty-state">
                <p className="serif empty-title">Nothing assigned yet.</p>
                <p className="hint">
                  Your cases appear here once your instructor releases them.
                </p>
              </div>
            )}
            <div className="card-grid">
              {cases.data?.map((c) => (
                <Link key={c.id} to={`/cases/${c.id}`} className="panel case-tile">
                  <span className="icon-tile" aria-hidden>
                    <Briefcase size={18} />
                  </span>
                  <p className="eyebrow">{c.className}</p>
                  <h3 className="serif case-tile-name">{c.name}</h3>
                  <span className="link-arrow">
                    Open case <ArrowRight size={16} aria-hidden />
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <StudentClassList classes={home.classes} inbox={home.inbox} onJoined={home.reload} />
        </div>
      </div>
    </PageFrame>
  )
}
