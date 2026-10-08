import { useAuth } from '../auth/useAuth'

export function HomePage() {
  const { user, logOut } = useAuth()
  if (!user) return null

  return (
    <main className="app">
      <h1>Welcome, {user.name}</h1>
      <p>
        Signed in as <strong>{user.email}</strong> ({user.role})
      </p>
      <p className="hint">Case worlds will live here.</p>
      <button type="button" className="logout" onClick={logOut}>
        Log out
      </button>
    </main>
  )
}
