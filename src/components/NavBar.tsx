import { Link, NavLink, useNavigate } from 'react-router'
import { useAuth } from '../auth/useAuth'
import './NavBar.css'

export function NavBar() {
  const { user, logOut } = useAuth()
  const navigate = useNavigate()
  if (!user) return null

  async function handleLogOut() {
    await logOut()
    // So the next person to log in starts on their dashboard, not this page.
    navigate('/')
  }

  return (
    <header className="navbar">
      <div className="navbar-inner">
        <Link to="/" className="navbar-brand">
          Trial Advocacy
        </Link>
        <nav aria-label="Main">
          <NavLink to="/" className="navbar-link">
            Courses
          </NavLink>
        </nav>
        <div className="navbar-user">
          <span className="navbar-name">{user.name}</span>
          <span className="navbar-role">{user.role === 'student' ? 'Student' : 'Instructor'}</span>
          <button type="button" className="navbar-logout" onClick={handleLogOut}>
            Log out
          </button>
        </div>
      </div>
    </header>
  )
}
