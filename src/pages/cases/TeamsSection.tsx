import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useCourseService } from '../../courses/CourseServiceContext'
import { MAX_TEAM_SIZE, type CaseTeams, type RosterEntry, type Team } from '../../courses/types'
import { WorldsSection } from './WorldsSection'

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
              {unpaired.length > 0 && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => run(() => service.autoPair(courseId, caseId))}
                  disabled={busy}
                >
                  {unpaired.length === 1 ? 'Auto-pair 1 student' : `Auto-pair ${unpaired.length} students`}
                </button>
              )}
            </div>
          )}
        </div>

        {!data ? (
          <p className="muted section-hint">Loading teams…</p>
        ) : (
          <p className="muted section-hint">
            {teams.length === 1 ? '1 team' : `${teams.length} teams`} · {pairedCount} paired ·{' '}
            {unpaired.length} not on a team.{' '}
            {closed
              ? 'This case is closed, so its teams are kept as they are.'
              : 'Auto-pair avoids partners students had in earlier cases. An odd student out joins a team of three.'}
          </p>
        )}

        {error?.in === 'teams' && (
          <p className="form-error" role="alert">
            {error.message}
          </p>
        )}

        {data && unpaired.length > 0 && (
          <div className="unpaired-panel">
            <div className="unpaired-header">
              <h3>Not on a team ({unpaired.length})</h3>
              {!closed && (
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
            <ul className="unpaired-list">
              {unpaired.map((s) => (
                <li key={s.email}>
                  {closed ? (
                    <StudentLabel student={s} />
                  ) : (
                    <label>
                      <input
                        type="checkbox"
                        checked={selected.includes(s.email)}
                        onChange={() => toggle(s.email)}
                        disabled={busy}
                      />
                      <StudentLabel student={s} />
                    </label>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {data && teams.length === 0 && unpaired.length === 0 && (
          <p className="muted">No students on the roster yet. Add them under Manage course.</p>
        )}

        {teams.length > 0 && (
          <ul className="team-grid" aria-label="Teams">
            {teams.map((team) => (
              <li key={team.id} className="team-card" aria-label={`Team ${team.number}`}>
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
                      <StudentLabel student={m} />
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
              </li>
            ))}
          </ul>
        )}
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
