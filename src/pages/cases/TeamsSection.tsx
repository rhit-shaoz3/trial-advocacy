import { useEffect, useState, type FormEvent } from 'react'
import { DndContext, type DragEndEvent } from '@dnd-kit/core'
import { X } from 'lucide-react'
import { useCourseService } from '../../courses/CourseServiceContext'
import {
  MAX_AUTO_TEAM_SIZE,
  MAX_TEAM_SIZE,
  MIN_AUTO_TEAM_SIZE,
  type CaseTeams,
  type RosterEntry,
  type Team,
} from '../../courses/types'
import { autoPairPreview } from './autoPair'
import { Draggable, DropZone } from './dnd'
import { useDragSensors } from './useDragSensors'
import { WorldsSection } from './WorldsSection'

/** Drop target ids: the "Not on a team" list, and each team card by its id. */
const UNPAIRED = 'unpaired'
const teamDrop = (id: string) => `team:${id}`


type Section = 'teams' | 'worlds'

const displayName = (s: RosterEntry) => s.name ?? s.email

function StudentLabel({ student }: { student: RosterEntry }) {
  return (
    <span className="team-student" title={student.email}>
      <span className="team-student-name">{displayName(student)}</span>
      {!student.joined && <span className="badge badge-pending">Pending</span>}
    </span>
  )
}

/**
 * Pairing students into teams for one case (auto-pair everyone left, pair
 * chosen students by hand, adjust teams afterwards), followed by the case
 * worlds those teams are matched into. Read-only once the case is closed.
 */
