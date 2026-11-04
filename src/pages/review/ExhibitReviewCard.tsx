import { useState } from 'react'
import { CircleCheck, Highlighter, Scale } from 'lucide-react'
import { useCourseService } from '../../courses/CourseServiceContext'
import { EXHIBIT_SIDE, EXHIBIT_STATUS_LABEL } from '../../courses/exhibitLabels'
import { worldLabel } from '../../courses/worldLabel'
import type { ExhibitMarking, ExhibitReview, ExhibitRuling } from '../../courses/types'
import { ExhibitRecord } from '../../caseWorkspace/finalSteps/ExhibitListSection'
import { useExhibitViewer } from '../cases/finalSteps/useExhibitViewer'
import { RedactionEditor, type MarkedRedaction } from '../../components/redaction/RedactionEditor'
import { fetchBytes } from '../../components/redaction/redactFile'
import '../../caseWorkspace/finalSteps/exhibits.css'

/**
 * A challenge to one exhibit, for the instructor to rule on as the judge:
 * authenticity (authenticate, or reject as inauthentic), or an objection
 * (overrule, sustain, or partly overrule with a redaction, marked on the
 * exhibit itself when it's a PDF, picture or text). Without `onRuled`
 * (Completed reviews) it shows the ruling.
 */
export function ExhibitReviewCard({
  courseId,
  review: x,
  onRuled,
}: {
  courseId: string
  review: ExhibitReview
  onRuled?(): void
}) {
  const service = useCourseService()
  const viewer = useExhibitViewer(courseId, x.caseId)
  const [partial, setPartial] = useState(false)
  const [marking, setMarking] = useState<ExhibitMarking | null>(null)
  const [editing, setEditing] = useState(false)
  const [marked, setMarked] = useState<MarkedRedaction | null>(null)
  const [redaction, setRedaction] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const authenticity = x.status === 'authenticity_review'
  const offering = `Team ${x.offeredBy === 'plaintiff' ? x.teams.plaintiff : x.teams.defense}`
  const challenging = `Team ${x.offeredBy === 'plaintiff' ? x.teams.defense : x.teams.plaintiff}`

  async function rule(ruling: ExhibitRuling) {
    setBusy(true)
    setError(null)
    try {
      await service.ruleOnExhibit(courseId, x.id, ruling)
      onRuled?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  /** Partly overruling: find out whether the exhibit can be marked, and open the marks if so. */
  async function startPartial() {
    setPartial(true)
    if (marking) return
    try {
      const m = await service.getExhibitMarking(courseId, x.id)
      setMarking(m)
      if (m.markable) setEditing(true)
    } catch {
      setMarking({ markable: null, parts: null })
    }
  }
  const markable = marking?.markable ? { ...marking, markable: marking.markable } : null

  return (
    <article className="review-card" aria-labelledby={`exhibit-${x.id}`}>
      <header className="review-card-header">
        <span className="ws-icon-tile ws-tone-blue" aria-hidden="true">
          <Scale />
        </span>
        <div className="review-card-title">
          <span className="ws-eyebrow">
            {x.caseTitle} · {onRuled ? (authenticity ? 'Authenticity challenge' : 'Objection to admission') : 'Exhibit ruling'}
          </span>
          <h2 id={`exhibit-${x.id}`}>{x.title}</h2>
          <p className="review-meta">
            World {worldLabel(x.worldNumber)} · Offered by {offering} ({EXHIBIT_SIDE[x.offeredBy]}) · challenged by {challenging}
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => viewer.open(x)}>
          View exhibit
        </button>
      </header>

      <ExhibitRecord exhibit={x} />

      {onRuled ? (
        <div className="xl-note">
          {partial && markable && (
            <p className="rx-marked">
              <span>
                {marked ? (
                  <>
                    <CircleCheck aria-hidden="true" /> Marked on the exhibit. {marked.summary}.
                  </>
                ) : (
                  'Mark the redaction on the exhibit, or describe it below.'
                )}
              </span>
              <button type="button" className="ws-btn ws-btn-secondary" disabled={busy} onClick={() => setEditing(true)}>
                <Highlighter aria-hidden="true" /> {marked ? 'Change the marks' : 'Mark the redaction'}
              </button>
            </p>
          )}
          {partial && (
            <label className="xl-field">
              <span>
                What’s redacted{' '}
                <small>
                  {markable
                    ? '(optional) A few words for both teams, alongside your marks.'
                    : 'The part of the exhibit that stays out; the rest is admitted.'}
                </small>
              </span>
              <input type="text" value={redaction} maxLength={2000} onChange={(e) => setRedaction(e.target.value)} />
            </label>
          )}
          <label className="xl-field">
            <span>
              Note to both teams <small>(optional) Your reasoning, as the judge.</small>
            </span>
            <textarea value={note} rows={2} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="review-subpoena-actions">
            {authenticity ? (
              <>
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => rule({ step: 'authenticity', decision: 'reject', note })}>
                  Reject as inauthentic
                </button>
                <button type="button" className="btn-primary" disabled={busy} onClick={() => rule({ step: 'authenticity', decision: 'authenticate', note })}>
                  Authenticate
                </button>
              </>
            ) : partial ? (
              <>
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => setPartial(false)}>
                  Back
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy || (!marked && !redaction.trim())}
                  onClick={() =>
                    rule({ step: 'admission', decision: 'partial', redaction, note, marks: marked?.marks, uploadKey: marked?.uploadKey })
                  }
                >
                  Admit with this redaction
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => rule({ step: 'admission', decision: 'sustain', note })}>
                  Sustain (exclude)
                </button>
                <button type="button" className="btn-secondary" disabled={busy} onClick={startPartial}>
                  Partially overrule
                </button>
                <button type="button" className="btn-primary" disabled={busy} onClick={() => rule({ step: 'admission', decision: 'overrule', note })}>
                  Overrule (admit)
                </button>
              </>
            )}
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
      ) : (
        <p className="review-meta">
          Now: {EXHIBIT_STATUS_LABEL[x.status]}
          {x.ruledBy && ` · ruled by ${x.ruledBy}`}
        </p>
      )}
      {viewer.element}
      {editing && markable && (
        <RedactionEditor
          eyebrow={`Partly overrule · ${x.title}`}
          marking={markable}
          deposition={x.kind === 'deposition'}
          loadFile={() => fetchBytes(service.reviewExhibitBytesUrl(courseId, x.id))}
          upload={(file) => service.uploadRedactedExhibit(courseId, x.id, file)}
          initial={marked?.marks}
          onSave={(m) => {
            setMarked(m)
            setEditing(false)
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </article>
  )
}
