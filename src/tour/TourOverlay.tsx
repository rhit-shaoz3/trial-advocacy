import { X } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { reducedMotion } from '../pages/cases/content/liftoff'
import { placeCard, spotlightBox, type Box, type CardPosition } from './placement'
import { findTarget, launcher } from './findTarget'
import type { Tour, TourStep } from './tourTypes'

/**
 * How long a step waits for what it points at before going on without it:
 * longer when it opens a tab or section first, which takes a moment to show.
 */
const FIND_TIMEOUT_MS = 250
const FIND_AFTER_GO_MS = 1200
const MINIMIZE_MS = 560

const raf = (cb: () => void) =>
  typeof window.requestAnimationFrame === 'function' ? window.requestAnimationFrame(cb) : window.setTimeout(cb, 16)
const cancelRaf = (id: number) =>
  typeof window.cancelAnimationFrame === 'function' ? window.cancelAnimationFrame(id) : window.clearTimeout(id)

const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}
const sameBox = (a: Box | null, b: Box | null) =>
  a === b || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height)
const viewport = () => ({ width: window.innerWidth, height: window.innerHeight })


/**
 * One step of a tour on screen: the page dimmed around a spotlight on what
 * the step is about, and a small card beside it (with an arrow at it) saying
 * what it's for. Esc or the X closes the tour, the arrow keys step through,
 * and on close the card shrinks into the tour button.
 */
