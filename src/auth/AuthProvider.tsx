import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AuthContext, type AuthContextValue } from './AuthContext'
import { mockAuthService } from './mockAuthService'
import type { AuthService, User } from './types'

interface Props {
  children: ReactNode
  service?: AuthService
}

export function AuthProvider({ children, service = mockAuthService }: Props) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    service
      .getCurrentUser()
      .then(setUser)
      .finally(() => setLoading(false))
  }, [service])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      signUp: async (input) => setUser(await service.signUp(input)),
      logIn: async (input) => setUser(await service.logIn(input)),
      logOut: async () => {
        await service.logOut()
        setUser(null)
      },
    }),
    [user, loading, service],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
