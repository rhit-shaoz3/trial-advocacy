import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DiscoveryDraft, DraftContent, DraftKind, KeyedCheck } from '../../courses/types'

/** Saving and deleting the team's drafts. */
export interface DraftActions {
  /** Saves a new draft (no id) or over one; `keepalive` lets it finish as the page closes. */
  save(kind: DraftKind, id: string | null, content: DraftContent, lastCheck: KeyedCheck | null, options?: { keepalive?: boolean }): Promise<DiscoveryDraft>
  remove(id: string): Promise<void>
}

export type DraftStatus = { state: 'idle' } | { state: 'saving' } | { state: 'saved'; at: Date } | { state: 'error' }

/** How long after the last edit the draft saves. */
export const AUTOSAVE_MS = 800

/**
 * Keeps a new subpoena or set saved as the team writes it: a pause in typing
 * saves it, and so does leaving (Back, another tab, closing or refreshing the
 * page). Nothing is saved until there's something in it. `submit` sends it
 * and stops saving (sending deletes the draft on the server); `discard`
 * deletes it.
 */
export function useDraft({
  kind,
  initial,
  content,
  check,
  empty,
  actions,
}: {
  kind: DraftKind
  initial?: DiscoveryDraft
  content: DraftContent
  check: KeyedCheck | null
  /** Whether there's nothing written yet. */
  empty: boolean
  actions?: DraftActions
}) {
  const [draftId, setDraftId] = useState<string | null>(initial?.id ?? null)
  const [status, setStatus] = useState<DraftStatus>(initial ? { state: 'saved', at: new Date(initial.updatedAt) } : { state: 'idle' })
  const id = useRef(initial?.id ?? null)
  // What's saved, so opening a draft (or a re-render) doesn't save it again.
  const key = JSON.stringify([content, check?.id ?? null])
  const savedKey = useRef(key)
  const latest = useRef({ content, check, empty, key })
  const dirty = useRef(false)
  const closed = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Saves run one at a time, so the first one's new id is there for the next.
  const queue = useRef<Promise<void>>(Promise.resolve())
  const actionsRef = useRef(actions)
  useLayoutEffect(() => {
    latest.current = { content, check, empty, key }
    actionsRef.current = actions
  })

  const save = useCallback(
    (options?: { keepalive?: boolean }) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      queue.current = queue.current.then(async () => {
        const run = actionsRef.current
        if (!run || closed.current || !dirty.current) return
        const snapshot = latest.current
        dirty.current = false
        if (snapshot.key === savedKey.current || (!id.current && snapshot.empty)) return
        setStatus({ state: 'saving' })
        try {
          const saved = await run.save(kind, id.current, snapshot.content, snapshot.check, options)
          id.current = saved.id
          savedKey.current = snapshot.key
          setDraftId(saved.id)
          setStatus({ state: 'saved', at: new Date() })
        } catch {
          dirty.current = true
          setStatus({ state: 'error' })
        }
      })
      return queue.current
    },
    [kind],
  )

  // Any change (the fields, or a new check) saves after a pause.
  useEffect(() => {
    if (key === savedKey.current) return
    dirty.current = true
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void save(), AUTOSAVE_MS)
  }, [key, save])

  // Leaving saves it: closing or refreshing the page, and unmounting (Back, another tab).
  useEffect(() => {
    const onHide = () => void save({ keepalive: true })
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      void save()
    }
  }, [save])

  /** Saves now (Save as draft); throws if it couldn't. */
  const flush = useCallback(async () => {
    dirty.current = true
    await save()
    if (dirty.current) throw new Error('Couldn’t save the draft. Check your connection and try again.')
  }, [save])

  /** Sends it with `send(draftId)`. Once it's sent, the draft isn't saved again; if sending fails, saving carries on. */
  const submit = useCallback(async (send: (draftId: string | undefined) => Promise<void>) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    closed.current = true
    await queue.current
    try {
      await send(id.current ?? undefined)
    } catch (err) {
      closed.current = false
      throw err
    }
  }, [])

  /** Deletes the draft (Cancel). */
  const discard = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    closed.current = true
    await queue.current
    if (id.current) await actionsRef.current?.remove(id.current)
  }, [])

  return { draftId, status, flush, submit, discard }
}
