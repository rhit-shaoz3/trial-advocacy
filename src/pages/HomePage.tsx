import { useAuth } from '../auth/useAuth'
import { NavBar } from '../components/NavBar'
import { StudentDashboard } from './StudentDashboard'

export function HomePage() {
  const { user } = useAuth()
  if (!user) return null

  return (
    <>
      <NavBar />
      {user.role === 'student' ? (
        <StudentDashboard />
      ) : (
        <main className="app">
          <h1>Welcome, {user.name}</h1>
          <p className="hint">The instructor dashboard is coming soon.</p>
        </main>
      )}
    </>
  )
}
