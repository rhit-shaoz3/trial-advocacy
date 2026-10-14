import { apiRequest } from '../api/request'
import type { CourseService } from './types'

const coursePath = (courseId: string) => `/courses/${encodeURIComponent(courseId)}`
const casePath = (courseId: string, caseId: string) =>
  `${coursePath(courseId)}/cases/${encodeURIComponent(caseId)}`
const teamsPath = (courseId: string, caseId: string) => `${casePath(courseId, caseId)}/teams`
const matchupsPath = (courseId: string, caseId: string) => `${casePath(courseId, caseId)}/matchups`

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

  async listCases(courseId) {
    return (await apiRequest(`${coursePath(courseId)}/cases`)).cases
  },

  async createCase(courseId, input) {
    const body = await apiRequest(`${coursePath(courseId)}/cases`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return body.case
  },

  async getCase(courseId, caseId) {
    return (await apiRequest(casePath(courseId, caseId))).case
  },

  async updateCase(courseId, caseId, input) {
    const body = await apiRequest(casePath(courseId, caseId), {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
    return body.case
  },

  async deleteCase(courseId, caseId) {
    await apiRequest(casePath(courseId, caseId), { method: 'DELETE' })
  },

  async listTeams(courseId, caseId) {
    return apiRequest(teamsPath(courseId, caseId))
  },

  async createTeam(courseId, caseId, emails) {
    return apiRequest(teamsPath(courseId, caseId), {
      method: 'POST',
      body: JSON.stringify({ emails }),
    })
  },

  async autoPair(courseId, caseId) {
    return apiRequest(`${teamsPath(courseId, caseId)}/auto`, { method: 'POST' })
  },

  async clearTeams(courseId, caseId) {
    return apiRequest(teamsPath(courseId, caseId), { method: 'DELETE' })
  },

  async deleteTeam(courseId, caseId, teamId) {
    return apiRequest(`${teamsPath(courseId, caseId)}/${encodeURIComponent(teamId)}`, {
      method: 'DELETE',
    })
  },

  async addTeamMember(courseId, caseId, teamId, email) {
    return apiRequest(`${teamsPath(courseId, caseId)}/${encodeURIComponent(teamId)}/members`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    })
  },

  async removeTeamMember(courseId, caseId, teamId, email) {
    const path = `${teamsPath(courseId, caseId)}/${encodeURIComponent(teamId)}/members/${encodeURIComponent(email)}`
    return apiRequest(path, { method: 'DELETE' })
  },

  async createMatchup(courseId, caseId, plaintiffTeamId, defenseTeamId) {
    return apiRequest(matchupsPath(courseId, caseId), {
      method: 'POST',
      body: JSON.stringify({ plaintiffTeamId, defenseTeamId }),
    })
  },

  async autoMatch(courseId, caseId) {
    return apiRequest(`${matchupsPath(courseId, caseId)}/auto`, { method: 'POST' })
  },

  async clearMatchups(courseId, caseId) {
    return apiRequest(matchupsPath(courseId, caseId), { method: 'DELETE' })
  },

  async swapSides(courseId, caseId, matchupId) {
    return apiRequest(`${matchupsPath(courseId, caseId)}/${encodeURIComponent(matchupId)}/swap`, {
      method: 'POST',
    })
  },

  async deleteMatchup(courseId, caseId, matchupId) {
    return apiRequest(`${matchupsPath(courseId, caseId)}/${encodeURIComponent(matchupId)}`, {
      method: 'DELETE',
    })
  },

  async listMyCases(courseId) {
    return (await apiRequest(`${coursePath(courseId)}/my-cases`)).cases
  },
}
