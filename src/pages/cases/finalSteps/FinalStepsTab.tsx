import { useEffect, useState } from 'react'
import { BadgeCheck, Eye, Scale } from 'lucide-react'
import { useCourseService } from '../../../courses/CourseServiceContext'
import { EXHIBIT_SIDE, EXHIBIT_STATUS_LABEL, exhibitLabel } from '../../../courses/exhibitLabels'
import { worldLabel } from '../../../courses/worldLabel'
import type { CourseCase, Exhibit, ExhibitList, WorldExhibits } from '../../../courses/types'
import { ExhibitRecord } from '../../../caseWorkspace/finalSteps/ExhibitListSection'
import { useExhibitViewer } from './useExhibitViewer'
import '../exchange/exchange.css'
import '../../../caseWorkspace/finalSteps/exhibits.css'

/** Where a world's list stands, in a word. */
function worldStatus(w: WorldExhibits) {
  if (w.finalizedAt) return { label: 'Final', tone: 'answered' }
  if (w.plaintiff.submittedAt && w.defense.submittedAt) return { label: 'Settling', tone: 'waiting' }
  const n = Number(Boolean(w.plaintiff.submittedAt)) + Number(Boolean(w.defense.submittedAt))
  return { label: `${n} of 2 lists in`, tone: n === 0 ? 'overdue' : 'waiting' }
}

/**
 * The case's Final steps tab: whether students get the joint exhibit list,
 * and a read-only look at every world's lists and exhibits. Like the
 * information exchange, it's the teams' work; challenges come to Review.
 */
export function FinalStepsTab({
  courseId,
  courseCase,
  onCaseChange,
}: {
  courseId: string
  courseCase: CourseCase
  onCaseChange(updated: CourseCase): void
}) {
  const service = useCourseService()
  const [worlds, setWorlds] = useState<WorldExhibits[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const enabled = courseCase.exhibitListEnabled !== false
  const viewer = useExhibitViewer(courseId, courseCase.id)

  useEffect(() => {
    let cancelled = false
    service
      .listCaseExhibits(courseId, courseCase.id)
      .then((w) => !cancelled && setWorlds(w))
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [service, courseId, courseCase.id])

  async function toggle(next: boolean) {
    setSaving(true)
    setError(null)
    try {
      onCaseChange(await service.setExhibitListEnabled(courseId, courseCase.id, next))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="exchange-tab">
      <div className="exchange-tab-main">
        <section className="course-section" aria-labelledby="exhibits-heading">
          <div className="section-header">
            <div>
              <span className="ws-eyebrow">Read only</span>
              <h2 id="exhibits-heading">Joint exhibit lists</h2>
            </div>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {!worlds ? (
            !error && <p className="muted">Loading…</p>
          ) : worlds.length === 0 ? (
            <p className="muted">This case has no case worlds yet.</p>
          ) : (
            <ul className="exchange-sets">
              {worlds.map((w) => {
                const s = worldStatus(w)
                return (
                  <li key={w.matchupId}>
                    <details className="exchange-set">
                      <summary>
                        <span className="ws-icon-tile ws-icon-tile-sm ws-tone-blue" aria-hidden="true">
                          <Scale />
                        </span>
                        <span>
                          <strong>Case world {worldLabel(w.worldNumber)}</strong>
                          <small>
                            Team {w.teams.plaintiff ?? '?'} (Plaintiff) v. Team {w.teams.defense ?? '?'} (Defense) ·{' '}
                            {w.exhibits.length} {w.exhibits.length === 1 ? 'exhibit' : 'exhibits'}
                          </small>
                        </span>
                        <span className={`exchange-badge exchange-badge-${s.tone}`}>{s.label}</span>
                      </summary>
                      <div className="xl-peek">
                        {w.exhibits.length === 0 ? (
                          <div className="xl-final">
                            <ListPeek list={w.plaintiff} />
                            <ListPeek list={w.defense} />
                          </div>
                        ) : (
                          <ul className="xl-rows">
                            {w.exhibits.map((x) => (
                              <PeekRow key={x.id} exhibit={x} onOpen={() => viewer.open(x)} />
                            ))}
                          </ul>
                        )}
                      </div>
                    </details>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="muted exchange-note">
            <Eye aria-hidden="true" className="exchange-inline-icon" /> Only you can see this view. Challenges to authenticity
            or admission come to the Review page for your ruling, even in review lite.
          </p>
        </section>
      </div>

      <section className="course-section exchange-settings-card" aria-labelledby="final-settings-heading">
        <div className="section-header">
          <h2 id="final-settings-heading">Settings</h2>
        </div>
        <label className="investigator-toggle">
          <input type="checkbox" checked={enabled} disabled={saving} onChange={(e) => toggle(e.target.checked)} />
          Students build a joint exhibit list
        </label>
        <p className="muted exchange-note">
          {enabled
            ? 'In the final steps phase, each side lists its exhibits for trial, the lists are exchanged, and the sides settle authenticity and admission.'
            : 'Students don’t see the joint exhibit list. Turning it back on keeps whatever teams already did.'}
        </p>
      </section>
      {viewer.element}
    </div>
  )
}

function ListPeek({ list }: { list: ExhibitList }) {
  return (
    <div>
      <h3>
        {EXHIBIT_SIDE[list.side]}’s list{' '}
        <span className="muted">
          {list.submittedAt ? `· submitted${list.submittedBy ? ` by ${list.submittedBy}` : ''}` : list.updatedAt ? '· draft' : '· not started'}
        </span>
      </h3>
      {list.items.length === 0 ? (
        <p className="cw-empty">Nothing listed yet.</p>
      ) : (
        <ol className="xl-plain">
          {list.items.map((i) => (
            <li key={`${i.kind}:${i.id}`}>{i.title}</li>
          ))}
        </ol>
      )}
    </div>
  )
}

function PeekRow({ exhibit: x, onOpen }: { exhibit: Exhibit; onOpen(): void }) {
  const label = exhibitLabel(x)
  return (
    <li className="xl-row">
      <div className="xl-row-head">
        {label && <span className="xl-label">{label}</span>}
        <span className={`xl-who xl-who-${x.offeredBy}`}>{x.joint ? 'Joint · Plaintiff’s' : `${EXHIBIT_SIDE[x.offeredBy]}’s`}</span>
        <button type="button" className="link-button xl-title" onClick={onOpen}>
          {x.title}
        </button>
        {x.authenticated && (
          <span className="cw-badge cw-badge-done xl-authentic">
            <BadgeCheck aria-hidden="true" /> Authentic
          </span>
        )}
        <span className="cw-badge">{x.supersededBy ? 'Replaced by the whole' : EXHIBIT_STATUS_LABEL[x.status]}</span>
      </div>
      <ExhibitRecord exhibit={x} />
    </li>
  )
}
