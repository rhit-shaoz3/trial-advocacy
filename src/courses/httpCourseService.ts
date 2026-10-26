import { apiRequest } from '../api/request'
import type { CourseService, InterviewAs } from './types'

const coursePath = (courseId: string) => `/courses/${encodeURIComponent(courseId)}`
const casePath = (courseId: string, caseId: string) =>
  `${coursePath(courseId)}/cases/${encodeURIComponent(caseId)}`
const teamsPath = (courseId: string, caseId: string) => `${casePath(courseId, caseId)}/teams`
const myCasePath = (courseId: string, caseId: string) =>
  `${coursePath(courseId)}/my-cases/${encodeURIComponent(caseId)}`
const matchupsPath = (courseId: string, caseId: string) => `${casePath(courseId, caseId)}/matchups`
const reviewsPath = (courseId: string) => `${coursePath(courseId)}/reviews`
/** A team's interview lives under my-cases; the instructor's test one under the case, by side. */
function interviewPath(courseId: string, caseId: string, witnessId: string, as: InterviewAs, action = '') {
  const base = as === 'team' ? myCasePath(courseId, caseId) : casePath(courseId, caseId)
  const path = `${base}/witnesses/${encodeURIComponent(witnessId)}/interview${action}`
  return as === 'team' ? path : `${path}?side=${as}`
}

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

  async reachSetupStep(courseId, caseId, step) {
    const body = await apiRequest(`${casePath(courseId, caseId)}/setup`, { method: 'PUT', body: JSON.stringify({ step }) })
    return body.case
  },

  async completeSetup(courseId, caseId) {
    return (await apiRequest(`${casePath(courseId, caseId)}/setup/complete`, { method: 'POST' })).case
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

  async autoPair(courseId, caseId, teamSize = 2) {
    return apiRequest(`${teamsPath(courseId, caseId)}/auto`, { method: 'POST', body: JSON.stringify({ teamSize }) })
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
    const materials = `${casePath(courseId, caseId)}/materials`
    // 1. The API approves the file and returns a signed upload link (S3 in production).
    const { upload } = await apiRequest(`${materials}/uploads`, {
      method: 'POST',
      body: JSON.stringify({ filename: file.name, size: file.size }),
    })
    // 2. The file goes straight to storage, not through the API.
    let res: Response
    try {
      res = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: file })
    } catch {
      throw new Error('Could not reach file storage. Check your connection and try again.')
    }
    if (!res.ok) throw new Error(`File storage refused the upload (${res.status}). Try again.`)
    // 3. The API checks the stored file and adds it to the case file.
    const body = await apiRequest(materials, {
      method: 'POST',
      body: JSON.stringify({ uploadKey: upload.key, filename: file.name, audience, description }),
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

  async setInitialMaterial(courseId, caseId, materialId) {
    const body = await apiRequest(`${casePath(courseId, caseId)}/materials/initial`, {
      method: 'PUT',
      body: JSON.stringify({ materialId }),
    })
    return body.materials
  },

  async setMaterialShares(courseId, caseId, materialId, shares) {
    const body = await apiRequest(`${casePath(courseId, caseId)}/materials/${encodeURIComponent(materialId)}/shares`, {
      method: 'PUT',
      body: JSON.stringify(shares),
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

  materialTextUrl(courseId, caseId, materialId) {
    return `/api${casePath(courseId, caseId)}/materials/${encodeURIComponent(materialId)}/text`
  },

  async retryTranscription(courseId, caseId, materialId) {
    const body = await apiRequest(`${casePath(courseId, caseId)}/materials/${encodeURIComponent(materialId)}/text`, {
      method: 'POST',
    })
    return body.material
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

  async uploadWitnessAvatar(courseId, caseId, witnessId, image) {
    const body = await apiRequest(`${casePath(courseId, caseId)}/witnesses/${encodeURIComponent(witnessId)}/avatar`, {
      method: 'PUT',
      body: image,
      headers: { 'Content-Type': image.type },
    })
    return body.witness
  },

  async removeWitnessAvatar(courseId, caseId, witnessId) {
    const body = await apiRequest(`${casePath(courseId, caseId)}/witnesses/${encodeURIComponent(witnessId)}/avatar`, {
      method: 'DELETE',
    })
    return body.witness
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

  async setCasePhase(courseId, caseId, phase) {
    const body = await apiRequest(`${casePath(courseId, caseId)}/phase`, {
      method: 'PUT',
      body: JSON.stringify({ phase }),
    })
    return body.case
  },

  async saveInstructorNote(courseId, caseId, note) {
    const body = await apiRequest(`${casePath(courseId, caseId)}/note`, {
      method: 'PUT',
      body: JSON.stringify({ note }),
    })
    return body.case
  },

  async saveWitnessSettings(courseId, caseId, input) {
    const body = await apiRequest(`${casePath(courseId, caseId)}/witness-settings`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
    return body.case
  },

  async saveInvestigator(courseId, caseId, input) {
    const body = await apiRequest(`${casePath(courseId, caseId)}/investigator`, {
      method: 'PUT',
      body: JSON.stringify(input),
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

  async myMaterialText(courseId, caseId, materialId) {
    return apiRequest(`${myCasePath(courseId, caseId)}/materials/${encodeURIComponent(materialId)}/text`)
  },

  async getInterview(courseId, caseId, witnessId, as) {
    return (await apiRequest(interviewPath(courseId, caseId, witnessId, as))).interview
  },

  async askWitness(courseId, caseId, witnessId, as, question) {
    const body = await apiRequest(interviewPath(courseId, caseId, witnessId, as, '/questions'), {
      method: 'POST',
      body: JSON.stringify({ question }),
    })
    return body.interview
  },

  async endInterview(courseId, caseId, witnessId) {
    return apiRequest(interviewPath(courseId, caseId, witnessId, 'team', '/end'), { method: 'POST' })
  },

  async listMyReviews(courseId, caseId) {
    return (await apiRequest(`${myCasePath(courseId, caseId)}/reviews`)).reviews
  },

  async markReviewsSeen(courseId, caseId) {
    await apiRequest(`${myCasePath(courseId, caseId)}/reviews/seen`, { method: 'POST' })
  },

  async listMyInvestigations(courseId, caseId) {
    return (await apiRequest(`${myCasePath(courseId, caseId)}/investigator`)).investigations
  },

  async sendInvestigation(courseId, caseId, assignment) {
    const body = await apiRequest(`${myCasePath(courseId, caseId)}/investigator/requests`, {
      method: 'POST',
      body: JSON.stringify({ assignment }),
    })
    return body.investigations
  },

  async markInvestigationsSeen(courseId, caseId) {
    await apiRequest(`${myCasePath(courseId, caseId)}/investigator/seen`, { method: 'POST' })
  },

  async getExchange(courseId, caseId) {
    return apiRequest(`${casePath(courseId, caseId)}/exchange`)
  },

  async saveExchangeSettings(courseId, caseId, input) {
    const body = await apiRequest(`${casePath(courseId, caseId)}/exchange`, { method: 'PUT', body: JSON.stringify(input) })
    return body.settings
  },

  async saveDisclosures(courseId, caseId, ids) {
    const body = await apiRequest(`${casePath(courseId, caseId)}/exchange/disclosures`, {
      method: 'PUT',
      body: JSON.stringify(ids),
    })
    return body.settings
  },

  async completeExchangeSetup(courseId, caseId) {
    return apiRequest(`${casePath(courseId, caseId)}/exchange/complete`, { method: 'POST' })
  },

  async getExchangeOverview(courseId, caseId) {
    return (await apiRequest(`${casePath(courseId, caseId)}/exchange/overview`)).overview
  },

  async listExchangeRequests(courseId, caseId) {
    return (await apiRequest(`${casePath(courseId, caseId)}/exchange/requests`)).requests
  },

  async getMyExchange(courseId, caseId) {
    return (await apiRequest(`${myCasePath(courseId, caseId)}/exchange`)).exchange
  },

  async submitDisclosures(courseId, caseId, picks, heldBackReason) {
    const body = await apiRequest(`${myCasePath(courseId, caseId)}/exchange/disclosures`, {
      method: 'POST',
      body: JSON.stringify({ picks, heldBackReason }),
    })
    return body.exchange
  },

  async sendExchangeRequest(courseId, caseId, kind, items) {
    const body = await apiRequest(`${myCasePath(courseId, caseId)}/exchange/requests`, {
      method: 'POST',
      body: JSON.stringify({ kind, items }),
    })
    return body.exchange
  },

  async respondToExchangeRequest(courseId, caseId, requestId, responses) {
    const path = `${myCasePath(courseId, caseId)}/exchange/requests/${encodeURIComponent(requestId)}/responses`
    return (await apiRequest(path, { method: 'POST', body: JSON.stringify({ responses }) })).exchange
  },

  async markExchangeSeen(courseId, caseId) {
    await apiRequest(`${myCasePath(courseId, caseId)}/exchange/seen`, { method: 'POST' })
  },

  async listReviews(courseId, status) {
    return (await apiRequest(`${reviewsPath(courseId)}?status=${status}`)).reviews
  },

  async decideFact(courseId, reviewId, factId, decision) {
    const path = `${reviewsPath(courseId)}/${encodeURIComponent(reviewId)}/facts/${encodeURIComponent(factId)}`
    return (await apiRequest(path, { method: 'PUT', body: JSON.stringify({ decision }) })).review
  },

  async decideDocument(courseId, reviewId, materialId, decision) {
    const path = `${reviewsPath(courseId)}/${encodeURIComponent(reviewId)}/documents/${encodeURIComponent(materialId)}`
    return (await apiRequest(path, { method: 'PUT', body: JSON.stringify({ decision }) })).review
  },

  async completeReview(courseId, reviewId) {
    return (await apiRequest(`${reviewsPath(courseId)}/${encodeURIComponent(reviewId)}/complete`, { method: 'POST' })).review
  },

  async retryReview(courseId, reviewId) {
    return (await apiRequest(`${reviewsPath(courseId)}/${encodeURIComponent(reviewId)}/retry`, { method: 'POST' })).review
  },

  async getReviewTranscript(courseId, reviewId) {
    return apiRequest(`${reviewsPath(courseId)}/${encodeURIComponent(reviewId)}/transcript`)
  },

  async getMyReviewTranscript(courseId, caseId, reviewId) {
    return apiRequest(`${myCasePath(courseId, caseId)}/reviews/${encodeURIComponent(reviewId)}/transcript`)
  },

  async restartInterview(courseId, caseId, witnessId, as) {
    return (await apiRequest(interviewPath(courseId, caseId, witnessId, as, '/restart'), { method: 'POST' })).interview
  },
}
