import { apiRequest } from '../api/request'
import type { CasesApi } from './types'

const send = (method: string, path: string, body?: unknown) =>
  apiRequest(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })

/** Link target for downloading a case document. */
export function documentUrl(caseId: string, documentId: string) {
  return `/api/cases/${caseId}/documents/${documentId}/file`
}

export const httpCasesApi: CasesApi = {
  async listCourseCases(courseId) {
    return (await apiRequest(`/courses/${courseId}/cases`)).cases
  },

  async createCase(courseId, name) {
    return (await send('POST', `/courses/${courseId}/cases`, { name })).case
  },

  async getInstructorCase(caseId) {
    return (await apiRequest(`/cases/${caseId}`)).case
  },

  async getStudentCase(caseId) {
    return (await apiRequest(`/cases/${caseId}`)).case
  },

  async setPublished(caseId, changes) {
    return (await send('PATCH', `/cases/${caseId}/publish`, changes)).case
  },

  async uploadDocuments(caseId, files, side) {
    // One request per file, the same way fact patterns are uploaded: the raw
    // file is the body and its (URI-encoded) name goes in a header.
    const uploaded = []
    for (const file of files) {
      const body = await apiRequest(`/cases/${caseId}/documents?side=${side}`, {
        method: 'POST',
        body: file,
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-Filename': encodeURIComponent(file.name),
        },
      })
      uploaded.push(body.document)
    }
    return uploaded
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
