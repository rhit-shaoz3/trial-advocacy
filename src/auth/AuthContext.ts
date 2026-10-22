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
}

export const AuthContext = createContext<AuthContextValue | null>(null)
