import { useEffect, useState } from 'react'
import { CircleCheck, Columns2, Highlighter, Scale } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { RedactionEditor, type MarkedRedaction } from '../../components/redaction/RedactionEditor'
import { fetchBytes } from '../../components/redaction/redactFile'
import { useFilePages } from '../../components/redaction/useFilePages'
import { useCourseService } from '../../courses/CourseServiceContext'
import { EXHIBIT_SIDE } from '../../courses/exhibitLabels'
import { worldLabel } from '../../courses/worldLabel'
import type { ExhibitMarking, ExhibitPart, ExhibitReview, ExhibitVersionsRuling } from '../../courses/types'
import { ExhibitRecord } from '../../caseWorkspace/finalSteps/ExhibitListSection'
import { useExhibitViewer } from '../cases/finalSteps/useExhibitViewer'
import '../../caseWorkspace/finalSteps/exhibits.css'
import './exhibitPair.css'

/** What a version holds beyond the document's title: " — pages 1–2 (with redactions)" as "pages 1–2 (with redactions)". */
function versionDetail(v: ExhibitReview) {
  const base = v.sourceTitle ?? ''
  const rest = v.title.startsWith(base) ? v.title.slice(base.length).replace(/^\s*—\s*/, '').trim() : v.title
  return rest || 'the whole document'
}

/** Neither parts nor redactions: this version is the whole document. */
const isWhole = (v: ExhibitReview) => v.parts === null && !v.offeredRedacted

/**
 * Two versions of one document, each side's, both before the judge: shown
 * together, compared side by side, and settled by one ruling (the whole
 * document, one version, a part marked on the original, or none of it).
 */
