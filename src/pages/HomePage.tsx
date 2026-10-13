import { useAuth } from '../auth/useAuth'
import { InstructorDashboard } from './InstructorDashboard'
import { StudentDashboard } from './StudentDashboard'

export function HomePage() {
  const { user } = useAuth()
  if (!user) return null

  return user.role === 'student' ? <StudentDashboard /> : <InstructorDashboard />
}
