import { useAuth } from '../auth/useAuth'
import './NavBar.css'

export function NavBar() {
  const { user, logOut } = useAuth()
  if (!user) return null

  return (
    <header className="navbar">
      <div className="navbar-inner">
        <span className="navbar-brand">Trial Advocacy</span>
        <nav aria-label="Main">
          <a href="/" className="navbar-link" aria-current="page">
            Courses
          </a>
        </nav>
        <div className="navbar-user">
          <span className="navbar-name">{user.name}</span>
          <span className="navbar-role">{user.role === 'student' ? 'Student' : 'Instructor'}</span>
          <button type="button" className="navbar-logout" onClick={logOut}>
            Log out
          </button>
        </div>
      </div>
    </header>
  )
}
