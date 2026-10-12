import { useAuth } from '../auth/useAuth'
import { InstructorCasePage } from './InstructorCasePage'
import { StudentCasePage } from './StudentCasePage'

export function CasePage() {
  const { user } = useAuth()
  return user?.role === 'instructor' ? <InstructorCasePage /> : <StudentCasePage />
}
