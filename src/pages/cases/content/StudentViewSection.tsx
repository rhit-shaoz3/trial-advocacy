import { useEffect, useState } from 'react'
import { CaseWorkspaceView } from '../../../caseWorkspace/CaseWorkspaceView'
import { useCourseService } from '../../../courses/CourseServiceContext'
import type { CaseTeams, CaseWorkspace, Side } from '../../../courses/types'
import { ROLE_LABEL, worldLabel } from '../../../courses/worldLabel'

interface Perspective {
  value: string
  label: string
  side: Side
  matchupId: string | null
}

/** Every way to look at the case: each world's two teams, or any team on a side. */
function perspectives(teams: CaseTeams): Perspective[] {
  const number = new Map(teams.teams.map((t) => [t.id, t.number]))
  const fromWorlds = teams.matchups.flatMap((m) =>
    (['plaintiff', 'defense'] as const).map((side) => ({
      value: `${side}:${m.id}`,
      label: `World ${worldLabel(m.number)} · ${ROLE_LABEL[side]} (Team ${number.get(
        side === 'plaintiff' ? m.plaintiffTeamId : m.defenseTeamId,
      )})`,
      side,
      matchupId: m.id,
    })),
  )
  return [
    ...fromWorlds,
    { value: 'plaintiff:', label: 'Any plaintiff team', side: 'plaintiff', matchupId: null },
    { value: 'defense:', label: 'Any defense team', side: 'defense', matchupId: null },
  ]
}

/**
 * The case dashboard exactly as a team sees it, read-only. The instructor picks
 * a world and side, or just a side to check what that side's material looks like.
 */
export function StudentViewSection({
  courseId,
  caseId,
  instructorName,
  instructorAvatarUrl,
}: {
  courseId: string
  caseId: string
  instructorName?: string | null
  instructorAvatarUrl?: string | null
}) {
  const service = useCourseService()
  const [options, setOptions] = useState<Perspective[] | null>(null)
  const [selected, setSelected] = useState('')
  const [workspace, setWorkspace] = useState<CaseWorkspace | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    service
      .listTeams(courseId, caseId)
      .then((teams) => {
        if (cancelled) return
        const list = perspectives(teams)
        setOptions(list)
        setSelected(list[0].value)
      })
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [service, courseId, caseId])

  useEffect(() => {
    const choice = options?.find((o) => o.value === selected)
    if (!choice) return
    let cancelled = false
    setError(null)
    service
      .previewWorkspace(courseId, caseId, choice.side, choice.matchupId)
      .then((w) => !cancelled && setWorkspace(w))
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [service, courseId, caseId, options, selected])

  return (
    <section className="course-section" aria-labelledby="student-view-heading">
      <div className="section-header">
        <h2 id="student-view-heading">Student view</h2>
        {options && (
          <label className="preview-picker">
            View as
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p className="muted section-hint">
        Exactly what that team sees on its case dashboard, including its task progress. Nothing here can
        be changed.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!workspace ? (
        !error && <p className="muted">Loading preview…</p>
      ) : (
        <div className="preview-frame">
          <CaseWorkspaceView
            workspace={workspace}
            downloadUrl={(id) => service.materialDownloadUrl(courseId, caseId, id)}
            instructorName={instructorName}
            instructorAvatarUrl={instructorAvatarUrl}
          />
        </div>
      )}
    </section>
  )
}
