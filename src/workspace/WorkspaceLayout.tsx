import { useEffect, useState } from 'react'
import { BriefcaseBusiness, CalendarDays, ChevronLeft, LayoutDashboard, Library } from 'lucide-react'
import { Link, Outlet, useParams, useSearchParams } from 'react-router'
import { AppShell } from '../components/AppShell'
import { useCourseService } from '../courses/CourseServiceContext'
import { withSampleData } from './sampleData'
import type { CourseHome } from './types'
import type { WorkspaceContext } from './useWorkspace'

/**
 * A student's view of one course, in the app shell with course navigation.
 * Loads the course home once and hands it to the pages inside.
 */
export function WorkspaceLayout() {
  const { courseId = '' } = useParams()
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

  const base = `/courses/${courseId}`
  const search = sample ? '?sample' : ''

  return (
    <AppShell
      subtitle={home ? home.course.code : 'Course'}
      navLabel="Course"
      navHeading="Workspace"
      nav={[
        { to: `${base}${search}`, label: 'Dashboard', icon: LayoutDashboard, end: true },
        { to: `${base}/cases${search}`, label: 'My cases', icon: BriefcaseBusiness },
        { to: `${base}/calendar${search}`, label: 'Calendar', icon: CalendarDays },
        { to: `${base}/resources${search}`, label: 'Resource library', icon: Library },
      ]}
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
    </AppShell>
  )
}
