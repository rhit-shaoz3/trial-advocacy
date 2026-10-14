import { ArrowRight, Briefcase } from 'lucide-react'
import { useCallback } from 'react'
import { Link } from 'react-router'
import { useLoad } from '../api/useLoad'
import { useAuth } from '../auth/useAuth'
import { useCasesApi } from '../cases/CasesApiContext'
import { firstName } from '../layout/initials'
import { PageFrame } from '../layout/PageFrame'
import { StudentCourseList } from './StudentCourseList'
import { StudentNotices } from './StudentNotices'
import { todayLabel } from './todayLabel'
import { useStudentHome } from './useStudentHome'
import './Dashboard.css'

export function StudentOverview() {
  const { user } = useAuth()
  const home = useStudentHome()
  const casesApi = useCasesApi()
  const cases = useLoad(useCallback(() => casesApi.listAllCases(), [casesApi]))

  return (
    <PageFrame crumbs={[{ label: 'Student workspace' }, { label: 'Overview' }]}>
      <div className="ws-welcome">
        <div>
          <span className="ws-eyebrow">{todayLabel()}</span>
          <h1 className="ws-title">Welcome, {firstName(user?.name ?? '')}.</h1>
          <p className="ws-subtle">Your cases and courses, all in one place.</p>
        </div>
      </div>

      <div className="case-stack">
        <StudentNotices inbox={home.inbox} service={home.service} act={home.act} />
        {(home.error || cases.error) && (
          <p className="form-error" role="alert">
            {home.error ?? cases.error}
          </p>
        )}

        <div className="case-two-col">
          <section aria-labelledby="student-cases-heading">
            <div className="ws-section-heading">
              <h2 id="student-cases-heading">Your cases</h2>
              <Link to="/cases" className="ws-link">
                All cases <ArrowRight size={16} aria-hidden />
              </Link>
            </div>
            {cases.data?.length === 0 && (
              <div className="ws-empty">
                <p className="case-empty-title">Nothing assigned yet.</p>
                <p className="ws-subtle">Your cases appear here once your instructor releases them.</p>
              </div>
            )}
            <div className="case-card-grid">
              {cases.data?.map((c) => (
                <Link key={c.id} to={`/courses/${c.courseId}/cases/${c.id}`} className="ws-panel case-tile">
                  <span className="ws-icon-tile ws-tone-blue" aria-hidden>
                    <Briefcase size={18} />
                  </span>
                  <span className="ws-eyebrow">{c.courseName}</span>
                  <h3 className="case-tile-name">{c.name}</h3>
                  <span className="ws-link">
                    Open case <ArrowRight size={16} aria-hidden />
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <StudentCourseList courses={home.courses} inbox={home.inbox} onJoined={home.reload} />
        </div>
      </div>
    </PageFrame>
  )
}
