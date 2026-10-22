import { useEffect, useState } from 'react'
import { useOutletContext, useParams, useSearchParams } from 'react-router'
import { useCourseService } from '../../courses/CourseServiceContext'
import { FACT_DECISIONS, type FactDecision, type InterviewReview, type ReviewTurn } from '../../courses/types'
import { ROLE_LABEL, worldLabel } from '../../courses/worldLabel'
import type { WorkspaceContext } from '../../workspace/useWorkspace'
import './Review.css'
import { WitnessAvatar } from '../../components/WitnessAvatar'

type Tab = 'open' | 'completed'

const DECISION_LABEL: Record<FactDecision, string> = {
  accept_world: 'Accept for this world',
  deny_world: 'Deny for this world',
  accept_case: 'Accept for all worlds',
  deny_case: 'Deny for all worlds',
}

/** How often the list refreshes while a conversation's facts are still being listed. */
const POLL_MS = 5000

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/**
 * The instructor's review panel: each conversation a team ended, as the new
 * facts the AI witness added. The instructor rules on each fact, for the
 * team's world or the whole case, then finishes the review, which binds later
 * interviews and tells the team what stands.
 */
export function ReviewPage() {
  const { courseId = '' } = useParams()
  const service = useCourseService()
  const workspace = useOutletContext<WorkspaceContext | undefined>()
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'completed' ? 'completed' : 'open'
  const [reviews, setReviews] = useState<InterviewReview[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setReviews(null)
    setError(null)
    service
      .listReviews(courseId, tab)
      .then((list) => !cancelled && setReviews(list))
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [service, courseId, tab])

  // The AI lists a conversation's facts in the background; check back until it's done.
  const summarizing = reviews?.some((r) => r.status === 'summarizing') ?? false
  useEffect(() => {
    if (!summarizing) return
    const timer = setInterval(() => {
      service
        .listReviews(courseId, 'open')
        .then(setReviews)
        .catch(() => {}) // keep the current list; the next tick tries again
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [service, courseId, summarizing])

  function selectTab(next: Tab) {
    setParams((prev) => {
      const updated = new URLSearchParams(prev)
      if (next === 'open') updated.delete('tab')
      else updated.set('tab', next)
      return updated
    })
  }

  function replace(updated: InterviewReview) {
    setReviews((prev) => prev?.map((r) => (r.id === updated.id ? updated : r)) ?? null)
  }

  function completed(done: InterviewReview) {
    setReviews((prev) => prev?.filter((r) => r.id !== done.id) ?? null)
    workspace?.reloadHome()
  }

  const waiting = workspace?.home.reviewCount

  return (
    <main className="ws-page review-page">
      <div className="ws-welcome">
        <div>
          <span className="ws-eyebrow">Instructor</span>
          <h1 className="ws-title">Review</h1>
          <p className="ws-subtle">
            When a team ends an interview, the new facts the AI witness added come here. Rule on each one
            as the judge: it stands or it doesn&rsquo;t, for that team&rsquo;s case world or for every world.
          </p>
        </div>
      </div>

      <div className="review-tabs" role="tablist" aria-label="Reviews">
        <button type="button" role="tab" aria-selected={tab === 'open'} className="review-tab" onClick={() => selectTab('open')}>
          To review{waiting ? ` (${waiting})` : ''}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'completed'}
          className="review-tab"
          onClick={() => selectTab('completed')}
        >
          Completed reviews
        </button>
      </div>

      {error ? (
        <p className="form-error" role="alert">
          Could not load the reviews. {error}
        </p>
      ) : !reviews ? (
        <p className="ws-subtle">Loading reviews…</p>
      ) : reviews.length === 0 ? (
        <div className="ws-empty">
          <p className="case-empty-title">{tab === 'open' ? 'Nothing to review.' : 'No completed reviews yet.'}</p>
          <p className="ws-subtle">
            {tab === 'open'
              ? 'Conversations show up here when a team ends an interview with an AI witness.'
              : 'Reviews you finish are kept here with your rulings.'}
          </p>
        </div>
      ) : (
        <ul className="review-list" aria-label={tab === 'open' ? 'To review' : 'Completed reviews'}>
          {reviews.map((r) => (
            <li key={r.id}>
              <ReviewCard courseId={courseId} review={r} onChange={replace} onCompleted={completed} />
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

function ReviewCard({
  courseId,
  review: r,
  onChange,
  onCompleted,
}: {
  courseId: string
  review: InterviewReview
  onChange(updated: InterviewReview): void
  onCompleted(done: InterviewReview): void
}) {
  const service = useCourseService()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const done = r.status === 'completed'
  const ruled = r.facts.filter((f) => f.decision).length

  async function run(action: () => Promise<InterviewReview>, after?: (updated: InterviewReview) => void) {
    setError(null)
    setBusy(true)
    try {
      const updated = await action()
      ;(after ?? onChange)(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="review-card" aria-labelledby={`review-${r.id}`}>
      <header className="review-card-header">
        <WitnessAvatar src={r.witness.avatarUrl} size="lg" />
        <div className="review-card-title">
          <span className="ws-eyebrow">{r.caseTitle}</span>
          <h2 id={`review-${r.id}`}>Interview of {r.witness.name}</h2>
          <p className="review-meta">
            World {worldLabel(r.worldNumber)} · {ROLE_LABEL[r.side]} · Team {r.teamNumber}
            {r.team.length > 0 && ` (${r.team.join(', ')})`}
          </p>
        </div>
        <small className="muted">
          {done && r.completedAt ? `Completed ${dateTime(r.completedAt)}` : `Ended ${dateTime(r.createdAt)}`}
        </small>
      </header>

      {r.status === 'summarizing' && <p className="review-note" role="status">Listing the new facts in this conversation…</p>}

      {r.status === 'failed' && (
        <div className="review-note">
          <p className="form-error">{r.error ?? 'Could not list the new facts.'}</p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => run(() => service.retryReview(courseId, r.id))}
            disabled={busy}
          >
            Try again
          </button>
        </div>
      )}

      {(r.status === 'open' || done) &&
        (r.facts.length === 0 ? (
          <p className="review-note">No new facts: the witness kept to the record.</p>
        ) : (
          <ol className="review-facts" aria-label="New facts">
            {r.facts.map((f, i) => (
              <li key={f.id}>
                <p className="review-fact-text">{f.text}</p>
                {done ? (
                  <span className={`badge review-decision review-decision-${f.decision}`}>
                    {f.decision ? DECISION_LABEL[f.decision] : 'No ruling'}
                  </span>
                ) : (
                  <div className="review-choices" role="radiogroup" aria-label={`Ruling on fact ${i + 1}`}>
                    {FACT_DECISIONS.map((d) => (
                      <label key={d} className={`review-choice review-choice-${d}`}>
                        <input
                          type="radio"
                          name={`fact-${f.id}`}
                          value={d}
                          checked={f.decision === d}
                          onChange={() => run(() => service.decideFact(courseId, r.id, f.id, d))}
                          disabled={busy}
                        />
                        {DECISION_LABEL[d]}
                      </label>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
        ))}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <footer className="review-card-footer">
        <Transcript courseId={courseId} reviewId={r.id} />
        {r.status === 'open' && (
          <div className="review-finish">
            <span className="muted">
              {ruled} of {r.facts.length} ruled
            </span>
            <button
              type="button"
              className="btn-primary"
              onClick={() => run(() => service.completeReview(courseId, r.id), onCompleted)}
              disabled={busy || ruled < r.facts.length}
            >
              Finish review
            </button>
          </div>
        )}
      </footer>
    </article>
  )
}

/** The conversation behind a review, loaded the first time it's opened. */
function Transcript({ courseId, reviewId }: { courseId: string; reviewId: string }) {
  const service = useCourseService()
  const [turns, setTurns] = useState<ReviewTurn[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  function load(open: boolean) {
    if (!open || turns) return
    service
      .getReviewTranscript(courseId, reviewId)
      .then(setTurns)
      .catch((err: Error) => setError(err.message))
  }

  return (
    <details className="review-transcript" onToggle={(e) => load(e.currentTarget.open)}>
      <summary>Show conversation</summary>
      {error ? (
        <p className="form-error">{error}</p>
      ) : !turns ? (
        <p className="muted">Loading…</p>
      ) : (
        <ol>
          {turns.map((t, i) => (
            <li key={i}>
              <p>
                <strong>Q.</strong> {t.question}
                {t.askedBy && <small className="muted"> ({t.askedBy})</small>}
              </p>
              {t.objection && <p className="review-objection">{t.objection}</p>}
              <p>
                <strong>A.</strong> {t.answer}
              </p>
            </li>
          ))}
        </ol>
      )}
    </details>
  )
}
