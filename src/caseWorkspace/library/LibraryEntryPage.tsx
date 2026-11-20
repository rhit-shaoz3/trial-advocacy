import { useEffect, useState } from 'react'
import { ChevronRight, Download } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { useAuth } from '../../auth/useAuth'
import { useCourseService } from '../../courses/CourseServiceContext'
import type { LibraryDetail, LibraryKind } from '../../courses/types'
import { useWorkspace } from '../../workspace/useWorkspace'
import { PracticeTranscript } from '../practice/PracticeTranscript'
import { COOPERATION_LABEL } from '../practice/practiceLabels'
import { KIND_LABEL, shortDay, tagLabel } from './libraryLabels'
import '../interview.css'
import './library.css'

/** One piece of the student's AI feedback in full, to read again or download. */
export function LibraryEntryPage() {
  const { courseId = '', kind = '', id = '' } = useParams()
  const { search } = useWorkspace()
  const { user } = useAuth()
  const service = useCourseService()
  const [detail, setDetail] = useState<LibraryDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    service
      .getLibraryEntry(courseId, kind as LibraryKind, id)
      .then((d) => !cancelled && setDetail(d))
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [service, courseId, kind, id])

  const back = `/courses/${courseId}/library${search}`
  const entry = detail?.entry

  return (
    <main className="ws-page lib-page">
      <nav className="cw-breadcrumb" aria-label="Breadcrumb">
        <Link to={back}>Learning library</Link>
        <ChevronRight aria-hidden="true" />
        <span aria-current="page">{entry?.title ?? 'Feedback'}</span>
      </nav>
      {error ? (
        <>
          <h1 className="ws-title">Not found</h1>
          <p className="ws-subtle">{error}</p>
        </>
      ) : !detail || !entry ? (
        <p className="ws-subtle">Loading…</p>
      ) : (
        <article className="lib-detail pr" aria-labelledby="lib-title">
          <header className="lib-detail-head">
            <div>
              <span className="ws-eyebrow">{KIND_LABEL[entry.kind]}</span>
              <h1 id="lib-title" className="ws-title">
                {entry.title}
              </h1>
              <p className="lib-detail-meta">
                <span>{entry.caseTitle}</span>
                <span>{shortDay(entry.createdAt)}</span>
                {entry.kind !== 'practice' && <span>{entry.mine ? 'Asked by you' : `Asked by ${entry.by ?? 'your partner'}`}</span>}
                {entry.tag && <span className={`lib-tag lib-tag-${entry.tag.toLowerCase()}`}>{tagLabel(entry.kind, entry.tag)}</span>}
              </p>
            </div>
            <a className="btn-secondary lib-download" href={service.libraryPdfUrl(courseId, entry.kind, entry.id)} download>
              <Download aria-hidden="true" />
              Download PDF
            </a>
          </header>

          {detail.kind === 'practice' && (
            <>
              <div className="pr-goal">
                <strong>What you practiced</strong>
                <p>{detail.session.goal}</p>
                <small>
                  Witness: {COOPERATION_LABEL[detail.session.cooperation].toLowerCase()}
                  {detail.session.toneNotes ? ` · ${detail.session.toneNotes}` : ''}
                  {detail.session.priorTestimony ? ` · Earlier testimony: ${detail.session.priorTestimony}` : ''}
                </small>
              </div>
              <PracticeTranscript session={detail.session} you={{ name: user?.name ?? null, avatarUrl: user?.avatarUrl }} />
            </>
          )}

          {detail.kind === 'discovery' && (
            <>
              <section className="lib-section" aria-labelledby="lib-checked">
                <h2 id="lib-checked">What was checked</h2>
                <Checked check={detail.check} />
              </section>
              <section className="lib-section" aria-labelledby="lib-feedback">
                <h2 id="lib-feedback">The AI&rsquo;s feedback</h2>
                <p>{detail.check.feedback}</p>
              </section>
            </>
          )}

          {detail.kind === 'planner' && (
            <>
              {detail.review.overview && (
                <section className="lib-section" aria-labelledby="lib-overview">
                  <h2 id="lib-overview">Overview</h2>
                  <p>{detail.review.overview}</p>
                </section>
              )}
              {detail.review.notes.length > 0 && (
                <section className="lib-section" aria-labelledby="lib-notes">
                  <h2 id="lib-notes">On your chart</h2>
                  <ul>
                    {detail.review.notes.map((n, i) => (
                      <li key={i}>
                        <span className="lib-note-title">{n.title}</span>
                        <br />
                        {n.text}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {detail.review.bigPicture && (
                <section className="lib-section" aria-labelledby="lib-big">
                  <h2 id="lib-big">The big picture</h2>
                  <p>{detail.review.bigPicture}</p>
                </section>
              )}
            </>
          )}
        </article>
      )}
    </main>
  )
}

/** The draft a discovery check read: a subpoena, a set, or the team's answers to the other side's. */
function Checked({ check }: { check: Extract<LibraryDetail, { kind: 'discovery' }>['check'] }) {
  const content = check.content
  if (!content) return <p className="lib-muted">This check is from before the draft was kept with it.</p>
  if ('subpoena' in content) {
    const s = content.subpoena
    return (
      <ul>
        <li>
          <span className="lib-note-title">To:</span> {s.recipient}
          {s.recipientDescription ? `, ${s.recipientDescription}` : ''}
        </li>
        <li>
          <span className="lib-note-title">Records:</span> {s.records}
        </li>
        {s.justification && (
          <li>
            <span className="lib-note-title">Why:</span> {s.justification}
          </li>
        )}
      </ul>
    )
  }
  if ('items' in content) {
    return (
      <ol>
        {content.items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ol>
    )
  }
  return (
    <ol>
      {content.responses.map((r) => (
        <li key={r.position}>
          <span className="lib-note-title">{check.questions.find((q) => q.position === r.position)?.text}</span>
          <br />
          {r.objection ? `Objection. ${r.answer}` : r.answer || (r.admission ? `${r.admission[0].toUpperCase()}${r.admission.slice(1)}` : '')}
        </li>
      ))}
    </ol>
  )
}
