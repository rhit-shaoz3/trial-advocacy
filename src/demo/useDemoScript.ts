import { useContext, useEffect, useState } from 'react'
import { apiRequest } from '../api/request'
import { AuthContext } from '../auth/AuthContext'

/** What the demo fills in (see server/demo/script.ts). */
export interface DemoScript {
  subpoena: { recipient: string; recipientDescription: string; requestType: string; records: string; justification: string }
  /** The deposition questions asked live, in order. */
  questions: string[]
}

let loaded: Promise<DemoScript | null> | null = null

/** The demo's script in a demo session, for its demo case; null otherwise (or until it loads). */
export function useDemoScript(caseId: string | undefined): DemoScript | null {
  // Read directly: a form shown outside the signed-in app (or in a test) is simply not in the demo.
  const user = useContext(AuthContext)?.user
  const active = !!caseId && user?.demo?.caseId === caseId
  const [script, setScript] = useState<DemoScript | null>(null)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    loaded ??= apiRequest('/demo/script')
      .then((body) => body.script as DemoScript)
      .catch(() => {
        loaded = null
        return null
      })
    void loaded.then((s) => !cancelled && setScript(s))
    return () => {
      cancelled = true
    }
  }, [active])

  return active ? script : null
}
