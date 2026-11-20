import { useEffect, useState } from 'react'
import { ClipboardList, FilePen, GraduationCap } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useCourseService } from '../../courses/CourseServiceContext'
import type { LibraryEntry, LibraryKind } from '../../courses/types'
import { useWorkspace } from '../../workspace/useWorkspace'
import { KIND_LABEL, SUBKIND_LABEL, shortDay, tagLabel } from './libraryLabels'
import './library.css'

const KINDS: LibraryKind[] = ['practice', 'discovery', 'planner']
const KIND_ICON: Record<LibraryKind, typeof GraduationCap> = { practice: GraduationCap, discovery: FilePen, planner: ClipboardList }

/**
 * The student's learning library: every piece of AI feedback they've had in
 * the course's cases, newest first. Their own practice sessions, and their
 * team's information-exchange checks and planner feedback, filtered by case,
 * by type (and the kind within it), and to what they asked for themselves.
 * The filters live in the address, so a filtered list can be bookmarked.
 */
export function LibraryPage() {
  const { courseId = '' } = useParams()
  const { home, search } = useWorkspace()
  const service = useCourseService()
  const [params, setParams] = useSearchParams()
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    service
      .listLibrary(courseId)
      .then((e) => !cancelled && setEntries(e))
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [service, courseId])

  const caseId = params.get('case') ?? ''
  const kind = (KINDS as string[]).includes(params.get('type') ?? '') ? (params.get('type') as LibraryKind) : null
  const sub = params.get('sub') ?? ''
  const mine = params.get('mine') === '1'
  const set = (changes: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value)
          else next.delete(key)
        }
        return next
      },
      { replace: true },
    )

  const cases = [...new Map((entries ?? []).map((e) => [e.caseId, e.caseTitle])).entries()]
  const subkinds = kind ? [...new Set((entries ?? []).filter((e) => e.kind === kind).map((e) => e.subkind))] : []
  const shown = (entries ?? []).filter(
    (e) => (!caseId || e.caseId === caseId) && (!kind || e.kind === kind) && (!sub || e.subkind === sub) && (!mine || e.mine),
  )
  const filtered = Boolean(caseId || kind || sub || mine)

  return (
    <main className="ws-page lib-page">
      <div className="ws-welcome">
        <div>
          <span className="ws-eyebrow">{home.course.code}</span>
          <h1 className="ws-title">Learning library</h1>
          <p className="ws-subtle">
            Every piece of AI feedback you&rsquo;ve had in this course: your practice sessions with the witnesses, and your
            team&rsquo;s information-exchange checks and planner feedback. Open one to read it in full, or download it.
          </p>
        </div>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!entries && !error && <p className="ws-subtle">Loading your library…</p>}
      {entries && entries.length === 0 && (
        <p className="ws-subtle">
          Nothing here yet. Practice with a witness, check a draft with AI in the information exchange, or ask for feedback
          on your case planner, and it&rsquo;s kept here.
        </p>
      )}

      {entries && entries.length > 0 && (
        <>
          <div className="lib-filters" role="group" aria-label="Filter the library">
            {cases.length > 1 && (
              <select aria-label="Case" value={caseId} onChange={(e) => set({ case: e.target.value || null })}>
                <option value="">All cases</option>
                {cases.map(([id, title]) => (
                  <option key={id} value={id}>
                    {title}
                  </option>
                ))}
              </select>
            )}
            <div className="lib-kinds" role="group" aria-label="Type of feedback">
              <button type="button" className="lib-kind" aria-pressed={!kind} onClick={() => set({ type: null, sub: null })}>
                All
              </button>
              {KINDS.map((k) => (
                <button key={k} type="button" className="lib-kind" aria-pressed={kind === k} onClick={() => set({ type: k, sub: null })}>
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
            {subkinds.length > 1 && (
              <select aria-label={`Kind of ${KIND_LABEL[kind!].toLowerCase()}`} value={sub} onChange={(e) => set({ sub: e.target.value || null })}>
                <option value="">All kinds</option>
                {subkinds.map((s) => (
                  <option key={s} value={s}>
                    {SUBKIND_LABEL[s] ?? s}
                  </option>
                ))}
              </select>
            )}
            <label className="lib-mine">
              <input type="checkbox" checked={mine} onChange={(e) => set({ mine: e.target.checked ? '1' : null })} />
              Only what I asked for
            </label>
          </div>

          {shown.length === 0 ? (
            <p className="ws-subtle">
              Nothing matches these filters.{' '}
              {filtered && (
                <button type="button" className="pl-link" onClick={() => set({ case: null, type: null, sub: null, mine: null })}>
                  Show everything
                </button>
              )}
            </p>
          ) : (
            <ul className="lib-list" aria-label="Your feedback">
              {shown.map((e) => {
                const Icon = KIND_ICON[e.kind]
                return (
                  <li key={`${e.kind}:${e.id}`}>
                    <Link to={`/courses/${courseId}/library/${e.kind}/${e.id}${search}`} className="lib-row">
                      <span className={`lib-icon lib-icon-${e.kind}`} aria-hidden="true">
                        <Icon />
                      </span>
                      <span className="lib-row-body">
                        <strong>{e.title}</strong>
                        {e.summary && <p>{e.summary}</p>}
                        <small>
                          {KIND_LABEL[e.kind]} · {e.caseTitle} · {e.mine ? (e.kind === 'practice' ? 'Your practice' : 'Asked by you') : `Asked by ${e.by ?? 'your partner'}`}{' '}
                          · {shortDay(e.createdAt)}
                        </small>
                      </span>
                      {e.tag && <span className={`lib-tag lib-tag-${e.tag.toLowerCase()}`}>{tagLabel(e.kind, e.tag)}</span>}
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </main>
  )
}
