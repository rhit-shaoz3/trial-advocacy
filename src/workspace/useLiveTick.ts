import { useEffect, useState } from 'react'

/** How often a tracker on the instructor's pages checks for what students did. */
export const LIVE_REFRESH_MS = 15000

/**
 * A number that goes up every `every` ms while the page is visible, and when
 * the window comes back into focus. Add it to a loading effect's
 * dependencies to keep what it shows current without a page refresh.
 */
export function useLiveTick(every = LIVE_REFRESH_MS) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const bump = () => {
      if (document.visibilityState === 'visible') setTick((t) => t + 1)
    }
    const id = setInterval(bump, every)
    window.addEventListener('focus', bump)
    document.addEventListener('visibilitychange', bump)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', bump)
      document.removeEventListener('visibilitychange', bump)
    }
  }, [every])
  return tick
}