export function TourOverlay({
  tour,
  steps,
  index,
  onIndex,
  onDropStep,
  onGo,
  onClosed,
}: {
  tour: Tour
  steps: TourStep[]
  index: number
  onIndex(index: number): void
  /** A step whose target isn't there; the tour carries on without it, the way it was going. */
  onDropStep(index: number, direction: 1 | -1): void
  onGo(go: NonNullable<TourStep['go']>): void
  /** After the closing animation. */
  onClosed(): void
}) {
  const id = useId()
  const step = steps[index]
  const cardRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const [found, setFound] = useState(false)
  const [box, setBox] = useState<Box | null>(null)
  const [pos, setPos] = useState<CardPosition | null>(null)
  const [closing, setClosing] = useState(false)
  const direction = useRef<1 | -1>(1)
  const last = index === steps.length - 1

  // Open the step's tab or section, then wait for its target to show up.
  useEffect(() => {
    if (!step) return
    setFound(false)
    setTarget(null)
    setBox(null)
    setPos(null)
    if (step.go) onGo(step.go)
    if (!step.target) {
      setFound(true)
      return
    }
    const selector = step.target
    const startedAt = Date.now()
    let frame = 0
    const look = () => {
      const el = findTarget(selector)
      if (el) {
        const r = el.getBoundingClientRect()
        const vp = viewport()
        if (r.top < 0 || r.bottom > vp.height || r.left < 0 || r.right > vp.width) {
          el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
        }
        setTarget(el)
        setFound(true)
      } else if (Date.now() - startedAt < (step.go ? FIND_AFTER_GO_MS : FIND_TIMEOUT_MS)) {
        frame = raf(look)
      } else if (step.ifMissing === 'center') {
        setFound(true)
      } else {
        // Not here (a tab this case doesn't have yet): go on without it.
        onDropStep(index, direction.current)
      }
    }
    look()
    return () => cancelRaf(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per step shown
  }, [step, index])

  // Follow the target as the page scrolls, resizes, or animates.
  useEffect(() => {
    if (!target) return
    let frame = 0
    let prev: Box | null = null
    const track = () => {
      const next = target.isConnected ? spotlightBox(boxOf(target), viewport()) : null
      if (!sameBox(prev, next)) {
        prev = next
        setBox(next)
      }
      frame = raf(track)
    }
    track()
    return () => cancelRaf(frame)
  }, [target])

  // Place the card once it's measured, beside the spotlight.
  useLayoutEffect(() => {
    const card = cardRef.current
    // A step with a target waits for its spotlight, so the card doesn't flash in the middle first.
    if (!card || !found || (target && !box)) return
    setPos(placeCard(box, { width: card.offsetWidth, height: card.offsetHeight }, viewport(), step?.placement))
  }, [box, found, target, step, index])

  // Each step's card pops in where it belongs, and the reader is put on it.
  const shown = found && pos !== null
  useEffect(() => {
    const card = cardRef.current
    if (!shown || !card) return
    card.focus({ preventScroll: true })
    if (typeof card.animate === 'function' && !reducedMotion()) {
      card.animate(
        [
          { opacity: 0, transform: 'translateY(6px) scale(0.96)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 240, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.25)' },
      )
    }
  }, [shown, index])

  // Keep the page behind out of reach while the tour is up (and give it back
  // as the tour closes, so focus can return to the tour button).
  useLayoutEffect(() => {
    const root = rootRef.current
    const hidden = Array.from(document.body.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el !== root && !el.inert,
    )
    hidden.forEach((el) => (el.inert = true))
    return () => hidden.forEach((el) => (el.inert = false))
  }, [])

  function go(next: number) {
    if (closing) return
    direction.current = next < index ? -1 : 1
    if (next >= 0 && next < steps.length) onIndex(next)
  }

  function close() {
    if (closing) return
    setClosing(true)
    const card = cardRef.current
    const home = launcher()
    const backdrop = rootRef.current
    if (!card || typeof card.animate !== 'function') return onClosed()
    if (reducedMotion() || !home) {
      backdrop?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' })
      card.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }).onfinish = onClosed
      return
    }
    // Shrink the card into the tour button, so it's clear where to find it again.
    const from = card.getBoundingClientRect()
    const to = home.getBoundingClientRect()
    const dx = to.left + to.width / 2 - (from.left + from.width / 2)
    const dy = to.top + to.height / 2 - (from.top + from.height / 2)
    const scale = Math.max(0.06, Math.min(to.width / from.width, to.height / from.height))
    rootRef.current?.classList.add('tour-closing')
    card.animate(
      [
        { transform: 'none', opacity: 1, borderRadius: '14px' },
        { transform: `translate(${dx * 0.55}px, ${dy * 0.35}px) scale(0.55)`, opacity: 0.95, offset: 0.45 },
        { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.2, borderRadius: '40px' },
      ],
      { duration: MINIMIZE_MS, easing: 'cubic-bezier(0.55, 0, 0.35, 1)', fill: 'forwards' },
    ).onfinish = onClosed
  }

  // Esc closes, the arrow keys step, and Tab stays on the card.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      } else if (e.key === 'ArrowRight' && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        if (last) close()
        else go(index + 1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        go(index - 1)
      } else if (e.key === 'Tab' && cardRef.current) {
        const focusable = Array.from(cardRef.current.querySelectorAll<HTMLElement>('button:not(:disabled)'))
        if (focusable.length === 0) return
        const first = focusable[0]
        const end = focusable[focusable.length - 1]
        const at = document.activeElement
        if (e.shiftKey && (at === first || at === cardRef.current)) {
          e.preventDefault()
          end.focus()
        } else if (!e.shiftKey && at === end) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  if (!step) return null
  const spot = found && box
  return createPortal(
    <div className={`tour${spot ? '' : ' tour-dim'}`} ref={rootRef} data-testid="tour">
      {spot && (
        <div
          className="tour-spotlight"
          aria-hidden="true"
          style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
        />
      )}
      <div
        ref={cardRef}
        className={`tour-card tour-card-${pos?.side ?? 'center'}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
        tabIndex={-1}
        style={{
          top: pos?.top ?? 0,
          left: pos?.left ?? 0,
          visibility: shown ? 'visible' : 'hidden',
          ['--tour-arrow' as string]: `${pos?.arrow ?? 0}px`,
        }}
      >
        <div className="tour-card-head">
          <span className="tour-eyebrow">{tour.title}</span>
          <button type="button" className="tour-close" onClick={close} aria-label="Close tour" title="Close tour (Esc)">
            <X aria-hidden="true" />
          </button>
        </div>
        <h2 id={`${id}-title`} className="tour-title">
          {step.title}
        </h2>
        <p id={`${id}-body`} className="tour-body">
          {step.body}
        </p>
        <div className="tour-foot">
          <div className="tour-progress">
            <span className="tour-count" aria-live="polite">
              Step {index + 1} of {steps.length}
            </span>
            {/* Past a dozen, the count says it better than a row of dots. */}
            {steps.length > 1 && steps.length <= 12 && (
              <span className="tour-dots" aria-hidden="true">
                {steps.map((_, i) => (
                  <span key={i} className={i === index ? 'on' : i < index ? 'done' : undefined} />
                ))}
              </span>
            )}
          </div>
          <div className="tour-actions">
            {index === 0 ? (
              !last && (
                <button type="button" className="ws-btn ws-btn-secondary" onClick={close}>
                  Skip tour
                </button>
              )
            ) : (
              <button type="button" className="ws-btn ws-btn-secondary" onClick={() => go(index - 1)}>
                Back
              </button>
            )}
            <button type="button" className="ws-btn ws-btn-primary" onClick={() => (last ? close() : go(index + 1))}>
              {last ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
