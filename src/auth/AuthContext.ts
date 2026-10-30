import { createContext } from 'react'
import type { LogInInput, ProfileInput, SignUpInput, User } from './types'

export interface AuthContextValue {
  user: User | null
  loading: boolean
  signUp(input: SignUpInput): Promise<void>
  logIn(input: LogInInput): Promise<void>
  logOut(): Promise<void>
  /** Saves name or theme changes and updates `user`. */
  updateProfile(input: ProfileInput): Promise<void>
  /** Uploads a new (cropped) profile picture. */
  uploadAvatar(image: Blob): Promise<void>
  removeAvatar(): Promise<void>
  /** Remembers that a guided tour was shown; `user.toursSeen` has it at once. */
  markTourSeen(key: string): Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
