import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { reducedMotion } from '../../pages/cases/content/liftoff'
import bulbUrl from './teach-me.png'
import './teachMe.css'

/** How long the bulb bounces around the screen before its guide opens. */
const FLIGHT_MS = 1150
/** Where it lands on each hop, as fractions of the window; the last is where it spins and the guide grows from. */
const LANDINGS = [
  { x: 0.62, y: 0.68, height: 0.22 },
  { x: 0.5, y: 0.4, height: 0.16 },
]
/** Of the flight, the share spent hopping; the rest is the spin. */
const HOPPING = 0.68
const SPIN_SCALE = 1.4

/** The Teach me lightbulb, bundled with the code so it's there however the app is served. */
export function TeachBulb({ className = 'teach-bulb' }: { className?: string }) {
  return <img src={bulbUrl} alt="" className={className} draggable={false} />
}

/** The flight's keyframes, as moves from where the bulb starts: arcs between landings, a squash on each, then a spin. */
function flightFrames(from: DOMRect): { frames: Keyframe[]; end: { x: number; y: number } } {
  const start = { x: from.left + from.width / 2, y: from.top + from.height / 2 }
  const w = window.innerWidth
  const h = window.innerHeight
  const frames: Keyframe[] = [{ offset: 0, transform: 'translate(0px, 0px)' }]
  const steps = 8
  let at = start
  LANDINGS.forEach((spot, i) => {
    const to = { x: spot.x * w, y: spot.y * h }
    const lean = i % 2 ? -14 : 14
    for (let k = 1; k <= steps; k++) {
      const s = k / steps
      const x = at.x + (to.x - at.x) * s - start.x
      const y = at.y + (to.y - at.y) * s - spot.height * h * 4 * s * (1 - s) - start.y
      // Squashed on landing, leaning into the jump on the way.
      const shape = k === steps ? 'scale(1.25, 0.8)' : `rotate(${lean * Math.sin(Math.PI * s)}deg)`
      frames.push({ offset: (HOPPING * (i + s)) / LANDINGS.length, transform: `translate(${x}px, ${y}px) ${shape}` })
    }
    at = to
  })
  const end = { x: at.x - start.x, y: at.y - start.y }
  frames.push({ offset: 1, transform: `translate(${end.x}px, ${end.y}px) rotate(360deg) scale(${SPIN_SCALE})` })
  return { frames, end: at }
}

/**
 * "Teach me", with its lightbulb: it grows on hover; when clicked, the bulb
 * bounces around the screen and spins, then `onOpen` gets where it ended up,
 * so the guide can grow out of it. `about` names what the guide covers on this screen.
 */
export function TeachMeButton({
  about,
  onOpen,
  tour,
  variant = 'card',
}: {
  about?: string
  onOpen(from: DOMRect): void
  /** The guided tour's target (data-tour). */
  tour?: string
  /** A card in a side menu, or a compact button in a header. */
  variant?: 'card' | 'compact'
}) {
  const bulb = useRef<HTMLSpanElement>(null)
  const flyer = useRef<HTMLSpanElement>(null)
  // Where the bulb took off from, while it's flying.
  const [flight, setFlight] = useState<DOMRect | null>(null)
  const latestOpen = useRef(onOpen)
  useEffect(() => {
    latestOpen.current = onOpen
  })

  useLayoutEffect(() => {
    const el = flyer.current
    if (!flight || !el) return
    const { frames, end } = flightFrames(flight)
    const animation = el.animate(frames, { duration: FLIGHT_MS, easing: 'linear', fill: 'forwards' })
    let done = false
    animation.onfinish = () => {
      done = true
      setFlight(null)
      const size = flight.width * SPIN_SCALE
      latestOpen.current(new DOMRect(end.x - size / 2, end.y - size / 2, size, size))
    }
    return () => {
      if (!done) animation.cancel()
    }
  }, [flight])

  function click() {
    if (flight || !bulb.current) return
    const rect = bulb.current.getBoundingClientRect()
    // No flight with reduced motion, or where the browser can't animate (tests).
    if (reducedMotion() || typeof Element.prototype.animate !== 'function') return onOpen(rect)
    setFlight(rect)
  }

  return (
    <button
      type="button"
      className={`teach-me-button teach-me-${variant}`}
      onClick={click}
      data-tour={tour}
      aria-label="Teach me"
      // The topic as its description, so its name stays "Teach me".
      title={about ? `Teach me about ${about.toLowerCase()}` : undefined}
    >
      <span ref={bulb} className={flight ? 'teach-me-bulb teach-me-flying' : 'teach-me-bulb'} aria-hidden="true">
        <TeachBulb />
      </span>
      <span className="teach-me-text" aria-hidden="true">
        <strong>Teach me</strong>
        {about && <small>{about}</small>}
      </span>
      {flight &&
        createPortal(
          <span
            ref={flyer}
            className="teach-flyer"
            style={{ left: flight.left, top: flight.top, width: flight.width, height: flight.height }}
            aria-hidden="true"
          >
            <TeachBulb />
          </span>,
          document.body,
        )}
    </button>
  )
}
