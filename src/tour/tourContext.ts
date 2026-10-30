import { createContext, useContext, useEffect } from 'react'
import { AuthContext } from '../auth/AuthContext'
import type { Tour, TourNavigator } from './tourTypes'

export interface TourContextValue {
  /** The tour showing now, if any. */
  active: Tour | null
  start(tour: Tour): void
  /** The tour of the page on screen, which the tour button replays. */
  pageTour: Tour | null
  setPageTour(tour: Tour | null): void
  /** Lets a step open a tab or section first; returns the unregister. */
  addNavigator(navigator: TourNavigator): () => void
  /** Counts finished tours, so the tour button can wave when one minimizes into it. */
  minimized: number
  /** Tours already started on their own since the page loaded: one each, at most. */
  autoStarted: Set<string>
}

export const TourContext = createContext<TourContextValue | null>(null)

/** The tours. Outside a TourProvider (some tests), nothing shows. */
export function useTour() {
  return useContext(TourContext)
}

/**
 * Makes `tour` the page's tour (the tour button replays it) and starts it
 * on its own the first time this user sees the page, once `ready` (the page's
 * data has loaded, so what the tour points at is there). `startWith` starts a
 * different tour on its own instead (a case's new phase), or null for none.
 * Pass stable tours (useMemo).
 */
export function usePageTour(
  tour: Tour | null,
  { ready = true, startWith }: { ready?: boolean; startWith?: Tour | null } = {},
) {
  const tours = useTour()
  // Null outside the app (some tests): then nothing starts on its own.
  const user = useContext(AuthContext)?.user
  const setPageTour = tours?.setPageTour

  useEffect(() => {
    if (!setPageTour) return
    setPageTour(tour)
    return () => setPageTour(null)
  }, [setPageTour, tour])

  const auto = startWith === undefined ? tour : startWith
  // toursSeen is missing only when the server didn't say (tests with a bare
  // user): then nothing starts on its own.
  const seen = user?.toursSeen
  const shouldStart = Boolean(tours && auto && ready && seen && !seen[auto.key] && !tours.active)
  useEffect(() => {
    // Once per page load, even if it's closed before it's marked as seen.
    if (!shouldStart || !tours || !auto || tours.autoStarted.has(auto.key)) return
    tours.autoStarted.add(auto.key)
    // A beat after the page settles, so the spotlight lands on the finished layout.
    let started = false
    const timer = window.setTimeout(() => {
      started = true
      tours.start(auto)
    }, 400)
    return () => {
      window.clearTimeout(timer)
      // Left before it started (or remounted): it may start next time.
      if (!started) tours.autoStarted.delete(auto.key)
    }
  }, [shouldStart, tours, auto])
}

/** Registers how this page opens a tab or section for a tour step. Pass stable callbacks. */
export function useTourNavigator(navigator: TourNavigator | null) {
  const addNavigator = useTour()?.addNavigator
  useEffect(() => (navigator && addNavigator ? addNavigator(navigator) : undefined), [addNavigator, navigator])
}
