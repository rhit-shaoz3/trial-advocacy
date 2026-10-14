import { Route, Routes } from 'react-router'
import { useAuth } from './auth/useAuth'
import { AllCasesPage } from './cases/AllCasesPage'
import { CasePage } from './cases/CasePage'
import { CasesListPage } from './cases/CasesListPage'
import { MatchupBuilderPage } from './cases/MatchupBuilderPage'
import { StudentCasesPage } from './cases/StudentCasesPage'
import { TeamBuilderPage } from './cases/TeamBuilderPage'
import { CoursesPage } from './dashboard/CoursesPage'
import { InstructorOverview } from './dashboard/InstructorOverview'
import { StudentCoursesPage } from './dashboard/StudentCoursesPage'
import { StudentOverview } from './dashboard/StudentOverview'
import { AppShell } from './layout/AppShell'
import { AuthPage } from './pages/AuthPage'
import { CoursePage } from './pages/CoursePage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ComingSoon } from './workspace/ComingSoon'
import { CourseDashboard } from './workspace/CourseDashboard'
import { CourseLayout } from './workspace/CourseLayout'

function App() {
  const { user, loading } = useAuth()

  if (loading) return null
  if (!user) return <AuthPage />

  const isInstructor = user.role === 'instructor'

  return (
    <Routes>
      {/* The sidebar is on every page. */}
      <Route element={<AppShell />}>
        <Route index element={isInstructor ? <InstructorOverview /> : <StudentOverview />} />
        <Route path="courses" element={isInstructor ? <CoursesPage /> : <StudentCoursesPage />} />
        <Route path="cases" element={isInstructor ? <AllCasesPage /> : <StudentCasesPage />} />

        {/* Inside a course: the course's name and tabs, then its pages. */}
        <Route path="courses/:courseId" element={<CourseLayout />}>
          <Route index element={<CourseDashboard />} />
          <Route path="cases" element={<CasesListPage />} />
          <Route path="cases/:caseId" element={<CasePage />} />
          {isInstructor && <Route path="cases/:caseId/teams" element={<TeamBuilderPage />} />}
          {isInstructor && <Route path="cases/:caseId/matchups" element={<MatchupBuilderPage />} />}
          <Route path="calendar" element={<ComingSoon title="Calendar" />} />
          <Route path="resources" element={<ComingSoon title="Resource library" />} />
          {isInstructor && <Route path="manage" element={<CoursePage />} />}
          <Route
            path="*"
            element={<ComingSoon title="Page not found" message="That page does not exist." />}
          />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

export default App
