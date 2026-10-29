import type { CheckTag, DiscoveryCheckRecord } from '../courses/types'
import './CheckSummary.css'

const LABEL: Record<CheckTag, string> = {
  LOOKS_GOOD: 'Looks good',
  SMALL_EDITS: 'Small edits',
  NEEDS_IMPROVEMENT: 'Needs improvement',
}

/**
 * For the instructor: what "Check with AI" told a team before it sent
 * discovery (or its answers), whether it sent what was checked, and the
 * feedback it got. Students never see this afterwards.
 */
export function CheckSummary({ label, check }: { label: string; check: DiscoveryCheckRecord | null | undefined }) {
  if (check === undefined) return null
  return (
    <div className="check-summary">
      <span className="check-summary-label">{label}</span>
      {check ? (
        <>
          <span className={`check-summary-badge check-summary-${check.tag.toLowerCase()}`}>{LABEL[check.tag]}</span>
          {!check.current && <span className="check-summary-note">edited after the check</span>}
          {check.feedback && (
            <details className="check-summary-feedback">
              <summary>What the AI told them</summary>
              <p>{check.feedback}</p>
            </details>
          )}
        </>
      ) : (
        <span className="check-summary-badge">Not checked</span>
      )}
    </div>
  )
}
