import { useState } from 'react'
import { useCourseService } from '../../courses/CourseServiceContext'
import { FACT_DECISIONS, INVESTIGATOR_AVATAR_URL, type InterviewReview } from '../../courses/types'
import { ROLE_LABEL, worldLabel } from '../../courses/worldLabel'
import { WitnessAvatar } from '../../components/WitnessAvatar'
import { WorldFactsDetails } from './FactsPanel'
import { DECISION_LABEL, DOCUMENT_LABEL, dateTime } from './reviewLabels'
import { Transcript } from './Transcript'

/**
 * One conversation a team ended, as the new facts the witness added, or one
 * background investigator report, with its new facts and the case files he'd
 * unlock. The instructor rules on each fact (one in a group is ruled with its
 * group); the review finishes once everything in it is ruled. A finished
 * review's rulings can still be changed.
 */
export function ReviewCard({
  courseId,
  review: r,
  onChange,
}: {
  courseId: string
  review: InterviewReview
  /** The review after a ruling; it may have finished. */
  onChange(updated: InterviewReview): void
}) {
  const service = useCourseService()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** Rulings being changed on a finished review: fact ids, and file ids. */
  const [changing, setChanging] = useState<string[]>([])
  // Finished by the instructor, even while the team's report is still being written.
  const done = r.status === 'completed' || r.status === 'finalizing'
  const investigation = r.kind === 'investigation'
  const documents = r.documents ?? []
  const ruled = r.facts.filter((f) => f.decision).length
  const decided = documents.filter((d) => d.decision).length
  const team = `Team ${r.teamNumber}`
  const auto = done && (r.facts.some((f) => f.auto) || documents.some((d) => d.auto))

  async function run(action: () => Promise<InterviewReview>, id?: string) {
    setError(null)
    setBusy(true)
    try {
      onChange(await action())
      if (id) setChanging((prev) => prev.filter((c) => c !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const change = (id: string) => (
    <button
      type="button"
      className="link-button review-change"
      onClick={() => setChanging((prev) => [...prev, id])}
      disabled={busy || r.status === 'finalizing'}
    >
      Change ruling
    </button>
  )

  return (
    <article className="review-card" aria-labelledby={`review-${r.id}`}>
      <header className="review-card-header">
        <WitnessAvatar src={investigation ? INVESTIGATOR_AVATAR_URL : r.witness?.avatarUrl} size="lg" />
        <div className="review-card-title">
          <span className="ws-eyebrow">{r.caseTitle}</span>
          <h2 id={`review-${r.id}`}>{investigation ? `Investigation for ${team}` : `Interview of ${r.witness?.name}`}</h2>
          <p className="review-meta">
            World {worldLabel(r.worldNumber)} · {ROLE_LABEL[r.side]} · Team {r.teamNumber}
            {r.team.length > 0 && ` (${r.team.join(', ')})`}
          </p>
        </div>
        <small className="muted">
          {done && r.completedAt
            ? `Completed ${dateTime(r.completedAt)}`
            : `${investigation ? 'Sent' : 'Ended'} ${dateTime(r.createdAt)}`}
          {auto && (
            <>
              <br />
              <span className="badge review-auto">Review lite</span>
            </>
          )}
        </small>
      </header>

      {investigation && r.assignment && (
        <div className="review-assignment">
          <span className="review-label">Assignment{r.askedBy ? ` from ${r.askedBy}` : ''}</span>
          <p>{r.assignment}</p>
        </div>
      )}

      {r.status === 'summarizing' && (
        <p className="review-note" role="status">
          {investigation ? `The investigator is working on ${team}'s assignment…` : 'Listing the new facts in this conversation…'}
        </p>
      )}
      {r.status === 'finalizing' && (
        <p className="review-note" role="status">
          Writing {team}&rsquo;s report without what you turned down…
        </p>
      )}

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

      {investigation && r.status === 'open' && r.reviewBlockMissing && (
        <p className="review-warning" role="note">
          The investigator didn&rsquo;t list his new facts or files. Read the report before sending it.
        </p>
      )}
      {investigation && r.report && (
        <details className="review-report" open={r.status === 'open'}>
          <summary>The investigator&rsquo;s report</summary>
          <p>{r.report}</p>
        </details>
      )}
      {investigation && done && r.finalReport && (
        <details className="review-report">
          <summary>What {team} got</summary>
          <p>{r.finalReport}</p>
        </details>
      )}

      {(r.status === 'open' || done) &&
        (r.facts.length === 0 ? (
          <p className="review-note">
            {investigation ? 'No new facts in this report.' : 'No new facts: the witness kept to the record.'}
          </p>
        ) : (
          <ol className="review-facts" aria-label="New facts">
            {r.facts.map((f, i) => (
              <li key={f.id}>
                <p className="review-fact-text">{f.text}</p>
                {r.status === 'open' && f.groupId ? (
                  <p className="review-grouped">
                    Grouped with similar facts from other teams. <a href={`#group-${f.groupId}`}>Rule on the group</a>
                  </p>
                ) : done && !changing.includes(f.id) ? (
                  <div className="review-ruled">
                    <span className={`badge review-decision review-decision-${f.decision}`}>
                      {f.decision ? DECISION_LABEL[f.decision] : 'No ruling'}
                    </span>
                    {f.auto && <span className="muted">automatically</span>}
                    {change(f.id)}
                  </div>
                ) : (
                  <div className="review-choices" role="radiogroup" aria-label={`Ruling on fact ${i + 1}`}>
                    {FACT_DECISIONS.map((d) => (
                      <label key={d} className={`review-choice review-choice-${d}`}>
                        <input
                          type="radio"
                          name={`fact-${f.id}`}
                          value={d}
                          checked={f.decision === d}
                          onChange={() => run(() => service.decideFact(courseId, r.id, f.id, d), f.id)}
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

      {investigation && (r.status === 'open' || done) && documents.length > 0 && (
        <section className="review-documents" aria-label="Case files">
          <h3>Case files</h3>
          <p className="muted">
            The investigator could get these for {team}. If you don&rsquo;t allow one, everything from it comes out of
            the report.
          </p>
          <ol className="review-facts review-doc-list">
            {documents.map((d) => (
              <li key={d.materialId}>
                <p className="review-fact-text">
                  Allow {team} access to <em>{d.title}</em>
                </p>
                {done && !changing.includes(d.materialId) ? (
                  <div className="review-ruled">
                    <span className={`badge review-document-${d.decision}`}>
                      {d.decision ? DOCUMENT_LABEL[d.decision] : 'No decision'}
                    </span>
                    {d.auto && <span className="muted">automatically</span>}
                    {change(d.materialId)}
                  </div>
                ) : (
                  <div className="review-choices" role="radiogroup" aria-label={`Allow ${team} access to ${d.title}`}>
                    {(['allow', 'deny'] as const).map((choice) => (
                      <label key={choice} className={`review-choice review-choice-${choice}`}>
                        <input
                          type="radio"
                          name={`document-${r.id}-${d.materialId}`}
                          value={choice}
                          checked={d.decision === choice}
                          onChange={() => run(() => service.decideDocument(courseId, r.id, d.materialId, choice), d.materialId)}
                          disabled={busy}
                        />
                        {DOCUMENT_LABEL[choice]}
                      </label>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {investigation && (r.recordsRequested?.length ?? 0) > 0 && (
        <section className="review-records" aria-label="Records requested">
          <h3>Records requested</h3>
          <p className="muted">
            The team asked for these, but they need legal process or aren&rsquo;t in the case file. Upload or share one
            from the case file if you want them to have it.
          </p>
          <ul>
            {r.recordsRequested!.map((record) => (
              <li key={record}>{record}</li>
            ))}
          </ul>
        </section>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <footer className="review-card-footer">
        <div className="review-expanders">
          {!investigation && <Transcript courseId={courseId} reviewId={r.id} />}
          <WorldFactsDetails courseId={courseId} caseId={r.caseId} worldNumber={r.worldNumber} />
        </div>
        {r.status === 'open' &&
          (r.facts.length === 0 && documents.length === 0 ? (
            // Nothing to rule on: the report goes on once the instructor has read it.
            <div className="review-finish">
              <button
                type="button"
                className="btn-primary"
                onClick={() => run(() => service.completeReview(courseId, r.id))}
                disabled={busy}
              >
                Send to {team}
              </button>
            </div>
          ) : (
            <div className="review-finish">
              <span className="muted">
                {ruled} of {r.facts.length} ruled
                {documents.length > 0 && ` · ${decided} of ${documents.length} files decided`}. It&rsquo;s done once
                everything is.
              </span>
            </div>
          ))}
      </footer>
    </article>
  )
}
