import { LogOut, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router'
import { AccountDialog } from '../account/AccountDialog'
import { useAuth } from '../auth/useAuth'
import { Avatar } from './Avatar'
import { BrandIcon } from './BrandIcon'
import { inSection, lastPlace, pathOf, rememberPlace } from './lastPlace'
import './AppShell.css'
import { ThemeToggle } from '../theme/ThemeToggle'
import { TourButton } from '../tour/TourButton'

export interface ShellNavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Only active on an exact match (for links to a section's root). */
  end?: boolean
  /** A count shown beside the label, e.g. items waiting for review. */
  badge?: number
  /** Marks the link for guided tours to point at: [data-tour="nav-<tourId>"]. */
  tourId?: string
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
  const { pathname, search } = useLocation()
  const [accountOpen, setAccountOpen] = useState(false)
  const userId = user?.id

  // Remembers where the user is in a section, for its link to come back to.
  // A link to a section's start only (`end`, like the dashboard) has nothing to remember.
  const here = nav.find((item) => !item.end && inSection(pathname, pathOf(item.to)))
  const section = here && pathOf(here.to)
  useEffect(() => {
    if (userId && section) rememberPlace(userId, section, pathname + search)
  }, [userId, section, pathname, search])

  if (!user) return null

  /** A section's link goes back to where the user left it, or, from inside the section, to its start. */
  const linkTo = ({ to, end }: ShellNavItem) =>
    end || inSection(pathname, pathOf(to)) ? to : (lastPlace(user.id, pathOf(to)) ?? to)

  async function handleLogOut() {
    await logOut()
    // So the next person to log in starts on their dashboard, not this page.
    navigate('/')
  }

  return (
    <div className="ws">
      <aside className="ws-sidebar">
        <Link to="/" className="ws-brand">
          <BrandIcon className="ws-brand-icon" />
          <span>
            <strong>Getting to Trial</strong>
            <small>{subtitle}</small>
          </span>
        </Link>

        <nav aria-label={navLabel}>
          <span className="ws-nav-label">{navHeading}</span>
          {nav.map((item) => {
            const { label, icon: Icon, end, badge, tourId } = item
            return (
              <NavLink
                key={label}
                to={linkTo(item)}
                end={end}
                aria-label={badge ? `${label}, ${badge} waiting` : undefined}
                data-tour={tourId ? `nav-${tourId}` : undefined}
              >
                <Icon aria-hidden="true" />
                {label}
                {badge ? <span className="ws-nav-badge">{badge}</span> : null}
              </NavLink>
            )
          })}
        </nav>

        <div className="ws-sidebar-bottom">
          {sidebarExtra}
          <ThemeToggle />
          <div className="ws-profile">
            <button
              type="button"
              className="ws-profile-open"
              aria-haspopup="dialog"
              title="Your account"
              onClick={() => setAccountOpen(true)}
            >
              <Avatar name={user.name} src={user.avatarUrl} />
              <span>
                <strong>{user.name}</strong>
                <small>{user.role === 'student' ? 'Student' : 'Instructor'}</small>
              </span>
            </button>
            <button type="button" className="ws-profile-logout" onClick={handleLogOut} aria-label="Log out" title="Log out">
              <LogOut aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>

      <div className="ws-main">
        {/* The guided tour, in the page's upper right corner. */}
        <div className="ws-corner">
          <TourButton />
        </div>
        {children}
      </div>
      {accountOpen && <AccountDialog onClose={() => setAccountOpen(false)} />}
    </div>
  )
}
