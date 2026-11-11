import { createContext } from 'react'
import type { LogInInput, ProfileInput, Role, SignUpInput, User } from './types'

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
  /** The demo account: becomes its instructor or its student; resolves to who they are now. */
  switchDemo(as: Role): Promise<User | null>
  /** The demo account: rebuilds the demo case world; resolves to the user, with the new case. */
  resetDemo(): Promise<User | null>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
