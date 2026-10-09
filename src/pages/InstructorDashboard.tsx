import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { CourseGrid } from '../components/CourseGrid'
import { useCourseService } from '../courses/CourseServiceContext'
import type { TaughtCourse } from '../courses/types'
import { CourseForm } from './course/CourseForm'
import './Dashboard.css'

function pluralize(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export function InstructorDashboard() {
  const service = useCourseService()
  const navigate = useNavigate()
  const [courses, setCourses] = useState<TaughtCourse[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    service
      .listTaughtCourses()
      .then((list) => !cancelled && setCourses(list))
      .catch((err: Error) => !cancelled && setLoadError(err.message))
    return () => {
      cancelled = true
    }
  }, [service])

  return (
    <main className="page">
      <div className="page-header">
        <h1>Your courses</h1>
        {!createOpen && (
          <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
            Create course
          </button>
        )}
      </div>

      {createOpen && (
        <CourseForm
          label="Create course"
          submitLabel="Create"
          submittingLabel="Creating…"
          onSubmit={async (input) => {
            const course = await service.createCourse(input)
            navigate(`/courses/${course.id}`)
          }}
          onCancel={() => setCreateOpen(false)}
        />
      )}

      {loadError ? (
        <p className="form-error" role="alert">
          Could not load your courses. {loadError}
        </p>
      ) : courses === null ? (
        <p className="muted">Loading courses…</p>
      ) : courses.length === 0 ? (
        <div className="dashboard-empty">
          <p>You haven't created any courses yet.</p>
          <p className="muted">
            Create one to get an entry code for your students and a place for your fact patterns.
          </p>
        </div>
      ) : (
        <CourseGrid
          courses={courses}
          renderCard={(course) => (
            <Link to={`/courses/${course.id}`} className="course-card">
              <span className="course-code">{course.code}</span>
              <span className="course-title">{course.title}</span>
              <span className="course-meta">{pluralize(course.studentCount, 'student')}</span>
            </Link>
          )}
        />
      )}
    </main>
  )
}
