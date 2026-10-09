import { apiRequest } from '../api/request'
import type { AuthService, User } from './types'

/** Calls the Express API in server/. The session lives in an httpOnly cookie. */
const request = (path: string, init?: RequestInit) => apiRequest(`/auth${path}`, init)

export const httpAuthService: AuthService = {
  async getCurrentUser() {
    const body = await request('/me')
    return (body?.user as User | null) ?? null
  },

  async signUp(input) {
    const body = await request('/signup', { method: 'POST', body: JSON.stringify(input) })
    return body.user as User
  },

  async logIn(input) {
    const body = await request('/login', { method: 'POST', body: JSON.stringify(input) })
    return body.user as User
  },

  async logOut() {
    await request('/logout', { method: 'POST' })
  },
}
