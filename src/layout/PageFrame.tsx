import { Menu } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useNav } from './NavContext'

export interface Crumb {
  label: string
  to?: string
}

/** The white top bar with breadcrumbs, then the page's content. */
export function PageFrame({ crumbs, children }: { crumbs: Crumb[]; children: ReactNode }) {
  const { openNav } = useNav()
  return (
    <>
      <header className="topbar">
        <button type="button" className="icon-btn topbar-menu" aria-label="Open menu" onClick={openNav}>
          <Menu size={20} />
        </button>
        <nav aria-label="Breadcrumb">
          <ol className="crumbs">
            {crumbs.map((c, i) => (
              <Fragment key={i}>
                {i > 0 && (
                  <li aria-hidden className="crumb-sep">
                    /
                  </li>
                )}
                <li>
                  {c.to && i < crumbs.length - 1 ? (
                    <Link to={c.to}>{c.label}</Link>
                  ) : (
                    <span aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{c.label}</span>
                  )}
                </li>
              </Fragment>
            ))}
          </ol>
        </nav>
      </header>
      <main className="page-content">{children}</main>
    </>
  )
}
