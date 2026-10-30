import { Compass } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTour } from './tourContext'

/** How long the button waves after a tour minimizes into it. */
const WAVE_MS = 2600

/**
 * The "Take the tour" button in the page's upper right corner: replays the tour of the page on
 * screen. A finished tour shrinks into it, and it waves to say so.
 */
export function TourButton() {
  const tours = useTour()
  const minimized = tours?.minimized ?? 0
  const [waving, setWaving] = useState(false)

  useEffect(() => {
    if (minimized === 0) return
    setWaving(true)
    const timer = window.setTimeout(() => setWaving(false), WAVE_MS)
    return () => window.clearTimeout(timer)
  }, [minimized])

  if (!tours) return null
  const tour = tours.pageTour
  return (
    <button
      type="button"
      className={`theme-toggle tour-launcher${waving ? ' tour-launcher-wave' : ''}`}
      data-tour-launcher=""
      disabled={!tour}
      onClick={() => tour && tours.start(tour)}
      aria-label={tour ? `Take the tour of this page` : 'No tour on this page'}
      title={tour ? 'Take the tour of this page' : 'No tour on this page'}
    >
      <Compass aria-hidden="true" />
      <span>Take the tour</span>
      {waving && (
        <small className="tour-launcher-hint" aria-hidden="true">
          Replay anytime
        </small>
      )}
    </button>
  )
}
