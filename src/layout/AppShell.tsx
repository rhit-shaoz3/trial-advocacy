import { BookOpen, Briefcase, GraduationCap, LayoutGrid, LogOut, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { Avatar } from '../components/Avatar'
import { ThemeToggle } from '../theme/ThemeToggle'
import { NavContext } from './NavContext'
import './AppShell.css'

const NAV = {
  instructor: [
    { to: '/', label: 'Overview', icon: LayoutGrid },
    { to: '/courses', label: 'Courses', icon: GraduationCap },
    { to: '/cases', label: 'Cases', icon: Briefcase },
  ],
  student: [
    { to: '/', label: 'Overview', icon: LayoutGrid },
    { to: '/courses', label: 'My courses', icon: GraduationCap },
    { to: '/cases', label: 'My cases', icon: Briefcase },
  ],
}

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-icon" aria-hidden>
        <BookOpen size={18} strokeWidth={1.75} />
      </span>
      <span className="brand-name">Getting to Trial</span>
    </div>
  )
}

/** Sidebar + main area for every logged-in page. Pages render their own top bar. */
export function AppShell() {
  const { user, logOut } = useAuth()
  const navigate = useNavigate()
  const [navOpen, setNavOpen] = useState(false)
  const { pathname } = useLocation()

  // Close the mobile menu after navigating.
  useEffect(() => setNavOpen(false), [pathname])

  if (!user) return null
  const roleLabel = user.role === 'instructor' ? 'Instructor' : 'Student'

  async function handleLogOut() {
    await logOut()
    // So the next person to log in starts on their overview, not this page.
    navigate('/')
  }

  return (
    <NavContext.Provider value={{ openNav: () => setNavOpen(true) }}>
      <div className={`shell${navOpen ? ' nav-open' : ''}`}>
        <aside className="sidebar" aria-label="Sidebar">
          <div className="sidebar-top">
            <Brand />
            <button
              type="button"
              className="case-icon-btn sidebar-close"
              aria-label="Close menu"
              onClick={() => setNavOpen(false)}
            >
              <X size={18} />
            </button>
          </div>

          <p className="sidebar-workspace">{roleLabel} workspace</p>

          <nav aria-label="Main">
            <ul className="sidebar-nav">
              {NAV[user.role].map(({ to, label, icon: Icon }) => (
                <li key={to}>
                  <NavLink to={to} end={to === '/'}>
                    <Icon size={18} strokeWidth={1.75} aria-hidden />
                    {label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          <div className="sidebar-card">
            <p className="sidebar-card-title">A better way to practice.</p>
            <p>Build confidence, one simulation at a time.</p>
          </div>

          <div className="sidebar-bottom">
            <ThemeToggle />
            <div className="sidebar-user">
              <Avatar name={user.name} />
              <div className="case-person-text">
                <span className="sidebar-user-name">{user.name}</span>
                <span>{roleLabel}</span>
              </div>
              <button
                type="button"
                className="case-icon-btn sidebar-logout"
                aria-label="Log out"
                onClick={handleLogOut}
              >
                <LogOut size={18} />
              </button>
            </div>
          </div>
        </aside>
        {navOpen && <div className="sidebar-scrim" onClick={() => setNavOpen(false)} aria-hidden />}
        <div className="shell-main">
          <Outlet />
        </div>
      </div>
    </NavContext.Provider>
  )
}