export function TeamsSection({
  courseId,
  caseId,
  closed,
  onChange,
}: {
  courseId: string
  caseId: string
  closed: boolean
  /** Called after any team or case world change, e.g. to refresh the dashboard. */
  onChange?(): void
}) {
  const service = useCourseService()
  const [data, setData] = useState<CaseTeams | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Shown in the section whose button caused it.
  const [error, setError] = useState<{ in: Section; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  /** The auto-pair dialog's team size, while it's open. */
  const [autoSize, setAutoSize] = useState<string | null>(null)
  const sensors = useDragSensors()

  useEffect(() => {
    let cancelled = false
    service
      .listTeams(courseId, caseId)
      .then((d) => !cancelled && setData(d))
      .catch((err: Error) => !cancelled && setLoadError(err.message))
    return () => {
      cancelled = true
    }
  }, [service, courseId, caseId])

  /**
   * Runs one change; the server answers with the pairing as it is now.
   * Resolves to whether it worked.
   */
  async function run(change: () => Promise<CaseTeams>, section: Section = 'teams') {
    setError(null)
    setBusy(true)
    try {
      const next = await change()
      setData(next)
      onChange?.()
      setSelected((prev) => prev.filter((email) => next.unpaired.some((s) => s.email === email)))
      return true
    } catch (err) {
      setError({ in: section, message: err instanceof Error ? err.message : 'Something went wrong.' })
      return false
    } finally {
      setBusy(false)
    }
  }

  function toggle(email: string) {
    setSelected((prev) => (prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email]))
  }

  function handleClear() {
    if (!window.confirm('Unpair every student in this case? This deletes all of its teams and case worlds.')) {
      return
    }
    run(() => service.clearTeams(courseId, caseId))
  }

  /** Dragging a student onto a team (or back to "Not on a team") moves them there. */
  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || !data) return
    const email = String(active.id)
    const from = data.teams.find((t) => t.members.some((m) => m.email === email))
    const toId = over.id === UNPAIRED ? null : String(over.id).replace(/^team:/, '')
    if ((from?.id ?? null) === toId) return
    const to = data.teams.find((t) => t.id === toId)
    if (to && to.members.length >= MAX_TEAM_SIZE) {
      setError({ in: 'teams', message: `A team can have at most ${MAX_TEAM_SIZE} students.` })
      return
    }
    run(async () => {
      const removed = from ? await service.removeTeamMember(courseId, caseId, from.id, email) : null
      if (!toId) return removed!
      try {
        return await service.addTeamMember(courseId, caseId, toId, email)
      } catch (err) {
        // They're off their old team already, so show where things stand.
        if (removed) setData(removed)
        throw err
      }
    })
  }

  const teamSize = Number(autoSize)
  const sizeOk = Number.isInteger(teamSize) && teamSize >= MIN_AUTO_TEAM_SIZE && teamSize <= MAX_AUTO_TEAM_SIZE

  async function handleAutoPair(e: FormEvent) {
    e.preventDefault()
    if (!sizeOk) return
    if (await run(() => service.autoPair(courseId, caseId, teamSize))) setAutoSize(null)
  }

  function handleDeleteTeam(team: Team) {
    const message =
      `Delete Team ${team.number}? Its students go back to the unpaired list` +
      (data?.matchups.some((m) => m.plaintiffTeamId === team.id || m.defenseTeamId === team.id)
        ? ', and its case world is deleted.'
        : '.')
    if (!window.confirm(message)) return
    run(() => service.deleteTeam(courseId, caseId, team.id))
  }

  if (loadError) {
    return (
      <section className="course-section" aria-labelledby="teams-heading">
        <h2 id="teams-heading">Teams</h2>
        <p className="form-error" role="alert">
          Could not load the teams. {loadError}
        </p>
      </section>
    )
  }

  const teams = data?.teams ?? []
  const unpaired = data?.unpaired ?? []
  const pairedCount = teams.reduce((n, t) => n + t.members.length, 0)

  return (
    <>
      <section className="course-section" aria-labelledby="teams-heading">
        <div className="section-header">
          <h2 id="teams-heading">Teams</h2>
          {data && !closed && (
            <div className="teams-actions">
              {teams.length > 0 && (
                <button type="button" className="btn-danger" onClick={handleClear} disabled={busy}>
                  Clear all teams
                </button>
              )}
              {unpaired.length > 0 && autoSize === null && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => setAutoSize(String(MIN_AUTO_TEAM_SIZE))}
                  disabled={busy}
                >
                  {unpaired.length === 1 ? 'Auto-pair 1 student' : `Auto-pair ${unpaired.length} students`}
                </button>
              )}
            </div>
          )}
        </div>

        {autoSize !== null && unpaired.length > 0 && (
          <form className="panel-form auto-pair-form" role="dialog" aria-label="Auto-pair" onSubmit={handleAutoPair}>
            <label>
              How many students per team?
              <input
                type="number"
                min={MIN_AUTO_TEAM_SIZE}
                max={MAX_AUTO_TEAM_SIZE}
                value={autoSize}
                onChange={(e) => setAutoSize(e.target.value)}
                autoFocus
              />
            </label>
            <p className="muted" aria-live="polite">
              {sizeOk
                ? autoPairPreview(unpaired.length, teamSize)
                : `Choose ${MIN_AUTO_TEAM_SIZE} to ${MAX_AUTO_TEAM_SIZE} students per team.`}
            </p>
            <div className="panel-form-actions">
              <button
                type="submit"
                className="btn-primary"
                disabled={busy || !sizeOk || unpaired.length < teamSize}
              >
                Make teams
              </button>
              <button type="button" className="btn-secondary" onClick={() => setAutoSize(null)} disabled={busy}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {!data ? (
          <p className="muted section-hint">Loading teams…</p>
        ) : (
          <p className="muted section-hint">
            {teams.length === 1 ? '1 team' : `${teams.length} teams`} · {pairedCount} paired ·{' '}
            {unpaired.length} not on a team.{' '}
            {closed
              ? 'This case is closed, so its teams are kept as they are.'
              : 'Auto-pair makes teams of the size you choose and avoids partners students had in earlier cases; anyone left over stays here for you to place. Drag students by their handle to move them between teams.'}
          </p>
        )}

        {error?.in === 'teams' && (
          <p className="form-error" role="alert">
            {error.message}
          </p>
        )}

        <DndContext id="teams-dnd" sensors={sensors} onDragEnd={handleDragEnd}>
          {data && (unpaired.length > 0 || (teams.length > 0 && !closed)) && (
            <DropZone id={UNPAIRED} className="unpaired-panel" label="Not on a team">
              <div className="unpaired-header">
                <h3>Not on a team{unpaired.length > 0 && ` (${unpaired.length})`}</h3>
                {!closed && unpaired.length > 0 && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => run(() => service.createTeam(courseId, caseId, selected))}
                    disabled={busy || selected.length === 0 || selected.length > MAX_TEAM_SIZE}
                  >
                    {selected.length > MAX_TEAM_SIZE
                      ? `Choose at most ${MAX_TEAM_SIZE}`
                      : `Pair selected${selected.length ? ` (${selected.length})` : ''}`}
                  </button>
                )}
              </div>
              {unpaired.length === 0 && <p className="muted">Drag a student here to take them off their team.</p>}
              <ul className="unpaired-list">
                {unpaired.map((s) => (
                  <li key={s.email}>
                    {closed ? (
                      <StudentLabel student={s} />
                    ) : (
                      <Draggable id={s.email} label={`Drag ${displayName(s)} onto a team`} className="team-drag" disabled={busy}>
                        <label>
                          <input
                            type="checkbox"
                            checked={selected.includes(s.email)}
                            onChange={() => toggle(s.email)}
                            disabled={busy}
                          />
                          <StudentLabel student={s} />
                        </label>
                      </Draggable>
                    )}
                  </li>
                ))}
              </ul>
            </DropZone>
          )}

          {data && teams.length === 0 && unpaired.length === 0 && (
            <p className="muted">No students on the roster yet. Add them under Manage course.</p>
          )}

          {teams.length > 0 && (
            <ul className="team-grid" aria-label="Teams">
              {teams.map((team) => (
                <DropZone as="li" id={teamDrop(team.id)} key={team.id} className="team-card" label={`Team ${team.number}`}>
                  <div className="team-card-header">
                    <h3>Team {team.number}</h3>
                    {!closed && (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => handleDeleteTeam(team)}
                        disabled={busy}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                  <ul className="team-members">
                    {team.members.map((m) => (
                      <li key={m.email}>
                        {closed ? (
                          <StudentLabel student={m} />
                        ) : (
                          <Draggable id={m.email} label={`Drag ${displayName(m)} to another team`} className="team-drag" disabled={busy}>
                            <StudentLabel student={m} />
                          </Draggable>
                        )}
                        {!closed && (
                          <button
                            type="button"
                            className="icon-button"
                            onClick={() =>
                              run(() => service.removeTeamMember(courseId, caseId, team.id, m.email))
                            }
                            disabled={busy}
                            aria-label={`Remove ${displayName(m)} from Team ${team.number}`}
                            title="Remove from team"
                          >
                            <X aria-hidden="true" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {!closed && team.members.length < MAX_TEAM_SIZE && unpaired.length > 0 && (
                    <select
                      className="team-add"
                      value=""
                      onChange={(e) =>
                        run(() => service.addTeamMember(courseId, caseId, team.id, e.target.value))
                      }
                      disabled={busy}
                      aria-label={`Add a student to Team ${team.number}`}
                    >
                      <option value="">Add a student…</option>
                      {unpaired.map((s) => (
                        <option key={s.email} value={s.email}>
                          {displayName(s)}
                        </option>
                      ))}
                    </select>
                  )}
                </DropZone>
              ))}
            </ul>
          )}
        </DndContext>
      </section>

      {data && (
        <WorldsSection
          courseId={courseId}
          caseId={caseId}
          data={data}
          busy={busy}
          closed={closed}
          error={error?.in === 'worlds' ? error.message : null}
          run={(change) => run(change, 'worlds')}
        />
      )}
    </>
  )
}
