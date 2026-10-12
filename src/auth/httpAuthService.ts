import { request } from '../api/request'
import type { AuthService, User } from './types'

export const httpAuthService: AuthService = {
  async getCurrentUser() {
    const body = await request('/auth/me')
    return (body?.user as User | null) ?? null
  },

  async signUp(input) {
    const body = await request('/auth/signup', { method: 'POST', body: JSON.stringify(input) })
    return body.user as User
  },

  async logIn(input) {
    const body = await request('/auth/login', { method: 'POST', body: JSON.stringify(input) })
    return body.user as User
  },

  async logOut() {
    await request('/auth/logout', { method: 'POST' })
  },
}
