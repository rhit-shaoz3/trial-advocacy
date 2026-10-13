import { apiRequest } from '../api/request'
import type { CourseService } from './types'

const coursePath = (courseId: string) => `/courses/${encodeURIComponent(courseId)}`

export const httpCourseService: CourseService = {
  async listMyCourses() {
    return (await apiRequest('/courses')).courses
  },

  async joinCourse(entryCode) {
    const body = await apiRequest('/courses/join', {
      method: 'POST',
      body: JSON.stringify({ entryCode }),
    })
    return body.course
  },

  async getCourseHome(courseId) {
    return apiRequest(`${coursePath(courseId)}/home`)
  },

  async listTaughtCourses() {
    return (await apiRequest('/courses/teaching')).courses
  },

  async createCourse(input) {
    return (await apiRequest('/courses', { method: 'POST', body: JSON.stringify(input) })).course
  },

  async getCourse(courseId) {
    return (await apiRequest(coursePath(courseId))).course
  },

  async updateCourse(courseId, input) {
    const body = await apiRequest(coursePath(courseId), {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
    return body.course
  },

  async deleteCourse(courseId) {
    await apiRequest(coursePath(courseId), { method: 'DELETE' })
  },

  async listRoster(courseId) {
    return (await apiRequest(`${coursePath(courseId)}/roster`)).roster
  },

  async addStudents(courseId, emails) {
    return apiRequest(`${coursePath(courseId)}/roster`, {
      method: 'POST',
      body: JSON.stringify({ emails }),
    })
  },

  async removeStudent(courseId, email) {
    await apiRequest(`${coursePath(courseId)}/roster/${encodeURIComponent(email)}`, {
      method: 'DELETE',
    })
  },

  async listFactPatterns(courseId) {
    return (await apiRequest(`${coursePath(courseId)}/fact-patterns`)).factPatterns
  },

  async uploadFactPattern(courseId, file) {
    // The raw file is the body; headers are ASCII-only, so the name is URI-encoded.
    const body = await apiRequest(`${coursePath(courseId)}/fact-patterns`, {
      method: 'POST',
      body: file,
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Filename': encodeURIComponent(file.name),
      },
    })
    return body.factPattern
  },

  async deleteFactPattern(courseId, factPatternId) {
    await apiRequest(`${coursePath(courseId)}/fact-patterns/${encodeURIComponent(factPatternId)}`, {
      method: 'DELETE',
    })
  },

  factPatternDownloadUrl(courseId, factPatternId) {
    return `/api${coursePath(courseId)}/fact-patterns/${encodeURIComponent(factPatternId)}/file`
  },
}
