import { PageFrame } from '../layout/PageFrame'
import { StudentCourseList } from './StudentCourseList'
import { StudentNotices } from './StudentNotices'
import { useStudentHome } from './useStudentHome'
import './Dashboard.css'

export function StudentCoursesPage() {
  const { service, courses, inbox, error, reload, act } = useStudentHome()

  return (
    <PageFrame crumbs={[{ label: 'Student workspace', to: '/' }, { label: 'My courses' }]}>
      <div className="ws-welcome">
        <div>
          <h1 className="ws-title">My courses</h1>
          <p className="ws-subtle">Join a course with the code your instructor gave you.</p>
        </div>
      </div>
      <div className="case-stack">
        <StudentNotices inbox={inbox} service={service} act={act} />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <StudentCourseList courses={courses} inbox={inbox} onJoined={reload} />
      </div>
    </PageFrame>
  )
}
