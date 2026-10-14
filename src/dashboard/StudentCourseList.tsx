import { ChevronRight, GraduationCap, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import type { Course, StudentInbox } from '../courses/types'
import { JoinCourseDialog } from './JoinCourseDialog'

interface Props {
  courses: Course[] | null
  inbox: StudentInbox | null
  onJoined(): void
}

/** "Courses" card: joined courses, ones waiting for approval, and the Add course button. */
export function StudentCourseList({ courses, inbox, onJoined }: Props) {
  const [joining, setJoining] = useState(false)
  const pending = inbox?.pendingRequests ?? []

  return (
    <section className="ws-panel case-panel" aria-labelledby="courses-heading">
      <div className="case-panel-head">
        <h2 id="courses-heading">Courses</h2>
        <button type="button" className="ws-btn ws-btn-secondary case-btn-sm" onClick={() => setJoining(true)}>
          <Plus size={16} aria-hidden /> Add course
        </button>
      </div>

      {courses?.length === 0 && pending.length === 0 && (
        <p className="case-hint">You're not in any courses yet. Ask your instructor for the course code.</p>
      )}

      <ul className="case-rows">
        {courses?.map((course) => (
          <li key={course.id}>
            <span className="ws-icon-tile ws-tone-blue" aria-hidden>
              <GraduationCap size={18} />
            </span>
            <Link to={`/courses/${course.id}`} className="case-row-main case-row-link">
              <span>
                {course.code}: {course.title}
              </span>
              <span>
                {course.term}
                {course.instructorName && ` · ${course.instructorName}`}
              </span>
            </Link>
            <ChevronRight size={18} className="muted" aria-hidden />
          </li>
        ))}
        {pending.map((p) => (
          <li key={p.courseId}>
            <span className="ws-icon-tile ws-tone-amber" aria-hidden>
              <GraduationCap size={18} />
            </span>
            <span className="case-row-main">
              <span>{p.courseName}</span>
            </span>
            <span className="case-badge case-badge-muted">Waiting for instructor approval</span>
          </li>
        ))}
      </ul>

      {joining && <JoinCourseDialog onClose={() => setJoining(false)} onJoined={onJoined} />}
    </section>
  )
}
