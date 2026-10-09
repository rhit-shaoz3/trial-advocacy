export interface Course {
  id: string
  code: string
  title: string
  /** e.g. "Fall 2026" */
  term: string
  instructorName: string | null
}

/** Everything the UI needs from the courses backend. See `httpCourseService`. */
export interface CourseService {
  /** The current user's courses, newest term first. */
  listMyCourses(): Promise<Course[]>
  joinCourse(entryCode: string): Promise<Course>
}
