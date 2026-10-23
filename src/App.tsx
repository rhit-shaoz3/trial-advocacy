import { LayoutDashboard } from 'lucide-react'
import { Outlet, Route, Routes } from 'react-router'
import { useAuth } from './auth/useAuth'
import { InterviewPage } from './caseWorkspace/InterviewPage'
import { StudentCasePage } from './caseWorkspace/StudentCasePage'
import { AppShell } from './components/AppShell'
import { AuthPage } from './pages/AuthPage'
import { CaseDetailPage } from './pages/cases/CaseDetailPage'
import { CasesPage } from './pages/cases/CasesPage'
import { MyCasesPage } from './pages/cases/MyCasesPage'
import { NewCasePage } from './pages/cases/setup/NewCasePage'
import { CoursePage } from './pages/CoursePage'
import { HomePage } from './pages/HomePage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ReviewPage } from './pages/review/ReviewPage'
import { ComingSoon } from './workspace/ComingSoon'
import { CourseDashboard } from './workspace/CourseDashboard'
import { WorkspaceLayout } from './workspace/WorkspaceLayout'

/** Pages outside a student's course workspace: the course list, instructor pages. */
function SignedInLayout() {
  return (
    <AppShell
      subtitle="Pretrial simulator"
      navLabel="Main"
      navHeading="Menu"
      nav={[{ to: '/', label: 'Courses', icon: LayoutDashboard, end: true }]}
    >
      <Outlet />
    </AppShell>
  )
}

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
        {isInstructor && <Route path="cases/new" element={<NewCasePage />} />}
        <Route
          path="cases/:caseId"
          element={isInstructor ? <CaseDetailPage /> : <StudentCasePage />}
        />
        <Route path="cases/:caseId/witnesses/:witnessId" element={<InterviewPage />} />
        <Route path="calendar" element={<ComingSoon title="Calendar" />} />
        <Route path="resources" element={<ComingSoon title="Resource library" />} />
        {isInstructor && <Route path="review" element={<ReviewPage />} />}
        {isInstructor && <Route path="manage" element={<CoursePage />} />}
        <Route
          path="*"
          element={<ComingSoon title="Page not found" message="That page does not exist." />}
        />
      </Route>
      <Route element={<SignedInLayout />}>
        <Route index element={<HomePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

export default App
