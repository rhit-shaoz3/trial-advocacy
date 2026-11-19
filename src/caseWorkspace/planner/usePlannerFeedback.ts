import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlannerFeedback } from '../../courses/types'

/** How often the planner checks on a round that's on its way. */
export const FEEDBACK_POLL_MS = 5_000

/** The feedback's calls, bound to one case; leave out the changes for the instructor's read-only view. */
export interface FeedbackActions {
  load(): Promise<PlannerFeedback | null>
  request?(): Promise<PlannerFeedback>
  retry?(reviewId: string): Promise<PlannerFeedback>
  reply?(reviewId: string, target: { kind: 'card' | 'gap'; id: string }, text: string): Promise<PlannerFeedback>
}

/** The team's rounds of feedback, kept current while one is on its way. */
export function usePlannerFeedback(actions: FeedbackActions | undefined) {
  const [feedback, setFeedback] = useState<PlannerFeedback | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef(actions)
  ref.current = actions

  const refresh = useCallback(async () => {
    if (!ref.current) return
    try {
      setFeedback(await ref.current.load())
    } catch {
      // The chart still works without its feedback.
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const waiting = Boolean(feedback?.reviews.some((r) => r.status === 'working'))
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => void refresh(), FEEDBACK_POLL_MS)
    return () => clearInterval(timer)
  }, [waiting, refresh])

  const run = async (call: () => Promise<PlannerFeedback> | undefined) => {
    setBusy(true)
    setError(null)
    try {
      const next = await call()
      if (next) setFeedback(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return {
    feedback,
    error,
    busy,
    waiting,
    ask: () => run(() => ref.current?.request?.()),
    retry: (id: string) => run(() => ref.current?.retry?.(id)),
    reply: async (reviewId: string, target: { kind: 'card' | 'gap'; id: string }, text: string) => {
      const next = await ref.current?.reply?.(reviewId, target, text)
      if (next) setFeedback(next)
    },
  }
}

export type FeedbackState = ReturnType<typeof usePlannerFeedback>

/** The rounds that came back, oldest first. */
export const readyRounds = (feedback: PlannerFeedback | null) => feedback?.reviews.filter((r) => r.status === 'ready') ?? []

/** The latest round's questions on a card or gap: how many, and whether the team has replied. */
export interface NoteMark {
  count: number
  replied: boolean
}

/** The latest round's questions on each card or gap, by id. */
export function noteMarks(feedback: PlannerFeedback | null) {
  const latest = readyRounds(feedback).at(-1)
  const marks = new Map<string, NoteMark>()
  for (const n of latest?.notes ?? []) {
    const replied = Boolean(latest?.replies.some((r) => r.targetKind === n.targetKind && r.targetId === n.targetId))
    marks.set(n.targetId, { count: (marks.get(n.targetId)?.count ?? 0) + 1, replied })
  }
  return marks
}
