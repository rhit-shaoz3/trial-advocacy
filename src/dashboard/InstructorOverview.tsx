import { ArrowRight, Briefcase, ChevronRight, GraduationCap, Plus, UserPlus, Users } from 'lucide-react'
import { useCallback, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useLoad } from '../api/useLoad'
import { useAuth } from '../auth/useAuth'
import { useCasesApi } from '../cases/CasesApiContext'
import { useCourseService } from '../courses/CourseServiceContext'
import { firstName } from '../layout/initials'
import { PageFrame } from '../layout/PageFrame'
import { todayLabel } from './todayLabel'
import './Dashboard.css'

function StatCard({ label, value, note, icon }: { label: string; value: number; note: string; icon: ReactNode }) {
  return (
    <div className="ws-panel stat-card">
      <div className="stat-head">
        <span>{label}</span>
        <span className="stat-icon" aria-hidden>
          {icon}
        </span>
      </div>
      <p className="stat-value">{value}</p>
      <p className="case-hint">{note}</p>
    </div>
  )
}

export function InstructorOverview() {
  const { user } = useAuth()
  const courseService = useCourseService()
  const casesApi = useCasesApi()
  const courses = useLoad(useCallback(() => courseService.listTaughtCourses(), [courseService]))
  const cases = useLoad(useCallback(() => casesApi.listAllCases(), [casesApi]))

  const courseList = courses.data ?? []
  const caseList = cases.data ?? []
  const students = courseList.reduce((n, c) => n + c.studentCount, 0)
  const waiting = courseList.reduce((n, c) => n + c.requestCount, 0)
  const published = caseList.filter((c) => Object.values(c.published).some(Boolean)).length
  const loaded = courses.data !== null && cases.data !== null

  return (
    <PageFrame crumbs={[{ label: 'Instructor workspace' }, { label: 'Overview' }]}>
      <div className="ws-welcome">
        <div>
          <span className="ws-eyebrow">{todayLabel()}</span>
          <h1 className="ws-title">Welcome back, {firstName(user?.name ?? '')}.</h1>
          <p className="ws-subtle">Your courses are moving from preparation to practice.</p>
        </div>
        <Link to="/courses?new=1" className="ws-btn ws-btn-primary">
          <Plus size={18} aria-hidden /> Create course
        </Link>
      </div>

      {(courses.error || cases.error) && (
        <p className="form-error" role="alert">
          {courses.error ?? cases.error}
        </p>
      )}

      {loaded && (
        <div className="case-stack overview-stack">
          <div className="stat-grid">
            <StatCard
              label="Courses"
              value={courseList.length}
              note={`${courseList.filter((c) => c.studentCount > 0).length} with students`}
              icon={<GraduationCap size={18} />}
            />
            <StatCard label="Students" value={students} note="Across all your courses" icon={<Users size={18} />} />
            <StatCard
              label="Cases"
              value={caseList.length}
              note={`${published} published to students`}
              icon={<Briefcase size={18} />}
            />
            <StatCard
              label="Seeking admission"
              value={waiting}
              note={waiting ? 'Waiting for your decision' : 'All caught up'}
              icon={<UserPlus size={18} />}
            />
          </div>

          <section aria-labelledby="overview-courses">
            <div className="ws-section-heading">
              <h2 id="overview-courses">Your courses</h2>
              <Link to="/courses" className="ws-link">
                View all courses <ArrowRight size={16} aria-hidden />
              </Link>
            </div>
            {courseList.length === 0 ? (
              <div className="ws-empty">
                <p className="case-empty-title">Let’s build your first course.</p>
                <p className="ws-subtle">Create a course, then share its entry code or invite students by email.</p>
                <Link to="/courses?new=1" className="ws-btn ws-btn-primary">
                  <Plus size={18} aria-hidden /> Create course
                </Link>
              </div>
            ) : (
              <div className="case-card-grid">
                {courseList.map((c) => {
                  const courseCases = caseList.filter((k) => k.courseId === c.id)
                  return (
                    <article key={c.id} className="ws-panel course-tile" aria-labelledby={`tile-${c.id}`}>
                      <span className="case-badge">Entry code {c.entryCode}</span>
                      <h3 id={`tile-${c.id}`} className="course-tile-name">
                        {c.code}: {c.title}
                      </h3>
                      <p className="case-hint">
                        {c.term} · {courseCases.length ? courseCases.map((k) => k.name).join(' · ') : 'No cases yet'}
                      </p>
                      <p className="course-tile-counts">
                        <span>{c.studentCount} students</span>
                        {c.requestCount > 0 && <span className="case-badge case-badge-warning">{c.requestCount} waiting</span>}
                      </p>
                      <div className="course-tile-foot">
                        <span className="case-hint">{c.invitedCount} invited</span>
                        <Link to={`/courses/${c.id}`} className="ws-link">
                          Open course <ArrowRight size={16} aria-hidden />
                        </Link>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          <section className="ws-panel case-panel" aria-labelledby="overview-cases">
            <div className="case-panel-head">
              <h2 id="overview-cases">Case library</h2>
              <Link to="/cases" className="ws-link">
                View all cases <ArrowRight size={16} aria-hidden />
              </Link>
            </div>
            {caseList.length === 0 ? (
              <p className="case-hint">No cases yet. Add one from a course’s Cases tab.</p>
            ) : (
              <ul className="case-rows">
                {caseList.slice(0, 5).map((k) => (
                  <li key={k.id}>
                    <span className="ws-icon-tile ws-tone-blue" aria-hidden>
                      <Briefcase size={18} />
                    </span>
                    <Link to={`/courses/${k.courseId}/cases/${k.id}`} className="case-row-main case-row-link">
                      <span>{k.name}</span>
                      <span>{k.courseName}</span>
                    </Link>
                    <ChevronRight size={18} className="muted" aria-hidden />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </PageFrame>
  )
}
