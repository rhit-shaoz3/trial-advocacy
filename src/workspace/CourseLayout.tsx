import {
  BriefcaseBusiness,
  CalendarDays,
  LayoutDashboard,
  Library,
  Settings,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useParams, useSearchParams } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { useCourseService } from '../courses/CourseServiceContext'
import { TopBar } from '../layout/PageFrame'
import { withSampleData } from './sampleData'
import type { CourseHome } from './types'
import type { WorkspaceContext } from './useWorkspace'
import './CourseLayout.css'

interface Tab {
  to: string
  label: string
  icon: LucideIcon
  /** Only active on an exact match (for the course's own page). */
  end?: boolean
}

/**
 * One course, inside the app's sidebar: the course's name and term, then tabs
 * for its pages. Students and the course's instructor see the same pages;
 * instructors see "All cases" instead of "My cases" and get "Manage course".
 * Loads the course home once and hands it to the pages inside.
 */
export function CourseLayout() {
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
  const tabs: Tab[] = [
    { to: `${base}${search}`, label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: `${base}/cases${search}`, label: isInstructor ? 'All cases' : 'My cases', icon: BriefcaseBusiness },
    { to: `${base}/calendar${search}`, label: 'Calendar', icon: CalendarDays },
    { to: `${base}/resources${search}`, label: 'Resource library', icon: Library },
  ]
  if (isInstructor) tabs.push({ to: `${base}/manage${search}`, label: 'Manage course', icon: Settings })

  const course = home?.course
  return (
    <>
      <TopBar
        crumbs={[
          { label: isInstructor ? 'Courses' : 'My courses', to: '/courses' },
          { label: course ? `${course.code}: ${course.title}` : 'Course' },
        ]}
      />
      {course && (
        <header className="course-band">
          <div className="course-band-title">
            <span className="ws-eyebrow">{course.term}</span>
            <p className="course-band-name">
              {course.code}: {course.title}
            </p>
            {course.instructorName && <span className="ws-subtle">{course.instructorName}</span>}
          </div>
          <nav aria-label="Course" className="course-tabs">
            {tabs.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={label} to={to} end={end}>
                <Icon aria-hidden="true" />
                {label}
              </NavLink>
            ))}
          </nav>
        </header>
      )}
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
          <Link to="/courses" className="ws-btn ws-btn-secondary">
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
    </>
  )
}
