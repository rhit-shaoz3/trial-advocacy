import { apiRequest } from '../api/request'
import type { CourseService } from './types'

const coursePath = (courseId: string) => `/courses/${encodeURIComponent(courseId)}`
const casePath = (courseId: string, caseId: string) =>
  `${coursePath(courseId)}/cases/${encodeURIComponent(caseId)}`
const teamsPath = (courseId: string, caseId: string) => `${casePath(courseId, caseId)}/teams`
const myCasePath = (courseId: string, caseId: string) =>
  `${coursePath(courseId)}/my-cases/${encodeURIComponent(caseId)}`
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

  async listMaterials(courseId, caseId) {
    return (await apiRequest(`${casePath(courseId, caseId)}/materials`)).materials
  },

  async uploadMaterial(courseId, caseId, file, { audience, description }) {
    // The raw file is the body; headers are ASCII-only, so text in them is URI-encoded.
    const query = new URLSearchParams({ audience })
    const body = await apiRequest(`${casePath(courseId, caseId)}/materials?${query}`, {
      method: 'POST',
      body: file,
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Filename': encodeURIComponent(file.name),
        'X-Description': encodeURIComponent(description),
      },
    })
    return body.material
  },

  async updateMaterial(courseId, caseId, materialId, input) {
    const body = await apiRequest(`${casePath(courseId, caseId)}/materials/${encodeURIComponent(materialId)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
    return body.material
  },

  async deleteMaterial(courseId, caseId, materialId) {
    await apiRequest(`${casePath(courseId, caseId)}/materials/${encodeURIComponent(materialId)}`, {
      method: 'DELETE',
    })
  },

  materialDownloadUrl(courseId, caseId, materialId) {
    return `/api${casePath(courseId, caseId)}/materials/${encodeURIComponent(materialId)}/file`
  },

  async listWitnesses(courseId, caseId) {
    return (await apiRequest(`${casePath(courseId, caseId)}/witnesses`)).witnesses
  },

  async createWitness(courseId, caseId, input) {
    const body = await apiRequest(`${casePath(courseId, caseId)}/witnesses`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return body.witness
  },

  async updateWitness(courseId, caseId, witnessId, input) {
    const body = await apiRequest(`${casePath(courseId, caseId)}/witnesses/${encodeURIComponent(witnessId)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
    return body.witness
  },

  async deleteWitness(courseId, caseId, witnessId) {
    await apiRequest(`${casePath(courseId, caseId)}/witnesses/${encodeURIComponent(witnessId)}`, {
      method: 'DELETE',
    })
  },

  async listTasks(courseId, caseId) {
    return (await apiRequest(`${casePath(courseId, caseId)}/tasks`)).tasks
  },

  async createTask(courseId, caseId, input) {
    const body = await apiRequest(`${casePath(courseId, caseId)}/tasks`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return body.task
  },

  async updateTask(courseId, caseId, taskId, input) {
    const body = await apiRequest(`${casePath(courseId, caseId)}/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
    return body.task
  },

  async deleteTask(courseId, caseId, taskId) {
    await apiRequest(`${casePath(courseId, caseId)}/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' })
  },

  async saveInstructorNote(courseId, caseId, note) {
    const body = await apiRequest(`${casePath(courseId, caseId)}/note`, {
      method: 'PUT',
      body: JSON.stringify({ note }),
    })
    return body.case
  },

  async getLaunchChecks(courseId, caseId) {
    return (await apiRequest(`${casePath(courseId, caseId)}/launch`)).checks
  },

  async launchCase(courseId, caseId) {
    return (await apiRequest(`${casePath(courseId, caseId)}/launch`, { method: 'POST' })).case
  },

  async previewWorkspace(courseId, caseId, side, matchupId) {
    const query = new URLSearchParams({ side, ...(matchupId ? { matchup: matchupId } : {}) })
    return (await apiRequest(`${casePath(courseId, caseId)}/preview?${query}`)).workspace
  },

  async listMyCases(courseId) {
    return (await apiRequest(`${coursePath(courseId)}/my-cases`)).cases
  },

  async getMyCaseWorkspace(courseId, caseId) {
    return (await apiRequest(myCasePath(courseId, caseId))).workspace
  },

  async setTaskDone(courseId, caseId, taskId, done) {
    const body = await apiRequest(`${myCasePath(courseId, caseId)}/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PUT',
      body: JSON.stringify({ done }),
    })
    return body.workspace
  },

  myMaterialDownloadUrl(courseId, caseId, materialId) {
    return `/api${myCasePath(courseId, caseId)}/materials/${encodeURIComponent(materialId)}/file`
  },
}
