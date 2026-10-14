import { useState, type FormEvent } from 'react'
import { useCourseService } from '../../courses/CourseServiceContext'
import type { CaseTeams, Team } from '../../courses/types'
import { worldLabel } from '../../courses/worldLabel'

/** "Team 3: Ava Thompson & Ben Okafor" */
function teamSummary(team: Team) {
  const names = team.members.map((m) => m.name ?? m.email)
  return `Team ${team.number}: ${names.join(' & ')}`
}

/**
 * The case worlds: matchups of two teams, one per side. Shares the pairing
 * state (and the request runner) with the Teams section above it, since
 * changing teams can remove a world.
 */
export function WorldsSection({
  courseId,
  caseId,
  data,
  busy,
  closed,
  error,
  run,
}: {
  courseId: string
  caseId: string
  data: CaseTeams
  busy: boolean
  closed: boolean
  /** The last failed change made from this section. */
  error: string | null
  run(change: () => Promise<CaseTeams>): Promise<boolean>
}) {
  const service = useCourseService()
  const [plaintiff, setPlaintiff] = useState('')
  const [defense, setDefense] = useState('')

  const teamById = new Map(data.teams.map((t) => [t.id, t]))
  const matched = new Set(data.matchups.flatMap((m) => [m.plaintiffTeamId, m.defenseTeamId]))
  const waiting = data.teams.filter((t) => !matched.has(t.id))
  // Drop a choice that is no longer waiting (e.g. matched by auto-match).
  const plaintiffId = waiting.some((t) => t.id === plaintiff) ? plaintiff : ''
  const defenseId = waiting.some((t) => t.id === defense) ? defense : ''

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    const ok = await run(() => service.createMatchup(courseId, caseId, plaintiffId, defenseId))
    if (ok) {
      setPlaintiff('')
      setDefense('')
    }
  }

  function handleClear() {
    if (!window.confirm('Delete every case world? The teams stay as they are.')) return
    run(() => service.clearMatchups(courseId, caseId))
  }

  function handleDelete(id: string, number: number) {
    if (!window.confirm(`Delete World ${worldLabel(number)}? Its two teams go back to waiting.`)) return
    run(() => service.deleteMatchup(courseId, caseId, id))
  }

  return (
    <section className="course-section" aria-labelledby="worlds-heading">
      <div className="section-header">
        <h2 id="worlds-heading">Case worlds</h2>
        {!closed && (
          <div className="teams-actions">
            {data.matchups.length > 0 && (
              <button type="button" className="btn-danger" onClick={handleClear} disabled={busy}>
                Clear all worlds
              </button>
            )}
            {waiting.length >= 2 && (
              <button
                type="button"
                className="btn-primary"
                onClick={() => run(() => service.autoMatch(courseId, caseId))}
                disabled={busy}
              >
                Auto-match {waiting.length} teams
              </button>
            )}
          </div>
        )}
      </div>
      <p className="muted section-hint">
        {data.matchups.length === 1 ? '1 world' : `${data.matchups.length} worlds`} ·{' '}
        {waiting.length} {waiting.length === 1 ? 'team' : 'teams'} waiting for an opponent.{' '}
        {closed
          ? 'This case is closed, so its worlds are kept as they are.'
          : 'Each world sets a plaintiff team against a defense team. Auto-match avoids opponents students faced in earlier cases and gives each team the side it has argued less.'}
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {data.teams.length === 0 ? (
        <p className="muted">Pair students into teams first.</p>
      ) : (
        waiting.length > 0 && (
          <div className="unpaired-panel">
            <h3>Waiting for an opponent ({waiting.length})</h3>
            <ul className="waiting-list">
              {waiting.map((t) => (
                <li key={t.id}>{teamSummary(t)}</li>
              ))}
            </ul>
            {!closed && waiting.length >= 2 && (
              <form className="world-form" onSubmit={handleCreate} aria-label="New case world">
                <label>
                  Plaintiff
                  <select value={plaintiffId} onChange={(e) => setPlaintiff(e.target.value)} disabled={busy}>
                    <option value="">Choose a team…</option>
                    {waiting.map((t) => (
                      <option key={t.id} value={t.id} disabled={t.id === defenseId}>
                        Team {t.number}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Defense
                  <select value={defenseId} onChange={(e) => setDefense(e.target.value)} disabled={busy}>
                    <option value="">Choose a team…</option>
                    {waiting.map((t) => (
                      <option key={t.id} value={t.id} disabled={t.id === plaintiffId}>
                        Team {t.number}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  className="btn-secondary"
                  disabled={busy || !plaintiffId || !defenseId}
                >
                  Create world
                </button>
              </form>
            )}
          </div>
        )
      )}

      {data.matchups.length > 0 && (
        <ul className="team-grid world-grid" aria-label="Case worlds">
          {data.matchups.map((m) => {
            const sides = [
              { label: 'Plaintiff', team: teamById.get(m.plaintiffTeamId) },
              { label: 'Defense', team: teamById.get(m.defenseTeamId) },
            ]
            return (
              <li key={m.id} className="team-card" aria-label={`World ${worldLabel(m.number)}`}>
                <div className="team-card-header">
                  <h3>World {worldLabel(m.number)}</h3>
                  {!closed && (
                    <span className="world-actions">
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => run(() => service.swapSides(courseId, caseId, m.id))}
                        disabled={busy}
                      >
                        Swap sides
                      </button>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => handleDelete(m.id, m.number)}
                        disabled={busy}
                      >
                        Delete
                      </button>
                    </span>
                  )}
                </div>
                <dl className="world-sides">
                  {sides.map(({ label, team }) => (
                    <div key={label} className={`world-side world-side-${label.toLowerCase()}`}>
                      <dt>{label}</dt>
                      <dd>{team ? teamSummary(team) : 'Unknown team'}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
