import type { AuthService, LogInInput, SignUpInput, User } from './types'

// MOCK ONLY: users live in this browser's localStorage and passwords are
// neither stored nor checked. Replace with a real backend before any real use.

const USERS_KEY = 'trial-advocacy:users'
const SESSION_KEY = 'trial-advocacy:session'

function readUsers(): User[] {
  try {
    const raw = localStorage.getItem(USERS_KEY)
    return raw ? (JSON.parse(raw) as User[]) : []
  } catch {
    return []
  }
}

function writeUsers(users: User[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users))
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export const mockAuthService: AuthService = {
  async getCurrentUser() {
    const id = localStorage.getItem(SESSION_KEY)
    if (!id) return null
    return readUsers().find((u) => u.id === id) ?? null
  },

  async signUp({ name, email, role }: SignUpInput) {
    const users = readUsers()
    const normalized = normalizeEmail(email)
    if (users.some((u) => u.email === normalized)) {
      throw new Error('An account with that email already exists.')
    }
    const user: User = {
      id: crypto.randomUUID(),
      name: name.trim(),
      email: normalized,
      role,
      createdAt: new Date().toISOString(),
    }
    writeUsers([...users, user])
    localStorage.setItem(SESSION_KEY, user.id)
    return user
  },

  async logIn({ email }: LogInInput) {
    const user = readUsers().find((u) => u.email === normalizeEmail(email))
    if (!user) {
      throw new Error('No account found with that email.')
    }
    localStorage.setItem(SESSION_KEY, user.id)
    return user
  },

  async logOut() {
    localStorage.removeItem(SESSION_KEY)
  },
}
