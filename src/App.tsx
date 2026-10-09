import { Outlet, Route, Routes } from 'react-router'
import './App.css'
import { useAuth } from './auth/useAuth'
import { NavBar } from './components/NavBar'
import { AuthPage } from './pages/AuthPage'
import { CoursePage } from './pages/CoursePage'
import { HomePage } from './pages/HomePage'
import { NotFoundPage } from './pages/NotFoundPage'

function SignedInLayout() {
  return (
    <>
      <NavBar />
      <Outlet />
    </>
  )
}

function App() {
  const { user, loading } = useAuth()

  if (loading) return null
  if (!user) return <AuthPage />

  return (
    <Routes>
      <Route element={<SignedInLayout />}>
        <Route index element={<HomePage />} />
        <Route path="courses/:courseId" element={<CoursePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

export default App
