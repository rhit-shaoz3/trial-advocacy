import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/useAuth'
import { TourContext, type TourContextValue } from './tourContext'
import { launcher } from './findTarget'
import { TourOverlay } from './TourOverlay'
import type { Tour, TourNavigator, TourStep } from './tourTypes'
import './Tour.css'

/**
 * Guided tours: holds the tour on screen and the page's own tour (for the
 * tour button), and remembers on the user's account which tours they've
 * been shown, so each starts on its own only once.
 */
export function TourProvider({ children }: { children: ReactNode }) {
  const { markTourSeen } = useAuth()
  const [active, setActive] = useState<Tour | null>(null)
  const [steps, setSteps] = useState<TourStep[]>([])
  const [index, setIndex] = useState(0)
  const [pageTour, setPageTour] = useState<Tour | null>(null)
  const [minimized, setMinimized] = useState(0)
  const navigators = useRef<TourNavigator[]>([])
  const autoStarted = useRef(new Set<string>()).current

  const start = useCallback(
    (tour: Tour) => {
      setActive(tour)
      setSteps(tour.steps)
      setIndex(0)
      for (const key of [tour.key, ...(tour.alsoMarks ?? [])]) void markTourSeen(key)
    },
    [markTourSeen],
  )

  const addNavigator = useCallback((navigator: TourNavigator) => {
    navigators.current = [...navigators.current, navigator]
    return () => {
      navigators.current = navigators.current.filter((n) => n !== navigator)
    }
  }, [])

  const onGo = useCallback((go: NonNullable<TourStep['go']>) => {
    // The tab first: the section it holds only mounts once the tab is open.
    if (go.tab) navigators.current.forEach((n) => n.selectTab?.(go.tab!))
    if (go.section) {
      const section = go.section
      // The section's navigator registers once its tab has mounted: wait for it.
      let tries = 0
      const attempt = () => {
        const withSections = navigators.current.filter((n) => n.selectSection)
        if (withSections.length) withSections.forEach((n) => n.selectSection!(section))
        else if (tries++ < 30) window.setTimeout(attempt, 30)
      }
      attempt()
    }
  }, [])

  function dropStep(at: number, direction: 1 | -1) {
    const rest = steps.filter((_, i) => i !== at)
    if (rest.length === 0) return finish()
    // Going forward past the last step ends the tour, as Done would have.
    if (direction === 1 && at >= rest.length) return finish()
    setSteps(rest)
    setIndex(direction === 1 ? at : Math.max(0, at - 1))
  }

  function finish() {
    setActive(null)
    setSteps([])
    setMinimized((n) => n + 1)
  }

  // Once the tour is gone (and the page is no longer inert), back to the
  // button it minimized into, where the reader can find it again.
  useEffect(() => {
    if (minimized > 0 && !active) launcher()?.focus({ preventScroll: true })
  }, [minimized, active])

  const value = useMemo<TourContextValue>(
    () => ({ active, start, pageTour, setPageTour, addNavigator, minimized, autoStarted }),
    [active, start, pageTour, addNavigator, minimized, autoStarted],
  )

  return (
    <TourContext.Provider value={value}>
      {children}
      {active && steps.length > 0 && (
        <TourOverlay
          key={active.key + minimized}
          tour={active}
          steps={steps}
          index={index}
          onIndex={setIndex}
          onDropStep={dropStep}
          onGo={onGo}
          onClosed={finish}
        />
      )}
    </TourContext.Provider>
  )
}
