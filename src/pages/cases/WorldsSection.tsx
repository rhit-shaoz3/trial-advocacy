import { useState, type FormEvent } from 'react'
import { DndContext, type DragEndEvent } from '@dnd-kit/core'
import { useCourseService } from '../../courses/CourseServiceContext'
import type { CaseTeams, Side, Team } from '../../courses/types'
import { worldLabel } from '../../courses/worldLabel'
import { Draggable, DropZone } from './dnd'
import { useDragSensors } from './useDragSensors'

/** Drop targets for the new world's two sides. */
const SLOT: Record<Side, string> = { plaintiff: 'slot:plaintiff', defense: 'slot:defense' }

/** "Team 3: Ava Thompson & Ben Okafor" */
function teamSummary(team: Team) {
  const names = team.members.map((m) => m.name ?? m.email)
  return `Team ${team.number}: ${names.join(' & ')}`
}

/**
 * The case worlds: matchups of two teams, one per side. Drag waiting teams
 * into the new world's Plaintiff and Defense slots (or choose them from the
 * menus); once both are filled, the world is made. Shares the pairing state
 * (and the request runner) with the Teams section above it, since changing
 * teams can remove a world.
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
  const sensors = useDragSensors()

  const teamById = new Map(data.teams.map((t) => [t.id, t]))
  const matched = new Set(data.matchups.flatMap((m) => [m.plaintiffTeamId, m.defenseTeamId]))
  const waiting = data.teams.filter((t) => !matched.has(t.id))
  // Drop a choice that is no longer waiting (e.g. matched by auto-match).
  const plaintiffId = waiting.some((t) => t.id === plaintiff) ? plaintiff : ''
  const defenseId = waiting.some((t) => t.id === defense) ? defense : ''

  async function create(plaintiffTeam: string, defenseTeam: string) {
    const ok = await run(() => service.createMatchup(courseId, caseId, plaintiffTeam, defenseTeam))
    if (ok) {
      setPlaintiff('')
      setDefense('')
    }
  }

  function handleCreate(e: FormEvent) {
    e.preventDefault()
    void create(plaintiffId, defenseId)
  }

  /** Dropping a team into a side's slot picks it; filling both slots makes the world. */
  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || busy) return
    const teamId = String(active.id)
    const side = over.id === SLOT.plaintiff ? 'plaintiff' : over.id === SLOT.defense ? 'defense' : null
    if (!side) return
    const other = side === 'plaintiff' ? defenseId : plaintiffId
    // The same team can't be on both sides.
    const otherId = other === teamId ? '' : other
    if (side === 'plaintiff') {
      setPlaintiff(teamId)
      if (other === teamId) setDefense('')
    } else {
      setDefense(teamId)
      if (other === teamId) setPlaintiff('')
    }
    if (otherId) void create(side === 'plaintiff' ? teamId : otherId, side === 'plaintiff' ? otherId : teamId)
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
          <DndContext id="worlds-dnd" sensors={sensors} onDragEnd={handleDragEnd}>
            <div className="unpaired-panel">
              <h3>Waiting for an opponent ({waiting.length})</h3>
              <ul className="waiting-list">
                {waiting.map((t) => (
                  <li key={t.id}>
                    {closed ? (
                      teamSummary(t)
                    ) : (
                      <Draggable
                        id={t.id}
                        label={`Drag Team ${t.number} into a side of the new world`}
                        className="team-drag waiting-team"
                        disabled={busy}
                      >
                        <span>{teamSummary(t)}</span>
                      </Draggable>
                    )}
                  </li>
                ))}
              </ul>
              {!closed && waiting.length >= 2 && (
                <form className="world-form world-builder" onSubmit={handleCreate} aria-label="New case world">
                  <h4>New world</h4>
                  <p className="muted">Drag a team into each side, or choose them below.</p>
                  <div className="world-slots">
                    {(['plaintiff', 'defense'] as const).map((side) => {
                      const value = side === 'plaintiff' ? plaintiffId : defenseId
                      const taken = side === 'plaintiff' ? defenseId : plaintiffId
                      const chosen = teamById.get(value)
                      return (
                        <DropZone
                          key={side}
                          id={SLOT[side]}
                          className={`world-slot world-side-${side}`}
                          label={`${side === 'plaintiff' ? 'Plaintiff' : 'Defense'} side of the new world`}
                        >
                          <label>
                            {side === 'plaintiff' ? 'Plaintiff' : 'Defense'}
                            <select
                              value={value}
                              onChange={(e) => (side === 'plaintiff' ? setPlaintiff : setDefense)(e.target.value)}
                              disabled={busy}
                            >
                              <option value="">Choose a team…</option>
                              {waiting.map((t) => (
                                <option key={t.id} value={t.id} disabled={t.id === taken}>
                                  Team {t.number}
                                </option>
                              ))}
                            </select>
                          </label>
                          <p className="world-slot-team">{chosen ? teamSummary(chosen) : 'Drop a team here'}</p>
                        </DropZone>
                      )
                    })}
                  </div>
                  <button type="submit" className="btn-secondary" disabled={busy || !plaintiffId || !defenseId}>
                    Create world
                  </button>
                </form>
              )}
            </div>
          </DndContext>
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
