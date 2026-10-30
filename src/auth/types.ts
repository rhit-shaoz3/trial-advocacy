import type { Palette } from '../theme/theme'

export type Role = 'student' | 'instructor'

export interface User {
  id: string
  name: string
  email: string
  role: Role
  /** The colour theme picked on the account page. */
  theme: Palette
  /** Their profile picture, or null to show initials. */
  avatarUrl: string | null
  /**
   * The guided tours they've been shown: tour key -> when it first started.
   * The server always sends it; without it, no tour starts on its own.
   */
  toursSeen?: Record<string, string>
  createdAt: string
}

/** What the account page can change. */
export interface ProfileInput {
  name?: string
  theme?: Palette
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
  updateProfile(input: ProfileInput): Promise<User>
  /** Replaces the profile picture with this (already cropped) PNG or JPEG. */
  uploadAvatar(image: Blob): Promise<User>
  removeAvatar(): Promise<User>
  /** Remembers that a guided tour was shown (by its key), so it doesn't start on its own again. */
  markTourSeen?(key: string): Promise<User>
}
