import { PageFrame } from '../layout/PageFrame'
import { StudentClassList } from './StudentClassList'
import { StudentNotices } from './StudentNotices'
import { useStudentHome } from './useStudentHome'
import './Dashboard.css'

export function StudentClassesPage() {
  const { api, classes, inbox, error, reload, act } = useStudentHome()

  return (
    <PageFrame crumbs={[{ label: 'Student workspace', to: '/' }, { label: 'My classes' }]}>
      <div className="page-header">
        <div>
          <h1 className="page-title">My classes</h1>
          <p className="page-lede">Join a class with the code your instructor gave you.</p>
        </div>
      </div>
      <div className="page-stack">
        <StudentNotices inbox={inbox} api={api} act={act} />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <StudentClassList classes={classes} inbox={inbox} onJoined={reload} />
      </div>
    </PageFrame>
  )
}
