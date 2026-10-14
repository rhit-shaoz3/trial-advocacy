import { Plus } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useLoad } from '../api/useLoad'
import { useCourseService } from '../courses/CourseServiceContext'
import { PageFrame } from '../layout/PageFrame'
import { CourseCard } from './CourseCard'
import { CreateCourseForm } from './CreateCourseForm'
import './Dashboard.css'

/** The instructor's courses: entry codes, who's waiting to be admitted, rosters, invitations. */
export function CoursesPage() {
  const service = useCourseService()
  const { data: courses, error, reload } = useLoad(useCallback(() => service.listTaughtCourses(), [service]))
  const [params] = useSearchParams()
  const [creating, setCreating] = useState(params.get('new') === '1')

  return (
    <PageFrame crumbs={[{ label: 'Instructor workspace', to: '/' }, { label: 'Courses' }]}>
      <div className="ws-welcome">
        <div>
          <h1 className="ws-title">Your courses</h1>
          <p className="ws-subtle">Create courses, share entry codes, and decide who gets in.</p>
        </div>
        {!creating && (
          <button type="button" className="ws-btn ws-btn-primary" onClick={() => setCreating(true)}>
            <Plus size={18} aria-hidden /> Create course
          </button>
        )}
      </div>

      <div className="case-stack">
        {creating && <CreateCourseForm onCreated={reload} onClose={() => setCreating(false)} />}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        {courses?.length === 0 && !creating && <p className="case-hint">You haven't created any courses yet.</p>}

        {courses?.map((course) => <CourseCard key={course.id} course={course} onChanged={reload} />)}
      </div>
    </PageFrame>
  )
}
