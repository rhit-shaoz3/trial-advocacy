import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlannerChange, PlannerChart, PlannerSource } from '../../courses/types'

/** How often the planner checks for teammates' changes while it's open. */
export const PLANNER_POLL_MS = 15_000

/** The planner's calls, bound to one case (see StudentCasePage). */
export interface PlannerActions {
  load(): Promise<PlannerChart | null>
  sources(): Promise<PlannerSource[]>
  change(change: PlannerChange): Promise<{ planner: PlannerChart; id?: string }>
}

/** Saves a change, made from the latest chart when it's a function (so quick edits don't undo each other). */
export type PlannerChangeFn = (
  change: PlannerChange | ((chart: PlannerChart) => PlannerChange),
) => Promise<{ id?: string } | undefined>

/**
 * The team's chart, kept current: loaded once, then re-read every so often
 * and when the window comes back into focus, so teammates' changes show up.
 * Changes are saved one at a time, in order; each answers with the whole chart.
 */
export function usePlanner(actions: PlannerActions) {
  const [chart, setChart] = useState<PlannerChart | null | undefined>(undefined)
  const [sources, setSources] = useState<PlannerSource[] | null>(null)
  const [status, setStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const [error, setError] = useState<string | null>(null)
  const chartRef = useRef<PlannerChart | null | undefined>(undefined)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const pending = useRef(0)
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  const show = (next: PlannerChart | null) => {
    chartRef.current = next
    setChart(next)
  }

  const refresh = useCallback(async () => {
    try {
      const next = await actionsRef.current.load()
      // A save on its way answers with a newer chart; don't step back to this one.
      if (pending.current === 0) show(next)
    } catch (err) {
      if (chartRef.current === undefined) setError(err instanceof Error ? err.message : 'Couldn’t load your planner.')
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), PLANNER_POLL_MS)
    const onFocus = () => document.visibilityState === 'visible' && void refresh()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [refresh])

  const change = useCallback<PlannerChangeFn>((made) => {
    pending.current++
    setStatus('saving')
    const next = queue.current.then(async () => {
      const latest = chartRef.current
      if (!latest) throw new Error('Your planner isn’t loaded yet.')
      try {
        const result = await actionsRef.current.change(typeof made === 'function' ? made(latest) : made)
        show(result.planner)
        return { id: result.id }
      } finally {
        pending.current--
      }
    })
    queue.current = next.catch(() => undefined)
    return next.then(
      (result) => {
        if (pending.current === 0) setStatus('saved')
        return result
      },
      (err) => {
        setStatus('error')
        // A teammate may have deleted what was being changed: show the chart as it is.
        void refresh()
        throw err
      },
    )
  }, [refresh])

  const loadSources = useCallback(() => {
    actionsRef.current.sources().then(setSources, () => setSources([]))
  }, [])

  return { chart, sources, loadSources, change, status, error }
}
