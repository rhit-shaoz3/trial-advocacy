import { useEffect, useState } from 'react'
import {
  BriefcaseBusiness,
  CalendarDays,
  ChevronLeft,
  LayoutDashboard,
  Library,
  LogOut,
  Scale,
} from 'lucide-react'
import { Link, NavLink, Outlet, useNavigate, useParams, useSearchParams } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { useCourseService } from '../courses/CourseServiceContext'
import { Avatar } from './Avatar'
import { withSampleData } from './sampleData'
import type { CourseHome } from './types'
import type { WorkspaceContext } from './useWorkspace'
import './workspace.css'

const NAV = [
  { to: '', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: 'cases', label: 'My cases', icon: BriefcaseBusiness },
  { to: 'calendar', label: 'Calendar', icon: CalendarDays },
  { to: 'resources', label: 'Resource library', icon: Library },
]

/**
 * A student's view of one course: navy sidebar + page area, after the Figma
 * mock. Loads the course home once and hands it to the pages inside.
 */
export function WorkspaceLayout() {
  const { courseId = '' } = useParams()
  const { user, logOut } = useAuth()
  const service = useCourseService()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // Dev-only preview: /courses/:id?sample fills the page with made-up cases.
  const sample = import.meta.env.DEV && params.has('sample')
  const [home, setHome] = useState<CourseHome | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setHome(null)
    setError(null)
    service
      .getCourseHome(courseId)
      .then((h) => !cancelled && setHome(sample ? withSampleData(h) : h))
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [service, courseId, sample])

  async function handleLogOut() {
    await logOut()
    navigate('/')
  }

  if (!user) return null
  const base = `/courses/${courseId}`
  const search = sample ? '?sample' : ''

  return (
    <div className="ws">
      <aside className="ws-sidebar">
        <Link to="/" className="ws-brand">
          <span className="ws-brand-icon">
            <Scale aria-hidden="true" />
          </span>
          <span>
            <strong>Trial Advocacy</strong>
            <small>{home ? home.course.code : 'Course'}</small>
          </span>
        </Link>

        <nav aria-label="Course">
          <span className="ws-nav-label">Workspace</span>
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={label} to={`${base}${to && `/${to}`}${search}`} end={end}>
              <Icon aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="ws-sidebar-bottom">
          {home && (
            <div className="ws-course-card">
              <span>{home.course.term}</span>
              <strong>{home.course.title}</strong>
              {home.course.instructorName && <small>{home.course.instructorName}</small>}
            </div>
          )}
          <Link to="/" className="ws-all-courses">
            <ChevronLeft aria-hidden="true" />
            All courses
          </Link>
          <div className="ws-profile">
            <Avatar name={user.name} />
            <span>
              <strong>{user.name}</strong>
              <small>{user.role === 'student' ? 'Student' : 'Instructor'}</small>
            </span>
            <button type="button" onClick={handleLogOut} aria-label="Log out" title="Log out">
              <LogOut aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>

      <div className="ws-main">
        {sample && (
          <p className="ws-sample-banner" role="note">
            Showing sample cases, activity, and deadlines (development preview).
          </p>
        )}
        {error ? (
          <main className="ws-page">
            <h1 className="ws-title">{error === 'Course not found.' ? 'Course not found' : 'Something went wrong'}</h1>
            <p className="ws-subtle">
              {error === 'Course not found.'
                ? 'This course does not exist, or you are not enrolled in it.'
                : `Could not load this course. ${error}`}
            </p>
            <Link to="/" className="ws-btn ws-btn-secondary">
              Back to your courses
            </Link>
          </main>
        ) : !home ? (
          <main className="ws-page">
            <p className="ws-subtle">Loading course…</p>
          </main>
        ) : (
          <Outlet context={{ home, search } satisfies WorkspaceContext} />
        )}
      </div>
    </div>
  )
}
