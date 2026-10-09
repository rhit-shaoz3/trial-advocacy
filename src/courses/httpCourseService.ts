import { apiRequest } from '../api/request'
import type { Course, CourseService } from './types'

export const httpCourseService: CourseService = {
  async listMyCourses() {
    const body = await apiRequest('/courses')
    return body.courses as Course[]
  },

  async joinCourse(entryCode) {
    const body = await apiRequest('/courses/join', {
      method: 'POST',
      body: JSON.stringify({ entryCode }),
    })
    return body.course as Course
  },
}
