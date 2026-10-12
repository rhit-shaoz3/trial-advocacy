import { request } from '../api/request'
import type { ClassesApi } from './types'

const post = (path: string, body?: unknown) =>
  request(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

export const httpClassesApi: ClassesApi = {
  async listInstructorClasses() {
    return (await request('/classes')).classes
  },

  async createClass(input) {
    return post('/classes', input)
  },

  async decideRequests(classId, userIds, decision) {
    await post(`/classes/${classId}/requests`, { userIds, decision })
  },

  async listStudentClasses() {
    return (await request('/classes')).classes
  },

  async getInbox() {
    return request('/classes/inbox')
  },

  async joinClass(code) {
    return post('/classes/join', { code })
  },

  async acceptInvitation(id) {
    await post(`/classes/invitations/${id}/accept`)
  },

  async rejectInvitation(id) {
    await post(`/classes/invitations/${id}/reject`)
  },

  async dismissDenial(classId) {
    await post(`/classes/denials/${classId}/dismiss`)
  },
}
