import { useEffect, useState } from 'react'
import { useCourseService } from '../../../courses/CourseServiceContext'
import type { CaseSuggestions } from '../../../courses/types'

const POLL_MS = 3000

/**
 * The text the AI suggests for the case's own fields, from its initial file,
 * once it's ready (null until then, or when there's none). Checks back while
 * the file is read and the AI writes. Without a case (a new one), there are none.
 */
export function useCaseSuggestions(courseId: string, caseId: string): CaseSuggestions | null {
  const service = useCourseService()
  const [suggestions, setSuggestions] = useState<CaseSuggestions | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    if (!courseId || !caseId) return
    const load = () =>
      service
        .getContentSuggestions(courseId, caseId)
        .then((next) => {
          if (cancelled) return
          if (next.status === 'ready') setSuggestions(next.suggestions)
          else if (next.status === 'waiting') timer = setTimeout(load, POLL_MS)
        })
        .catch(() => {}) // the fields still work without suggestions
    load()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [service, courseId, caseId])

  return suggestions
}

/**
 * A field that starts with the AI's suggestion when nothing is saved in it: the
 * suggestion is written in once it arrives, unless the instructor has already
 * typed something. `suggested` says the text is still the suggestion as written.
 */
export function useSuggestedField(saved: string, suggestion: string | undefined) {
  const [value, setValue] = useState(saved || suggestion || '')
  const [touched, setTouched] = useState(false)
  const offer = !saved && !touched && suggestion ? suggestion : null
  // A suggestion that arrives after the form opened.
  if (offer && value === '') setValue(offer)
  return {
    value,
    setValue: (next: string) => {
      setTouched(true)
      setValue(next)
    },
    /** Back to what's saved (after saving). */
    reset: (next: string) => {
      setTouched(true)
      setValue(next)
    },
    suggested: Boolean(suggestion) && !saved && value === suggestion,
  }
}
