import { ArrowRight, Briefcase, ChevronRight, GraduationCap, Plus, UserPlus, Users } from 'lucide-react'
import { useCallback, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useLoad } from '../api/useLoad'
import { useAuth } from '../auth/useAuth'
import { useCasesApi } from '../cases/CasesApiContext'
import { useClassesApi } from '../classes/ClassesApiContext'
import { firstName } from '../layout/initials'
import { PageFrame } from '../layout/PageFrame'
import { todayLabel } from './todayLabel'
import './Dashboard.css'

function StatCard({
  label,
  value,
  note,
  icon,
}: {
  label: string
  value: number | string
  note: string
  icon: ReactNode
}) {
  return (
    <div className="panel stat-card">
      <div className="stat-head">
        <span>{label}</span>
        <span className="stat-icon" aria-hidden>
          {icon}
        </span>
      </div>
      <p className="stat-value">{value}</p>
      <p className="hint">{note}</p>
    </div>
  )
}

export function InstructorOverview() {
  const { user } = useAuth()
  const classesApi = useClassesApi()
  const casesApi = useCasesApi()
  const classes = useLoad(useCallback(() => classesApi.listInstructorClasses(), [classesApi]))
  const cases = useLoad(useCallback(() => casesApi.listInstructorCases(), [casesApi]))

  const classList = classes.data ?? []
  const caseList = cases.data ?? []
  const students = new Set(classList.flatMap((c) => c.students.map((s) => s.id)))
  const pending = classList.reduce((n, c) => n + c.pendingRequests.length, 0)
  const publishedCases = caseList.filter((c) => Object.values(c.published).some(Boolean)).length
  const loaded = classes.data !== null && cases.data !== null

  return (
    <PageFrame crumbs={[{ label: 'Instructor workspace' }, { label: 'Overview' }]}>
      <div className="page-header">
        <div>
          <p className="eyebrow">{todayLabel()}</p>
          <h1 className="page-title">Welcome back, {firstName(user?.name ?? '')}.</h1>
          <p className="page-lede">Your classes are moving from preparation to practice.</p>
        </div>
        <Link to="/classes?new=1" className="btn btn-primary">
          <Plus size={18} aria-hidden /> Create class
        </Link>
      </div>

      {(classes.error || cases.error) && (
        <p className="form-error" role="alert">
          {classes.error ?? cases.error}
        </p>
      )}

      {loaded && (
        <div className="page-stack">
          <div className="stat-grid">
            <StatCard
              label="Classes"
              value={classList.length}
              note={`${classList.filter((c) => c.students.length > 0).length} with students`}
              icon={<GraduationCap size={18} />}
            />
            <StatCard
              label="Students"
              value={students.size}
              note="Across all your classes"
              icon={<Users size={18} />}
            />
            <StatCard
              label="Cases"
              value={caseList.length}
              note={`${publishedCases} published to students`}
              icon={<Briefcase size={18} />}
            />
            <StatCard
              label="Seeking admission"
              value={pending}
              note={pending ? 'Waiting for your decision' : 'All caught up'}
              icon={<UserPlus size={18} />}
            />
          </div>

          <section aria-labelledby="overview-classes">
            <div className="section-head">
              <h2 id="overview-classes">Your classes</h2>
              <Link to="/classes" className="link-arrow">
                View all classes <ArrowRight size={16} aria-hidden />
              </Link>
            </div>
            {classList.length === 0 ? (
              <div className="panel empty-state">
                <p className="serif empty-title">Let’s build your first class.</p>
                <p className="hint">Create a class, then share its join code or invite students by email.</p>
                <Link to="/classes?new=1" className="btn btn-primary">
                  <Plus size={18} aria-hidden /> Create class
                </Link>
              </div>
            ) : (
              <div className="card-grid">
                {classList.map((c) => {
                  const classCases = caseList.filter((k) => k.classId === c.id)
                  return (
                    <article key={c.id} className="panel class-tile" aria-labelledby={`tile-${c.id}`}>
                      <span className="badge">Join code {c.joinCode}</span>
                      <h3 id={`tile-${c.id}`} className="serif class-tile-name">
                        {c.name}
                      </h3>
                      <p className="hint">
                        {classCases.length ? classCases.map((k) => k.name).join(' · ') : 'No cases yet'}
                      </p>
                      <p className="class-tile-counts">
                        <span>{c.students.length} students</span>
                        {c.pendingRequests.length > 0 && (
                          <span className="badge badge-warning">{c.pendingRequests.length} waiting</span>
                        )}
                      </p>
                      <div className="class-tile-foot">
                        <span className="hint">{c.invitations.length} invited</span>
                        <Link to={`/classes#class-${c.id}`} className="link-arrow">
                          Open class <ArrowRight size={16} aria-hidden />
                        </Link>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          <section className="panel" aria-labelledby="overview-cases">
            <div className="panel-head">
              <h2 id="overview-cases">Case library</h2>
              <Link to="/cases" className="link-arrow">
                View all cases <ArrowRight size={16} aria-hidden />
              </Link>
            </div>
            {caseList.length === 0 ? (
              <p className="hint">No cases yet. Add one from the Cases page once you have a class.</p>
            ) : (
              <ul className="rows">
                {caseList.slice(0, 5).map((k) => (
                  <li key={k.id}>
                    <span className="icon-tile" aria-hidden>
                      <Briefcase size={18} />
                    </span>
                    <Link to={`/cases/${k.id}`} className="row-main row-link">
                      <span>{k.name}</span>
                      <span>{k.className}</span>
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
