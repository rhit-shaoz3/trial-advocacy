import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../auth/useAuth'
import type { DemoSession, Role, User } from '../auth/types'
import { DemoSlides } from './DemoSlides'
import { demoSlidesQueued } from './demoSlidesQueue'
import './demo.css'

/** How much bigger the demo shows the app, for a projector; the app is sized in rems, so this scales all of it. */
const SIZES = [100, 125, 150] as const
const SIZE_KEY = 'demo-size'

function savedSize() {
  try {
    const n = Number(localStorage.getItem(SIZE_KEY))
    return (SIZES as readonly number[]).includes(n) ? n : 125
  } catch {
    return 125
  }
}

const pathOf = (demo: DemoSession) => (demo.courseId && demo.caseId ? `/courses/${demo.courseId}/cases/${demo.caseId}` : '/')

/**
 * The demo account's bar across the top of every page: switch between the
 * course's instructor and its student, rebuild the demo case, and make the
 * app bigger for a projector. Only shown in a demo session.
 */
export function DemoBar() {
  const { user, switchDemo, resetDemo } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [size, setSize] = useState(savedSize)
  /** The opening slides: shown once after logging in, and from the bar's Slides button. */
  const [slides, setSlides] = useState(demoSlidesQueued)
  const demo = user?.demo

  useEffect(() => {
    if (!demo) return
    document.documentElement.style.fontSize = `${size}%`
    try {
      localStorage.setItem(SIZE_KEY, String(size))
    } catch {
      // Only means the size isn't remembered.
    }
    return () => {
      document.documentElement.style.fontSize = ''
    }
  }, [demo, size])

  if (!demo) return null
  const casePath = pathOf(demo)

  /** Runs a change, then opens the demo case (as whoever the session is now); `reload` loads the page afresh. */
  async function run(change: () => Promise<User | null>, reload = false) {
    setError(null)
    setBusy(true)
    try {
      const next = await change()
      const path = next?.demo ? pathOf(next.demo) : casePath
      // After a reset, everything on the page (counts in the menu too) starts over.
      if (reload) window.location.assign(path)
      else navigate(path)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  function become(as: Role) {
    if (as !== demo!.as) void run(() => switchDemo(as))
  }

  function reset() {
    if (!window.confirm('Reset the demo? The case goes back to Introduction, and its subpoenas and interviews are deleted.')) return
    void run(resetDemo, true)
  }

  return (
    <div className="demo-bar" role="region" aria-label="Demo">
      <span className="demo-bar-label">Demo</span>
      <div className="demo-toggle" role="group" aria-label="View as">
        {(['instructor', 'student'] as const).map((as) => (
          <button key={as} type="button" aria-pressed={demo.as === as} onClick={() => become(as)} disabled={busy}>
            {as === 'instructor' ? 'Instructor' : 'Student'}
          </button>
        ))}
      </div>
      <button type="button" className="demo-link" onClick={() => navigate(casePath)} disabled={busy}>
        Open the case
      </button>
      <button type="button" className="demo-link" onClick={() => setSlides(true)}>
        Slides
      </button>
      {error && (
        <span className="demo-error" role="alert">
          {error}
        </span>
      )}
      <div className="demo-bar-end">
        <label className="demo-size">
          Size
          <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
            {SIZES.map((s) => (
              <option key={s} value={s}>
                {s}%
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="demo-link" onClick={reset} disabled={busy}>
          Reset demo
        </button>
      </div>
      {slides && <DemoSlides onClose={() => setSlides(false)} />}
    </div>
  )
}
