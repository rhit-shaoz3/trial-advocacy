import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import './Modal.css'

/**
 * A dialog over the page (the browser's own <dialog>, so Escape and focus
 * work): an icon, a small label, a title, the content, and buttons at the
 * bottom. Closing it any way calls `onClose`.
 */
export function Modal({
  eyebrow,
  title,
  icon,
  footer,
  wide = false,
  onClose,
  children,
}: {
  eyebrow?: string
  title: string
  icon?: ReactNode
  /** Buttons along the bottom. */
  footer?: ReactNode
  /** Nearly the full window, for showing a document. */
  wide?: boolean
  onClose(): void
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className={wide ? 'modal modal-wide' : 'modal'}
      aria-labelledby={titleId}
      onClose={onClose}
      // A click on the backdrop lands on the dialog itself.
      onClick={(e) => e.target === e.currentTarget && dialogRef.current?.close()}
    >
      <div className="modal-panel">
        <header className={icon ? 'modal-head modal-head-icon' : 'modal-head'}>
          {icon && (
            <span className="modal-icon" aria-hidden="true">
              {icon}
            </span>
          )}
          <div>
            {eyebrow && <span className="ws-eyebrow">{eyebrow}</span>}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button type="button" className="modal-close" aria-label="Close" onClick={() => dialogRef.current?.close()}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </dialog>
  )
}
