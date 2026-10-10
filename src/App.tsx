import { LayoutDashboard } from 'lucide-react'
import { Outlet, Route, Routes } from 'react-router'
import { useAuth } from './auth/useAuth'
import { AppShell } from './components/AppShell'
import { AuthPage } from './pages/AuthPage'
import { CoursePage } from './pages/CoursePage'
import { HomePage } from './pages/HomePage'
import { NotFoundPage } from './pages/NotFoundPage'
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

  return (
    <Routes>
      {user.role === 'student' && (
        // Inside a course, students get the course workspace's own navigation.
        <Route path="courses/:courseId" element={<WorkspaceLayout />}>
          <Route index element={<CourseDashboard />} />
          <Route path="cases" element={<ComingSoon title="My cases" />} />
          <Route path="cases/:caseId" element={<ComingSoon title="Case workspace" />} />
          <Route path="calendar" element={<ComingSoon title="Calendar" />} />
          <Route path="resources" element={<ComingSoon title="Resource library" />} />
          <Route
            path="*"
            element={<ComingSoon title="Page not found" message="That page does not exist." />}
          />
        </Route>
      )}
      <Route element={<SignedInLayout />}>
        <Route index element={<HomePage />} />
        {user.role === 'instructor' && <Route path="courses/:courseId" element={<CoursePage />} />}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

export default App
