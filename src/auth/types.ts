export type Role = 'student' | 'instructor'

export interface User {
  id: string
  name: string
  email: string
  role: Role
  createdAt: string
}

export interface SignUpInput {
  name: string
  email: string
  password: string
  role: Role
}

export interface LogInInput {
  email: string
  password: string
}

/**
 * Everything the UI needs from an auth backend. The current implementation is
 * `httpAuthService`, which calls the Express API in server/. Pages only depend
 * on this interface, so the backend can change without touching them.
 */
export interface AuthService {
  getCurrentUser(): Promise<User | null>
  signUp(input: SignUpInput): Promise<User>
  logIn(input: LogInInput): Promise<User>
  logOut(): Promise<void>
}
