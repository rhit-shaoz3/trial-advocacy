import { useState } from 'react'
import { Flag } from 'lucide-react'
import { useCourseService } from '../../courses/CourseServiceContext'
import type { CourseFlag, FlagResolution } from '../../courses/types'
import { worldLabel } from '../../courses/worldLabel'
import { WorldFactsDetails } from './FactsPanel'
import { dateTime } from './reviewLabels'
import { SubpoenaCard } from './SubpoenaCard'
import { Transcript } from './Transcript'

/**
 * A student's flag on something decided automatically (review lite), laid out
 * as it would have been for review, with their reason on top. The instructor
 * keeps the call or changes it: a fact's ruling, whether the team keeps a
 * file, or reopening a subpoena to answer it again.
 */
export function FlagCard({ courseId, flag: f, onDone }: { courseId: string; flag: CourseFlag; onDone(): void }) {
  const service = useCourseService()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const team = `Team ${f.teamNumber}`
  const review = f.review
  const fact = review?.facts.find((x) => x.id === f.factId)
  const file = review?.documents?.find((d) => d.materialId === f.materialId)
  const investigation = review?.kind === 'investigation'
  const worldNumber = f.worldNumber ?? review?.worldNumber ?? f.subpoena?.worldNumber ?? null

  const choices: [FlagResolution, string, string][] =
    f.kind === 'fact'
      ? [
          [{ decision: 'accept_world' }, 'Keep it (accepted for this world)', 'btn-secondary'],
          [{ decision: 'deny_world' }, 'Deny for this world', 'btn-primary'],
          [{ decision: 'accept_case' }, 'Accept for all worlds', 'btn-secondary'],
          [{ decision: 'deny_case' }, 'Deny for all worlds', 'btn-secondary'],
        ]
      : f.kind === 'document'
        ? [
            [{ decision: 'allow' }, `Keep it: ${team} has the file`, 'btn-secondary'],
            [{ decision: 'deny' }, 'Take the file back', 'btn-primary'],
          ]
        : [
            [{ action: 'keep' }, 'Keep the answer', 'btn-secondary'],
            [{ action: 'reopen' }, 'Reopen it to answer again', 'btn-primary'],
          ]

  async function resolve(resolution: FlagResolution) {
    setBusy(true)
    setError(null)
    try {
      await service.resolveFlag(courseId, f.id, resolution)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  const title =
    f.kind === 'fact'
      ? `A fact from ${investigation ? 'the investigator' : `the interview of ${review?.witness?.name ?? 'a witness'}`}`
      : f.kind === 'document'
        ? `A file the investigator gave ${team}`
        : f.subpoena?.outcome === 'denied'
          ? `Appeal: subpoena to ${f.subpoena.recipient} was denied`
          : `The answer to a subpoena to ${f.subpoena?.recipient ?? 'someone'}`

  return (
    <article className="review-card review-flag" aria-labelledby={`flag-${f.id}`}>
      <header className="review-card-header">
        <Flag className="review-group-icon" aria-hidden="true" />
        <div className="review-card-title">
          <span className="ws-eyebrow">{f.caseTitle} · Flagged by {team}</span>
          <h2 id={`flag-${f.id}`}>{title}</h2>
          <p className="review-meta">
            {worldNumber !== null && `World ${worldLabel(worldNumber)} · `}
            {f.raisedBy ?? team} · {dateTime(f.createdAt)}
          </p>
        </div>
      </header>

      <blockquote className="review-flag-reason">
        <span className="review-label">Why they flagged it</span>
        <p>{f.reason}</p>
      </blockquote>

      {f.kind === 'fact' && fact && (
        <ol className="review-facts">
          <li>
            <p className="review-fact-text">{fact.text}</p>
            <span className="muted">Accepted for this world automatically.</span>
          </li>
        </ol>
      )}
      {f.kind === 'document' && file && (
        <ol className="review-facts">
          <li>
            <p className="review-fact-text">
              {team} has <em>{file.title}</em>
            </p>
            <span className="muted">Allowed automatically.</span>
          </li>
        </ol>
      )}
      {investigation && review?.report && (
        <details className="review-report">
          <summary>The investigator&rsquo;s report</summary>
          <p>{review.report}</p>
        </details>
      )}
      {f.kind === 'subpoena' && f.subpoena && <SubpoenaCard courseId={courseId} subpoena={f.subpoena} />}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <footer className="review-card-footer">
        <div className="review-expanders">
          {review && !investigation && <Transcript courseId={courseId} reviewId={review.id} />}
          {worldNumber !== null && <WorldFactsDetails courseId={courseId} caseId={f.caseId} worldNumber={worldNumber} />}
        </div>
        <div className="review-group-actions">
          {choices.map(([resolution, label, style]) => (
            <button key={label} type="button" className={style} disabled={busy} onClick={() => resolve(resolution)}>
              {label}
            </button>
          ))}
        </div>
      </footer>
    </article>
  )
}
