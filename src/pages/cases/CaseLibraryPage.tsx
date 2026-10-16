import { ArrowRight, Briefcase, ChevronRight, Plus } from 'lucide-react'
import { useCallback } from 'react'
import { Link } from 'react-router'
import { useLoad } from '../../api/useLoad'
import { useAuth } from '../../auth/useAuth'
import { useCourseService } from '../../courses/CourseServiceContext'
import { ROLE_LABEL, worldLabel } from '../../courses/worldLabel'
import { PageFrame } from '../../layout/PageFrame'
import { CaseStatusBadge } from './CaseStatusBadge'
import { courseName, loadStudentCases, loadTaughtCases } from './caseLibrary'
import './Cases.css'

/** The sidebar's Cases page: every case across the user's courses. */
export function CaseLibraryPage() {
  const { user } = useAuth()
  return user?.role === 'instructor' ? <InstructorCaseLibrary /> : <StudentCaseLibrary />
}

function InstructorCaseLibrary() {
  const service = useCourseService()
  const { data, error } = useLoad(useCallback(() => loadTaughtCases(service), [service]))

  return (
    <PageFrame crumbs={[{ label: 'Instructor workspace', to: '/' }, { label: 'Cases' }]}>
      <div className="ws-welcome">
        <div>
          <h1 className="ws-title">Cases</h1>
          <p className="ws-subtle">
            Every case in your courses. Open one to build its case file, witnesses, and teams, then launch it.
          </p>
        </div>
      </div>

      <div className="case-stack">
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {data?.length === 0 && (
          <p className="case-note">
            Create a course first, then add cases to it. <Link to="/courses?new=1">Create a course</Link>
          </p>
        )}
        {data?.map(({ course, cases }) => (
          <section key={course.id} className="ws-panel case-panel" aria-labelledby={`library-${course.id}`}>
            <div className="case-panel-head">
              <h2 id={`library-${course.id}`}>
                {courseName(course)} <span className="case-hint">· {course.term}</span>
              </h2>
              <Link to={`/courses/${course.id}/cases`} className="ws-link">
                <Plus size={16} aria-hidden /> New case
              </Link>
            </div>
            {cases.length === 0 ? (
              <p className="case-hint">No cases yet.</p>
            ) : (
              <ul className="case-rows">
                {cases.map((k) => (
                  <li key={k.id}>
                    <span className="ws-icon-tile ws-tone-blue" aria-hidden>
                      <Briefcase size={18} />
                    </span>
                    <Link to={`/courses/${course.id}/cases/${k.id}`} className="case-row-main case-row-link">
                      <span>{k.title}</span>
                      {k.summary && <span>{k.summary}</span>}
                    </Link>
                    <CaseStatusBadge status={k.status} />
                    <ChevronRight size={18} className="muted" aria-hidden />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </PageFrame>
  )
}

function StudentCaseLibrary() {
  const service = useCourseService()
  const { data, error } = useLoad(useCallback(() => loadStudentCases(service), [service]))
  const total = data?.reduce((n, c) => n + c.cases.length, 0)

  return (
    <PageFrame crumbs={[{ label: 'Student workspace', to: '/' }, { label: 'Cases' }]}>
      <div className="ws-welcome">
        <div>
          <h1 className="ws-title">Cases</h1>
          <p className="ws-subtle">Every case your instructors have launched, with your team and side.</p>
        </div>
      </div>

      <div className="case-stack">
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {total === 0 && (
          <div className="ws-empty">
            <p className="case-empty-title">Nothing assigned yet.</p>
            <p className="ws-subtle">Your cases appear here once your instructor launches them.</p>
          </div>
        )}
        {data
          ?.filter(({ cases }) => cases.length > 0)
          .map(({ course, cases }) => (
            <section key={course.id} className="ws-panel case-panel" aria-labelledby={`library-${course.id}`}>
              <div className="case-panel-head">
                <h2 id={`library-${course.id}`}>{courseName(course)}</h2>
                <Link to={`/courses/${course.id}/cases`} className="ws-link">
                  Course cases <ArrowRight size={16} aria-hidden />
                </Link>
              </div>
              <ul className="case-rows">
                {cases.map((k) => (
                  <li key={k.id}>
                    <span className="ws-icon-tile ws-tone-blue" aria-hidden>
                      <Briefcase size={18} />
                    </span>
                    <Link to={`/courses/${course.id}/cases/${k.id}`} className="case-row-main case-row-link">
                      <span>{k.title}</span>
                      <span>
                        {k.world
                          ? `World ${worldLabel(k.world.number)} · ${ROLE_LABEL[k.world.side]}`
                          : k.team
                            ? `Team ${k.team.number} · waiting for a case world`
                            : 'Not on a team yet'}
                      </span>
                    </Link>
                    <CaseStatusBadge status={k.status} />
                    <ChevronRight size={18} className="muted" aria-hidden />
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>
    </PageFrame>
  )
}