export function ExhibitPairCard({ courseId, versions, onRuled }: { courseId: string; versions: [ExhibitReview, ExhibitReview]; onRuled(): void }) {
  const service = useCourseService()
  const [first, second] = versions
  const viewer = useExhibitViewer(courseId, first.caseId)
  const [comparing, setComparing] = useState(false)
  const [choice, setChoice] = useState<ExhibitVersionsRuling['decision'] | null>(null)
  const [whole, setWhole] = useState<ExhibitMarking | null>(null)
  const [editing, setEditing] = useState(false)
  const [marked, setMarked] = useState<MarkedRedaction | null>(null)
  const [redaction, setRedaction] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const team = (v: ExhibitReview) => `Team ${v.offeredBy === 'plaintiff' ? v.teams.plaintiff : v.teams.defense}`

  async function choose(next: ExhibitVersionsRuling['decision']) {
    setChoice(next)
    setError(null)
    if (next !== 'partial') return
    try {
      const m = whole ?? (await service.getExhibitMarking(courseId, first.id, true))
      setWhole(m)
      if (m.markable && !marked) setEditing(true)
    } catch {
      setWhole({ markable: null, parts: null })
    }
  }

  async function rule() {
    if (!choice) return
    setBusy(true)
    setError(null)
    try {
      await service.ruleOnExhibitVersions(courseId, [first.id, second.id], {
        decision: choice,
        note,
        ...(choice === 'partial' && { marks: marked?.marks, uploadKey: marked?.uploadKey, redaction }),
      })
      onRuled()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  const options: { id: ExhibitVersionsRuling['decision']; label: string }[] = [
    { id: 'whole', label: 'Admit the whole document' },
    // A version that's the whole document is the first choice already.
    ...versions.flatMap((v, i) =>
      isWhole(v) ? [] : [{ id: v.offeredBy, label: `Admit version ${i + 1}: the ${EXHIBIT_SIDE[v.offeredBy].toLowerCase()}’s (${versionDetail(v)})` }],
    ),
    { id: 'partial', label: 'Admit part of it: mark it on the original' },
    { id: 'exclude', label: 'Keep it out entirely' },
  ]
  const markable = whole?.markable ? { ...whole, markable: whole.markable } : null
  const ready = choice !== null && (choice !== 'partial' || Boolean(marked) || (whole !== null && !whole.markable && redaction.trim() !== ''))

  return (
    <article className="review-card xl-pair" aria-labelledby={`pair-${first.id}`}>
      <header className="review-card-header">
        <span className="ws-icon-tile ws-tone-blue" aria-hidden="true">
          <Scale />
        </span>
        <div className="review-card-title">
          <span className="ws-eyebrow">{first.caseTitle} · Two versions of one document</span>
          <h2 id={`pair-${first.id}`}>{first.sourceTitle ?? first.title}</h2>
          <p className="review-meta">
            World {worldLabel(first.worldNumber)} · Both sides listed it, each objects to the other’s version, and both sent it to you.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => setComparing(true)}>
          <Columns2 aria-hidden="true" /> Compare side by side
        </button>
      </header>

      <div className="xl-pair-versions">
        {versions.map((v, i) => (
          <section key={v.id} className="xl-pair-version" aria-label={`Version ${i + 1}`}>
            <span className="ws-eyebrow">
              Version {i + 1} · {EXHIBIT_SIDE[v.offeredBy]}’s ({team(v)})
            </span>
            <p className="xl-pair-detail">
              <button type="button" className="link-button" onClick={() => viewer.open(v)}>
                {versionDetail(v)}
              </button>
            </p>
            <ExhibitRecord exhibit={v} />
          </section>
        ))}
      </div>

      <div className="xl-note">
        <fieldset className="xl-pair-choices">
          <legend>Your ruling</legend>
          {options.map((o) => (
            <label key={o.id}>
              <input type="radio" name={`pair-${first.id}`} checked={choice === o.id} disabled={busy} onChange={() => choose(o.id)} />
              {o.label}
            </label>
          ))}
        </fieldset>
        {choice === 'partial' && markable && (
          <p className="rx-marked">
            <span>
              {marked ? (
                <>
                  <CircleCheck aria-hidden="true" /> Marked on the original. {marked.summary}.
                </>
              ) : (
                'Mark what’s admitted (or redacted) on the whole original document.'
              )}
            </span>
            <button type="button" className="ws-btn ws-btn-secondary" disabled={busy} onClick={() => setEditing(true)}>
              <Highlighter aria-hidden="true" /> {marked ? 'Change the marks' : 'Mark the original'}
            </button>
          </p>
        )}
        {choice === 'partial' && whole && (
          <label className="xl-field">
            <span>
              What’s redacted{' '}
              <small>{markable ? '(optional) A few words for both teams, alongside your marks.' : 'The part that stays out; the rest is admitted.'}</small>
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
        <p className="muted xl-pair-hint">Whatever you admit becomes one joint exhibit, numbered as the plaintiff’s; the other version gives way to it.</p>
        <div className="review-subpoena-actions">
          <button type="button" className="btn-primary" disabled={busy || !ready} onClick={rule}>
            Rule
          </button>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>

      {viewer.element}
      {comparing && <CompareVersions courseId={courseId} versions={versions} onClose={() => setComparing(false)} />}
      {editing && markable && (
        <RedactionEditor
          eyebrow={`Partly admit · ${first.sourceTitle ?? first.title} (the whole original)`}
          marking={markable}
          loadFile={() => fetchBytes(service.reviewExhibitOriginalUrl(courseId, first.id))}
          upload={(file) => service.uploadRedactedExhibit(courseId, first.id, file)}
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

/**
 * The two versions side by side: a PDF's pages or a picture next to each
 * other (each page with its page in the original, and whether the other
 * version has it), or a text file's paragraphs in one list, with what only one
 * version has highlighted.
 */
export function CompareVersions({
  courseId,
  versions,
  onClose,
}: {
  courseId: string
  versions: [ExhibitReview, ExhibitReview]
  onClose(): void
}) {
  const service = useCourseService()
  const [markings, setMarkings] = useState<[ExhibitMarking, ExhibitMarking] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [a, b] = [versions[0].id, versions[1].id]
  useEffect(() => {
    let cancelled = false
    Promise.all([service.getExhibitMarking(courseId, a), service.getExhibitMarking(courseId, b)])
      .then((m) => !cancelled && setMarkings(m))
      .catch(() => !cancelled && setError('The versions couldn’t be loaded.'))
    return () => {
      cancelled = true
    }
  }, [service, courseId, a, b])
  const kind = markings?.[0].markable ?? null
  return (
    <Modal wide eyebrow="Compare versions" title={versions[0].sourceTitle ?? versions[0].title} icon={<Columns2 />} onClose={onClose}>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : !markings ? (
        <p className="muted">Loading the versions…</p>
      ) : kind === 'text' ? (
        <TextComparison versions={versions} parts={[markings[0].parts ?? [], markings[1].parts ?? []]} />
      ) : kind === 'pdf' || kind === 'image' ? (
        <PageComparison courseId={courseId} versions={versions} pdf={kind === 'pdf'} />
      ) : (
        <p className="muted">These versions can’t be shown side by side. Open each one from the card.</p>
      )}
    </Modal>
  )
}

/**
 * The two versions' pages side by side, a row for each page of the original
 * either has (a picture is one row), with a gap where a version doesn't have it.
 */
function PageComparison({ courseId, versions, pdf }: { courseId: string; versions: [ExhibitReview, ExhibitReview]; pdf: boolean }) {
  const service = useCourseService()
  const cantShow = 'This version couldn’t be shown.'
  const first = useFilePages(() => fetchBytes(service.reviewExhibitBytesUrl(courseId, versions[0].id)), pdf, cantShow)
  const second = useFilePages(() => fetchBytes(service.reviewExhibitBytesUrl(courseId, versions[1].id)), pdf, cantShow)
  const loaded = [first, second]
  // A version's pages, in order, are its listed pages of the original (all of them when it lists none).
  const byPage = loaded.map((l, i) => new Map((l.pages ?? []).map((src, j) => [versions[i].parts ? versions[i].parts![j] : j + 1, src])))
  const rows = [...new Set([...byPage[0].keys(), ...byPage[1].keys()])].sort((a, b) => a - b)
  return (
    <div className="xl-compare">
      {versions.map((v, i) => (
        <h3 key={v.id} className="xl-compare-head">
          Version {i + 1} · {EXHIBIT_SIDE[v.offeredBy]}’s <span className="muted">({versionDetail(v)})</span>
        </h3>
      ))}
      {loaded.some((l) => l.loadError) ? (
        <p className="form-error xl-compare-wide">{cantShow}</p>
      ) : loaded.some((l) => !l.pages) ? (
        <p className="muted xl-compare-wide">Loading…</p>
      ) : (
        rows.map((page) => (
          <div key={page} className="xl-compare-row" role="group" aria-label={pdf ? `Page ${page} of the original` : 'The picture'}>
            <span className="xl-compare-label xl-compare-wide">{pdf ? `Page ${page} of the original` : 'The picture'}</span>
            {byPage.map((pages, i) =>
              pages.has(page) ? (
                <figure key={i} className={pdf && !byPage[1 - i].has(page) ? `xl-compare-cell xl-only-${i + 1}` : 'xl-compare-cell'}>
                  <img src={pages.get(page)} alt={`Version ${i + 1}, ${pdf ? `page ${page}` : 'the picture'}`} />
                  {pdf && !byPage[1 - i].has(page) && <figcaption>Only in version {i + 1}</figcaption>}
                </figure>
              ) : (
                <div key={i} className="xl-compare-cell xl-compare-missing">
                  Not in version {i + 1}
                </div>
              ),
            )}
          </div>
        ))
      )}
    </div>
  )
}

/** A text file's paragraphs from both versions in one list: what only one version has is highlighted. */
function TextComparison({ versions, parts }: { versions: [ExhibitReview, ExhibitReview]; parts: [ExhibitPart[], ExhibitPart[]] }) {
  const byN = new Map<number, { part: ExhibitPart; in: [boolean, boolean] }>()
  parts.forEach((list, i) =>
    list.forEach((p) => {
      const row = byN.get(p.n) ?? { part: p, in: [false, false] as [boolean, boolean] }
      row.in[i] = true
      byN.set(p.n, row)
    }),
  )
  const rows = [...byN.entries()].sort(([a], [b]) => a - b)
  return (
    <>
      <p className="xl-compare-legend">
        <span className="xl-only-1">Only in version 1 ({EXHIBIT_SIDE[versions[0].offeredBy].toLowerCase()}’s)</span>
        <span className="xl-only-2">Only in version 2 ({EXHIBIT_SIDE[versions[1].offeredBy].toLowerCase()}’s)</span>
        <span>In both</span>
      </p>
      <ol className="xl-compare-text">
        {rows.map(([n, row]) => {
          const only = row.in[0] && row.in[1] ? null : row.in[0] ? 1 : 2
          return (
            <li key={n} className={only ? `xl-only-${only}` : undefined}>
              <span className="xl-compare-label">
                ¶{n + 1}
                {only && <span className="visually-hidden">, only in version {only}</span>}
              </span>{' '}
              {row.part.text}
            </li>
          )
        })}
      </ol>
    </>
  )
}
