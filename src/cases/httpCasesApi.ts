import { request } from '../api/request'
import type { CasesApi } from './types'

const send = (method: string, path: string, body?: unknown) =>
  request(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })

/** Link target for downloading a case document. */
export function documentUrl(caseId: string, documentId: string) {
  return `/api/cases/${caseId}/documents/${documentId}/file`
}

export const httpCasesApi: CasesApi = {
  async listInstructorCases() {
    return (await request('/cases')).cases
  },

  async listStudentCases() {
    return (await request('/cases')).cases
  },

  async createCase(input) {
    return (await send('POST', '/cases', input)).case
  },

  async getInstructorCase(caseId) {
    return (await request(`/cases/${caseId}`)).case
  },

  async getStudentCase(caseId) {
    return (await request(`/cases/${caseId}`)).case
  },

  async setPublished(caseId, changes) {
    return (await send('PATCH', `/cases/${caseId}/publish`, changes)).case
  },

  async uploadDocuments(caseId, files, side) {
    const form = new FormData()
    form.append('side', side)
    for (const file of files) form.append('files', file)
    return (await request(`/cases/${caseId}/documents`, { method: 'POST', body: form })).documents
  },

  async setDocumentSide(caseId, documentId, side) {
    return (await send('PATCH', `/cases/${caseId}/documents/${documentId}`, { side })).document
  },

  async deleteDocument(caseId, documentId) {
    await send('DELETE', `/cases/${caseId}/documents/${documentId}`)
  },

  async createCharacter(caseId, input) {
    return (await send('POST', `/cases/${caseId}/characters`, input)).character
  },

  async updateCharacter(caseId, characterId, input) {
    await send('PATCH', `/cases/${caseId}/characters/${characterId}`, input)
  },

  async deleteCharacter(caseId, characterId) {
    await send('DELETE', `/cases/${caseId}/characters/${characterId}`)
  },

  async setCharacterKnows(caseId, characterId, documentId, knows) {
    await send(knows ? 'PUT' : 'DELETE', `/cases/${caseId}/characters/${characterId}/documents/${documentId}`)
  },

  async saveTeams(caseId, teams) {
    return (await send('PUT', `/cases/${caseId}/teams`, { teams })).case
  },

  async saveMatchups(caseId, matchups) {
    return (await send('PUT', `/cases/${caseId}/matchups`, { matchups })).case
  },
}
