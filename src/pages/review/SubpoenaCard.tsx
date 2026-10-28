import { useEffect, useState } from 'react'
import { ScrollText } from 'lucide-react'
import { DictationTextarea } from '../../components/Dictation'
import { AUDIENCE_LABEL } from '../../courses/caseLabels'
import { useCourseService } from '../../courses/CourseServiceContext'
import type { CaseMaterial, CourseSubpoena, SubpoenaOutcome } from '../../courses/types'
import { ROLE_LABEL, worldLabel } from '../../courses/worldLabel'

const OUTCOME_LABEL: Record<SubpoenaOutcome, string> = { complied: 'Complied', quashed: 'Quashed' }

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/**
 * A subpoena a team served, answered by the instructor as its recipient:
 * comply (a response, case files produced, or both; the files are shared with
 * the team) or quash (with the reason). Once answered, it shows the answer.
 */
export function SubpoenaCard({
  courseId,
  subpoena: s,
  onAnswer,
  now = new Date(),
}: {
  courseId: string
  subpoena: CourseSubpoena
  /** Called with the answered subpoena; the page moves it to Completed. */
  onAnswer?(answered: CourseSubpoena): void
  now?: Date
}) {
  const service = useCourseService()
  const team = `Team ${s.teamNumber}`
  const answered = s.respondedAt !== null
  const [outcome, setOutcome] = useState<SubpoenaOutcome | null>(null)
  const [response, setResponse] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [files, setFiles] = useState<CaseMaterial[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The case's files, to produce from, the first time the instructor chooses to comply.
  useEffect(() => {
    if (outcome !== 'complied' || files) return
    service
      .listMaterials(courseId, s.caseId)
      .then(setFiles)
      .catch((err: Error) => setError(`Could not load the case file. ${err.message}`))
  }, [service, courseId, s.caseId, outcome, files])

  const ready = outcome === 'quashed' ? response.trim() !== '' : outcome === 'complied' && (response.trim() !== '' || picked.length > 0)

  async function send() {
    if (!outcome) return
    setBusy(true)
    setError(null)
    try {
      onAnswer?.(await service.answerSubpoena(courseId, s.id, { outcome, response, materialIds: outcome === 'complied' ? picked : [] }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  const flip = (id: string) => setPicked((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
  const overdue = !answered && new Date(s.dueAt) < now

  return (
    <article className="review-card" aria-labelledby={`subpoena-${s.id}`}>
      <header className="review-card-header">
        <span className="ws-icon-tile ws-tone-amber review-subpoena-icon" aria-hidden="true">
          <ScrollText />
        </span>
        <div className="review-card-title">
          <span className="ws-eyebrow">{s.caseTitle}</span>
          <h2 id={`subpoena-${s.id}`}>Subpoena to {s.recipient}</h2>
          <p className="review-meta">
            World {worldLabel(s.worldNumber)} · {ROLE_LABEL[s.side]} · {team}
            {s.team.length > 0 && ` (${s.team.join(', ')})`}
          </p>
        </div>
        <small className={overdue ? 'review-overdue' : 'muted'}>
          {answered && s.respondedAt
            ? `Answered ${dateTime(s.respondedAt)}`
            : `Served ${day(s.sentAt)} · ${overdue ? 'overdue since' : 'due'} ${day(s.dueAt)}`}
        </small>
      </header>

      <div className="review-assignment review-subpoena-block">
        <span className="review-label">Records requested{s.sentBy ? ` by ${s.sentBy}` : ''}</span>
        <p>{s.records}</p>
      </div>

      {answered ? (
        <div className="review-subpoena-answer">
          <span className={`badge review-subpoena-${s.outcome}`}>{s.outcome ? OUTCOME_LABEL[s.outcome] : 'Answered'}</span>
          {s.response && <p>{s.response}</p>}
          {s.documents.length > 0 && (
            <>
              <span className="review-label">Produced to {team}</span>
              <ul>
                {s.documents.map((d) => (
                  <li key={d.materialId}>{d.title}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : (
        onAnswer && (
          <div className="review-subpoena-form">
            <p className="muted">
              Answer as {s.recipient}. Files you produce are added to {team}&rsquo;s case file; the other team only
              knows the subpoena was served.
            </p>
            <div className="review-choices" role="radiogroup" aria-label={`Answer to ${team}'s subpoena`}>
              {(['complied', 'quashed'] as const).map((o) => (
                <label key={o} className={`review-choice review-choice-${o === 'complied' ? 'allow' : 'deny'}`}>
                  <input
                    type="radio"
                    name={`subpoena-${s.id}`}
                    value={o}
                    checked={outcome === o}
                    onChange={() => setOutcome(o)}
                    disabled={busy}
                  />
                  {o === 'complied' ? 'Comply' : 'Quash'}
                </label>
              ))}
            </div>

            {outcome === 'complied' && (
              <fieldset className="review-subpoena-files">
                <legend>Case files to produce</legend>
                {!files ? (
                  <p className="muted">Loading the case file…</p>
                ) : files.filter((f) => !f.initial).length === 0 ? (
                  <p className="muted">This case has no files to produce yet. Upload one on the case&rsquo;s Case file tab.</p>
                ) : (
                  files
                    .filter((f) => !f.initial)
                    .map((f) => (
                      <label key={f.id} className="review-subpoena-file">
                        <input type="checkbox" checked={picked.includes(f.id)} onChange={() => flip(f.id)} disabled={busy} />
                        <span>
                          {f.description || f.filename}
                          <small className="muted">{AUDIENCE_LABEL[f.audience]}</small>
                        </span>
                      </label>
                    ))
                )}
              </fieldset>
            )}

            {outcome && (
              <label className="review-subpoena-response">
                {outcome === 'complied' ? `Response to ${team} (optional with files)` : 'Why it is quashed'}
                <DictationTextarea
                  value={response}
                  rows={3}
                  maxLength={4000}
                  placeholder={
                    outcome === 'complied'
                      ? 'Enclosed are the records responsive to your subpoena…'
                      : 'The request is overbroad and seeks privileged medical information…'
                  }
                  onChange={(e) => setResponse(e.target.value)}
                />
              </label>
            )}

            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <footer className="review-card-footer">
              <div className="review-finish">
                <button type="button" className="btn-primary" onClick={send} disabled={busy || !ready}>
                  {busy ? 'Sending…' : 'Send answer'}
                </button>
              </div>
            </footer>
          </div>
        )
      )}
    </article>
  )
}
