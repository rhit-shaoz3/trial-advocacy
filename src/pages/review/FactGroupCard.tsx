import { useState } from 'react'
import { Layers } from 'lucide-react'
import { useCourseService } from '../../courses/CourseServiceContext'
import type { FactDecision, FactGroup, InterviewReview } from '../../courses/types'
import { worldLabel } from '../../courses/worldLabel'
import { WorldFactsDetails } from './FactsPanel'
import { Transcript } from './Transcript'

/**
 * Similar new facts from different teams, ruled on together: each for its own
 * world, or for every world. Each fact's conversation (or report) opens below
 * it. Ungrouping sends the facts back to their own reviews.
 */
export function FactGroupCard({
  courseId,
  group: g,
  reviews,
  onDone,
}: {
  courseId: string
  group: FactGroup
  /** The open reviews, for the reports the facts came from. */
  reviews: InterviewReview[]
  /** After a ruling or ungrouping; the page reloads. */
  onDone(): void
}) {
  const service = useCourseService()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const these = g.worlds === 1 ? 'this world' : `these ${g.worlds} worlds`
  const worlds = [...new Set(g.facts.map((f) => f.worldNumber))].sort((a, b) => a - b)
  const choices: [FactDecision, string][] = [
    ['accept_world', `Accept for ${these}`],
    ['deny_world', `Deny for ${these}`],
    ['accept_case', 'Accept for all worlds'],
    ['deny_case', 'Deny for all worlds'],
  ]

  async function act(run: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await run()
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  return (
    <article className="review-card review-group" id={`group-${g.id}`} aria-labelledby={`group-title-${g.id}`}>
      <header className="review-card-header">
        <Layers className="review-group-icon" aria-hidden="true" />
        <div className="review-card-title">
          <span className="ws-eyebrow">{g.caseTitle} · Similar facts</span>
          <h2 id={`group-title-${g.id}`}>{g.headline}</h2>
          {g.differences && (
            <p className="review-group-differences">
              <span className="review-label">Differences</span> {g.differences}
            </p>
          )}
        </div>
      </header>

      <ol className="review-facts review-group-facts" aria-label="Facts in this group">
        {g.facts.map((f) => {
          const review = reviews.find((r) => r.id === f.reviewId)
          return (
            <li key={f.id}>
              <p className="review-fact-text">{f.text}</p>
              <p className="review-meta">
                Team {f.teamNumber} · World {worldLabel(f.worldNumber)} · {f.source}
              </p>
              {review?.kind === 'investigation' ? (
                review.report && (
                  <details className="review-transcript">
                    <summary>Show report · Team {f.teamNumber}</summary>
                    <p className="review-group-report">{review.report}</p>
                  </details>
                )
              ) : (
                <Transcript courseId={courseId} reviewId={f.reviewId} label={`Show conversation · Team ${f.teamNumber}`} />
              )}
            </li>
          )
        })}
      </ol>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <footer className="review-card-footer">
        <div className="review-expanders">
          {worlds.map((w) => (
            <WorldFactsDetails key={w} courseId={courseId} caseId={g.caseId} worldNumber={w} />
          ))}
        </div>
        <div className="review-group-actions">
          {choices.map(([decision, label]) => (
            <button
              key={decision}
              type="button"
              className={`btn-secondary review-group-${decision}`}
              disabled={busy}
              onClick={() => act(() => service.decideFactGroup(courseId, g.id, decision))}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className="link-button"
            disabled={busy}
            onClick={() => act(() => service.ungroupFacts(courseId, g.id))}
          >
            Ungroup to rule on each
          </button>
        </div>
      </footer>
    </article>
  )
}
