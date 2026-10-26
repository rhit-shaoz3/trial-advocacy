import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { X } from 'lucide-react'
import './Toasts.css'

/** Notifications stacked in the upper right corner of the page. */
export function Toasts({ children }: { children: ReactNode }) {
  return (
    <div className="toasts" aria-label="Notifications">
      {children}
    </div>
  )
}

/**
 * One notification: an icon, a short title, and a button that goes to it. It
 * can be dismissed for this visit; it comes back on the next one while there's
 * still something new.
 */
export function Toast({
  icon,
  title,
  action,
}: {
  icon: ReactNode
  title: string
  /** The button: a link, or a click handler. */
  action: { label: string; to: string } | { label: string; onClick(): void }
}) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null
  return (
    <div className="toast" role="status">
      <span className="toast-icon" aria-hidden="true">
        {icon}
      </span>
      <strong>{title}</strong>
      {'to' in action ? (
        <Link to={action.to} className="ws-btn ws-btn-primary toast-action">
          {action.label}
        </Link>
      ) : (
        <button type="button" className="ws-btn ws-btn-primary toast-action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
      <button type="button" className="toast-close" aria-label={`Dismiss: ${title}`} onClick={() => setDismissed(true)}>
        <X aria-hidden="true" />
      </button>
    </div>
  )
}
