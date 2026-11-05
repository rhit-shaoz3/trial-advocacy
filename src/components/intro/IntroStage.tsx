import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { reducedMotion } from '../../pages/cases/content/liftoff'
import './intro.css'

/**
 * A short scene over the page that settles into a card: an eyebrow, a title,
 * what's new, and one button onward. The scene plays for `sceneMs` (skipped
 * with reduced motion); Escape or the button ends it (`onEnter`). It's the
 * browser's own <dialog>, so focus stays inside.
 */
export function IntroStage({
  scene,
  sceneMs = 1800,
  eyebrow,
  title,
  action,
  onEnter,
  onLanded,
  wide = false,
  children,
}: {
  /** The animation, played on its own before the card comes in. */
  scene: ReactNode
  sceneMs?: number
  eyebrow: string
  title: string
  /** The button's words, like "Dive in". */
  action: string
  onEnter(): void
  /** Called once as the card comes in (for a burst of confetti, say). */
  onLanded?(): void
  /** A wider card, for a letter. */
  wide?: boolean
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const calm = reducedMotion()
  const [landed, setLanded] = useState(calm)
  const landedRef = useRef(onLanded)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  useEffect(() => {
    if (calm) return
    const t = setTimeout(() => setLanded(true), sceneMs)
    return () => clearTimeout(t)
  }, [calm, sceneMs])

  useEffect(() => {
    if (landed && !calm) landedRef.current?.()
  }, [landed, calm])

  return (
    <dialog
      ref={dialogRef}
      className={`intro${landed ? ' intro-landed' : ''}`}
      aria-labelledby={titleId}
      // Escape closes the dialog; that's the same as going on.
      onClose={onEnter}
    >
      {!landed && (
        <div className="intro-scene" aria-hidden="true">
          {scene}
        </div>
      )}
      {/* The card is there from the start for screen readers, and comes in once the scene is done. */}
      <section className={`intro-card${wide ? ' intro-card-wide' : ''}`} aria-hidden={!landed} inert={!landed}>
        <span className="ws-eyebrow">{eyebrow}</span>
        <h2 id={titleId}>{title}</h2>
        <div className="intro-body">{children}</div>
        <div className="intro-actions">
          <button type="button" className="ws-btn ws-btn-primary intro-go" onClick={() => dialogRef.current?.close()} autoFocus={landed}>
            {action}
          </button>
        </div>
      </section>
    </dialog>
  )
}
