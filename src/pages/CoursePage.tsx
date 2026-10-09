import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useCourseService } from '../courses/CourseServiceContext'
import type { TaughtCourse } from '../courses/types'
import { CourseForm } from './course/CourseForm'
import { FactPatternsSection } from './course/FactPatternsSection'
import { RosterSection } from './course/RosterSection'
import { NotFoundPage } from './NotFoundPage'
import './CoursePage.css'

/** The instructor's page for managing one course. */
export function CoursePage() {
  const { courseId = '' } = useParams()
  const service = useCourseService()
  const [course, setCourse] = useState<TaughtCourse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const navigate = useNavigate()

  async function handleDelete() {
    if (!course) return
    const confirmed = window.confirm(
      `Delete ${course.code}: ${course.title}? This also removes its student roster and all fact ` +
        'patterns, and the entry code stops working. This cannot be undone.',
    )
    if (!confirmed) return
    setDeleteError(null)
    setDeleting(true)
    try {
      await service.deleteCourse(course.id)
      navigate('/')
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Something went wrong.')
      setDeleting(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setCourse(null)
    setLoadError(null)
    service
      .getCourse(courseId)
      .then((c) => !cancelled && setCourse(c))
      .catch((err: Error) => !cancelled && setLoadError(err.message))
    return () => {
      cancelled = true
    }
  }, [service, courseId])

  if (loadError === 'Course not found.') {
    return <NotFoundPage message="That course does not exist, or you do not teach it." />
  }

  return (
    <main className="page">
      <Link to="/" className="back-link">
        ← All courses
      </Link>

      {loadError ? (
        <p className="form-error" role="alert">
          Could not load this course. {loadError}
        </p>
      ) : !course ? (
        <p className="muted">Loading course…</p>
      ) : (
        <>
          {editing ? (
            <CourseForm
              initial={course}
              label="Edit course"
              submitLabel="Save"
              submittingLabel="Saving…"
              onSubmit={async (input) => {
                setCourse(await service.updateCourse(course.id, input))
                setEditing(false)
              }}
              onCancel={() => {
                setEditing(false)
                setDeleteError(null)
              }}
            >
              <button
                type="button"
                className="btn-danger delete-course"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Delete course'}
              </button>
              {deleteError && (
                <p className="form-error" role="alert">
                  {deleteError}
                </p>
              )}
            </CourseForm>
          ) : (
            <header className="course-header">
              <div>
                <h1>
                  {course.code}: {course.title}
                </h1>
                <p className="muted">
                  {course.term}
                  {' · '}
                  <button type="button" className="link-button" onClick={() => setEditing(true)}>
                    Edit course
                  </button>
                </p>
              </div>
              <EntryCode code={course.entryCode} />
            </header>
          )}

          <RosterSection courseId={course.id} />
          <FactPatternsSection courseId={course.id} />
        </>
      )}
    </main>
  )
}

function EntryCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked; the code is on screen to copy by hand.
    }
  }

  return (
    <div className="entry-code">
      <span className="entry-code-label">Entry code</span>
      <span className="entry-code-value">{code}</span>
      <button type="button" className="btn-secondary" onClick={copy}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
