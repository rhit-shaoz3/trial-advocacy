import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { CourseGrid } from '../components/CourseGrid'
import { useCourseService } from '../courses/CourseServiceContext'
import type { Course } from '../courses/types'
import './Dashboard.css'

export function StudentDashboard() {
  const service = useCourseService()
  const [courses, setCourses] = useState<Course[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [joinOpen, setJoinOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    service
      .listMyCourses()
      .then((list) => !cancelled && setCourses(list))
      .catch((err: Error) => !cancelled && setLoadError(err.message))
    return () => {
      cancelled = true
    }
  }, [service])

  function handleJoined(course: Course) {
    // Re-fetch so the new course lands in the right term and order.
    setJoinOpen(false)
    service.listMyCourses().then(setCourses, () => setCourses((prev) => [course, ...(prev ?? [])]))
  }

  return (
    <main className="page">
      <div className="page-header">
        <h1>Your courses</h1>
        {!joinOpen && (
          <button type="button" className="btn-primary" onClick={() => setJoinOpen(true)}>
            Enroll in course
          </button>
        )}
      </div>

      {joinOpen && <JoinCourseForm onJoined={handleJoined} onCancel={() => setJoinOpen(false)} />}

      {loadError ? (
        <p className="form-error" role="alert">
          Could not load your courses. {loadError}
        </p>
      ) : courses === null ? (
        <p className="muted">Loading courses…</p>
      ) : courses.length === 0 ? (
        <div className="dashboard-empty">
          <p>You aren't enrolled in any courses yet.</p>
          <p className="muted">Ask your instructor for an entry code, then choose Enroll in course.</p>
        </div>
      ) : (
        <CourseGrid
          courses={courses}
          renderCard={(course) => (
            <Link to={`/courses/${course.id}`} className="course-card">
              <span className="course-code">{course.code}</span>
              <span className="course-title">{course.title}</span>
              {course.instructorName && <span className="course-meta">{course.instructorName}</span>}
            </Link>
          )}
        />
      )}
    </main>
  )
}

function JoinCourseForm({
  onJoined,
  onCancel,
}: {
  onJoined(course: Course): void
  onCancel(): void
}) {
  const service = useCourseService()
  const [entryCode, setEntryCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      onJoined(await service.joinCourse(entryCode))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setSubmitting(false)
    }
  }

  return (
    <form className="panel-form" onSubmit={handleSubmit}>
      <label>
        Course entry code
        <input
          type="text"
          className="entry-code-input"
          value={entryCode}
          onChange={(e) => setEntryCode(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
          autoFocus
        />
      </label>
      <div className="panel-form-actions">
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Joining…' : 'Join'}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}
