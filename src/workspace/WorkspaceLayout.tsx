import { useCallback, useEffect, useState } from 'react'
import {
  BriefcaseBusiness,
  CalendarDays,
  ChevronLeft,
  LayoutDashboard,
  Library,
  Settings,
} from 'lucide-react'
import { Link, Outlet, useParams, useSearchParams } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { AppShell, type ShellNavItem } from '../components/AppShell'
import { useCourseService } from '../courses/CourseServiceContext'
import { withSampleData } from './sampleData'
import type { CourseHome } from './types'
import type { WorkspaceContext } from './useWorkspace'

/**
 * One course, in the app shell with course navigation. Students and the
 * course's instructor see the same pages; instructors see "All cases" instead
 * of "My cases" and get a "Manage course" tab. Loads the course home once and
 * hands it to the pages inside.
 */
export function WorkspaceLayout() {
  const { courseId = '' } = useParams()
  const { user } = useAuth()
  const isInstructor = user?.role === 'instructor'
  const service = useCourseService()
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

  // Unlike the initial load, keeps the current page on screen while it fetches.
  const reloadHome = useCallback(() => {
    service
      .getCourseHome(courseId)
      .then((h) => setHome(sample ? withSampleData(h) : h))
      .catch(() => {}) // keep showing what we have
  }, [service, courseId, sample])

  const base = `/courses/${courseId}`
  const search = sample ? '?sample' : ''
  const nav: ShellNavItem[] = [
    { to: `${base}${search}`, label: 'Dashboard', icon: LayoutDashboard, end: true },
    {
      to: `${base}/cases${search}`,
      label: isInstructor ? 'All cases' : 'My cases',
      icon: BriefcaseBusiness,
    },
    { to: `${base}/calendar${search}`, label: 'Calendar', icon: CalendarDays },
    { to: `${base}/resources${search}`, label: 'Resource library', icon: Library },
  ]
  if (isInstructor) {
    nav.push({ to: `${base}/manage${search}`, label: 'Manage course', icon: Settings })
  }

  return (
    <AppShell
      subtitle={home ? home.course.code : 'Course'}
      navLabel="Course"
      navHeading="Workspace"
      nav={nav}
      sidebarExtra={
        <>
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
        </>
      }
    >
      {sample && (
        <p className="ws-sample-banner" role="note">
          Showing sample cases, activity, and deadlines (development preview).
        </p>
      )}
      {error ? (
        <main className="ws-page">
          <h1 className="ws-title">
            {error === 'Course not found.' ? 'Course not found' : 'Something went wrong'}
          </h1>
          <p className="ws-subtle">
            {error === 'Course not found.'
              ? 'This course does not exist, or you are not a member of it.'
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
        <Outlet context={{ home, search, reloadHome } satisfies WorkspaceContext} />
      )}
    </AppShell>
  )
}
