import { Route, Routes } from 'react-router'
import { useAuth } from './auth/useAuth'
import { InterviewPage } from './caseWorkspace/InterviewPage'
import { StudentCasePage } from './caseWorkspace/StudentCasePage'
import { CoursesPage } from './dashboard/CoursesPage'
import { InstructorOverview } from './dashboard/InstructorOverview'
import { StudentCoursesPage } from './dashboard/StudentCoursesPage'
import { StudentOverview } from './dashboard/StudentOverview'
import { AppShell } from './layout/AppShell'
import { AuthPage } from './pages/AuthPage'
import { CaseDetailPage } from './pages/cases/CaseDetailPage'
import { CaseLibraryPage } from './pages/cases/CaseLibraryPage'
import { CasesPage } from './pages/cases/CasesPage'
import { MyCasesPage } from './pages/cases/MyCasesPage'
import { CoursePage } from './pages/CoursePage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ComingSoon } from './workspace/ComingSoon'
import { CourseDashboard } from './workspace/CourseDashboard'
import { WorkspaceLayout } from './workspace/WorkspaceLayout'

function App() {
  const { user, loading } = useAuth()

  if (loading) return null
  if (!user) return <AuthPage />

  const isInstructor = user.role === 'instructor'

  return (
    <Routes>
      {/* Inside a course, everyone gets the course workspace's own navigation. */}
      <Route path="courses/:courseId" element={<WorkspaceLayout />}>
        <Route index element={<CourseDashboard />} />
        <Route path="cases" element={isInstructor ? <CasesPage /> : <MyCasesPage />} />
        <Route
          path="cases/:caseId"
          element={isInstructor ? <CaseDetailPage /> : <StudentCasePage />}
        />
        <Route path="cases/:caseId/witnesses/:witnessId" element={<InterviewPage />} />
        <Route path="calendar" element={<ComingSoon title="Calendar" />} />
        <Route path="resources" element={<ComingSoon title="Resource library" />} />
        {isInstructor && <Route path="manage" element={<CoursePage />} />}
        <Route
          path="*"
          element={<ComingSoon title="Page not found" message="That page does not exist." />}
        />
      </Route>

      {/* Everywhere else: the app sidebar (Overview, Courses, Cases). */}
      <Route element={<AppShell />}>
        <Route index element={isInstructor ? <InstructorOverview /> : <StudentOverview />} />
        <Route path="courses" element={isInstructor ? <CoursesPage /> : <StudentCoursesPage />} />
        <Route path="cases" element={<CaseLibraryPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

export default App
