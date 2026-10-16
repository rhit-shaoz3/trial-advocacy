import type { Course, CourseCase, CourseService, MyCase, TaughtCourse } from '../../courses/types'

/** One course's cases, as the instructor manages them. */
export interface TaughtCourseCases {
  course: TaughtCourse
  cases: CourseCase[]
}

/** One course's launched cases, as a student sees them. */
export interface StudentCourseCases {
  course: Course
  cases: MyCase[]
}

export const courseName = (c: Pick<Course, 'code' | 'title'>) => `${c.code}: ${c.title}`

/** Every course the instructor teaches, with its cases. */
export async function loadTaughtCases(service: CourseService): Promise<TaughtCourseCases[]> {
  const courses = await service.listTaughtCourses()
  const cases = await Promise.all(courses.map((c) => service.listCases(c.id)))
  return courses.map((course, i) => ({ course, cases: cases[i] }))
}

/** Every course the student has joined, with its launched cases. */
export async function loadStudentCases(service: CourseService): Promise<StudentCourseCases[]> {
  const courses = await service.listMyCourses()
  const cases = await Promise.all(courses.map((c) => service.listMyCases(c.id)))
  return courses.map((course, i) => ({ course, cases: cases[i] }))
}
