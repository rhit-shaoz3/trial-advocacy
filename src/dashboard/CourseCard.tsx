import { ArrowRight, Copy } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Link } from 'react-router'
import { useLoad } from '../api/useLoad'
import { Avatar } from '../components/Avatar'
import { useCourseService } from '../courses/CourseServiceContext'
import type { RosterEntry, TaughtCourse } from '../courses/types'
import { AdmissionTable } from './AdmissionTable'

interface Props {
  course: TaughtCourse
  onChanged(): void
}

/** One course on the Courses page, with its roster split by where each student stands. */
export function CourseCard({ course, onChanged }: Props) {
  const service = useCourseService()
  const roster = useLoad(useCallback(() => service.listRoster(course.id), [service, course.id]))
  const [copied, setCopied] = useState(false)
  const headingId = `course-heading-${course.id}`

  const entries = roster.data ?? []
  const of = (status: RosterEntry['status']) => entries.filter((e) => e.status === status)
  const joined = of('joined')
  const invited = of('invited')
  const requests = of('requested')

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(course.entryCode)
      setCopied(true)
    } catch {
      // Clipboard can be blocked; the code is on screen to copy by hand.
    }
  }

  return (
    <article id={`course-${course.id}`} className="ws-panel course-card-panel" aria-labelledby={headingId}>
      <header className="course-card-head">
        <div>
          <h2 id={headingId} className="course-card-name">
            {course.code}: {course.title}
          </h2>
          <p className="case-hint">
            {course.term} · {course.studentCount} students · {course.invitedCount} invited
          </p>
        </div>
        <div className="entry-code-pill">
          <span className="ws-eyebrow">Entry code</span>
          <strong>{course.entryCode}</strong>
          <button type="button" className="case-icon-btn" aria-label="Copy entry code" onClick={copyCode}>
            <Copy size={16} />
          </button>
          {copied && <span className="case-hint">Copied</span>}
        </div>
      </header>

      {roster.error && (
        <p className="form-error" role="alert">
          {roster.error}
        </p>
      )}

      {requests.length > 0 && (
        <AdmissionTable
          courseId={course.id}
          requests={requests}
          onDecided={() => {
            void roster.reload()
            onChanged()
          }}
        />
      )}

      <h3 className="course-card-sub">Students ({joined.length})</h3>
      {roster.data && joined.length === 0 ? (
        <p className="case-hint">No students yet. Share the entry code or invite students by email.</p>
      ) : (
        <ul className="case-rows people-rows">
          {joined.map((s) => (
            <li key={s.email}>
              <Avatar name={s.name ?? s.email} />
              <span className="case-row-main">
                <span>{s.name ?? s.email}</span>
                <span>{s.email}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {invited.length > 0 && (
        <>
          <h3 className="course-card-sub">Invited ({invited.length})</h3>
          <ul className="case-rows people-rows">
            {invited.map((inv) => (
              <li key={inv.email}>
                <Avatar name={inv.name ?? inv.email} />
                <span className="case-row-main">
                  <span>{inv.name ?? inv.email}</span>
                  {inv.name && <span>{inv.email}</span>}
                </span>
                <span className={inv.userId ? 'case-badge' : 'case-badge case-badge-muted'}>
                  {inv.userId ? 'Invited' : 'No account'}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="course-card-foot">
        <Link to={`/courses/${course.id}/manage`} className="ws-btn ws-btn-secondary">
          Manage course
        </Link>
        <Link to={`/courses/${course.id}`} className="ws-btn ws-btn-primary">
          Open course <ArrowRight size={16} aria-hidden />
        </Link>
      </div>
    </article>
  )
}
