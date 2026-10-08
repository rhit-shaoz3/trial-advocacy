import './App.css'
import { useAuth } from './auth/useAuth'
import { AuthPage } from './pages/AuthPage'
import { HomePage } from './pages/HomePage'

function App() {
  const { user, loading } = useAuth()

  if (loading) return null
  return user ? <HomePage /> : <AuthPage />
}

export default App
