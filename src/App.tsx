import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { useAuth } from './auth/useAuth'
import { CasePage } from './cases/CasePage'
import { CasesPage } from './cases/CasesPage'
import { MatchupBuilderPage } from './cases/MatchupBuilderPage'
import { StudentCasesPage } from './cases/StudentCasesPage'
import { TeamBuilderPage } from './cases/TeamBuilderPage'
import { ClassesPage } from './dashboard/ClassesPage'
import { InstructorOverview } from './dashboard/InstructorOverview'
import { StudentClassesPage } from './dashboard/StudentClassesPage'
import { StudentOverview } from './dashboard/StudentOverview'
import { AppShell } from './layout/AppShell'
import { AuthPage } from './pages/AuthPage'

function App() {
  const { user, loading } = useAuth()

  if (loading) return null
  if (!user) return <AuthPage />
  const instructor = user.role === 'instructor'
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={instructor ? <InstructorOverview /> : <StudentOverview />} />
          <Route path="classes" element={instructor ? <ClassesPage /> : <StudentClassesPage />} />
          <Route path="cases" element={instructor ? <CasesPage /> : <StudentCasesPage />} />
          <Route path="cases/:caseId" element={<CasePage />} />
          {instructor && (
            <>
              <Route path="cases/:caseId/teams" element={<TeamBuilderPage />} />
              <Route path="cases/:caseId/matchups" element={<MatchupBuilderPage />} />
            </>
          )}
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
