import { LogOut, Scale, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { Avatar } from './Avatar'
import './AppShell.css'

export interface ShellNavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Only active on an exact match (for links to a section's root). */
  end?: boolean
}

/**
 * The signed-in frame for every page: navy sidebar (brand, navigation,
 * profile with log out) beside the page area. Follows the Figma mock.
 */
export function AppShell({
  subtitle,
  navLabel,
  navHeading,
  nav,
  sidebarExtra,
  children,
}: {
  /** Small caps line under the brand, e.g. the course code. */
  subtitle: string
  /** Accessible name of the navigation landmark. */
  navLabel: string
  /** Small caps heading above the links. */
  navHeading: string
  nav: ShellNavItem[]
  /** Shown above the profile row, e.g. the current course. */
  sidebarExtra?: ReactNode
  children: ReactNode
}) {
  const { user, logOut } = useAuth()
  const navigate = useNavigate()
  if (!user) return null

  async function handleLogOut() {
    await logOut()
    // So the next person to log in starts on their dashboard, not this page.
    navigate('/')
  }

  return (
    <div className="ws">
      <aside className="ws-sidebar">
        <Link to="/" className="ws-brand">
          <span className="ws-brand-icon">
            <Scale aria-hidden="true" />
          </span>
          <span>
            <strong>Trial Advocacy</strong>
            <small>{subtitle}</small>
          </span>
        </Link>

        <nav aria-label={navLabel}>
          <span className="ws-nav-label">{navHeading}</span>
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={label} to={to} end={end}>
              <Icon aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="ws-sidebar-bottom">
          {sidebarExtra}
          <div className="ws-profile">
            <Avatar name={user.name} />
            <span>
              <strong>{user.name}</strong>
              <small>{user.role === 'student' ? 'Student' : 'Instructor'}</small>
            </span>
            <button type="button" onClick={handleLogOut} aria-label="Log out" title="Log out">
              <LogOut aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>

      <div className="ws-main">{children}</div>
    </div>
  )
}
