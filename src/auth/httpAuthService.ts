import type { AuthService, User } from './types'

/** Calls the Express API in server/. The session lives in an httpOnly cookie. */
async function request(path: string, init?: RequestInit) {
  let res: Response
  try {
    res = await fetch(`/api/auth${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.')
  }

  if (res.status === 204) return null
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(body?.error ?? `Request failed (${res.status}).`)
  }
  return body
}

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
