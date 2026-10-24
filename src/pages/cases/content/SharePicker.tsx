import { useId, useState } from 'react'
import type { CaseMaterial, CaseTeams, MaterialShares } from '../../../courses/types'
import { worldName } from './shares'

/** Ticks which case worlds and teams also see a file. */
export function SharePicker({
  material,
  teams,
  onSave,
  onCancel,
}: {
  material: CaseMaterial
  teams: CaseTeams
  /** Throw to show the error here. */
  onSave(shares: MaterialShares): Promise<void>
  onCancel(): void
}) {
  const [matchupIds, setMatchupIds] = useState(material.shares?.matchupIds ?? [])
  const [teamIds, setTeamIds] = useState(material.shares?.teamIds ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = useId()

  const toggle = (list: string[], value: string, on: boolean) => (on ? [...list, value] : list.filter((v) => v !== value))

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await onSave({ matchupIds, teamIds })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setSaving(false)
    }
  }

  const sortedMatchups = [...teams.matchups].sort((a, b) => a.number - b.number)
  const sortedTeams = [...teams.teams].sort((a, b) => a.number - b.number)

  return (
    <div className="share-picker" role="group" aria-labelledby={`${id}-title`}>
      <p id={`${id}-title`} className="share-picker-title">
        Also share {material.description || material.filename} with
      </p>
      {sortedMatchups.length === 0 && sortedTeams.length === 0 ? (
        <p className="muted">Make teams and case worlds first.</p>
      ) : (
        <div className="share-picker-lists">
          {sortedMatchups.length > 0 && (
            <fieldset>
              <legend>Case worlds (both teams)</legend>
              {sortedMatchups.map((m) => (
                <label key={m.id} className="content-check">
                  <input
                    type="checkbox"
                    checked={matchupIds.includes(m.id)}
                    onChange={(e) => setMatchupIds(toggle(matchupIds, m.id, e.target.checked))}
                  />
                  {worldName(teams, m.id)}
                </label>
              ))}
            </fieldset>
          )}
          {sortedTeams.length > 0 && (
            <fieldset>
              <legend>Teams</legend>
              {sortedTeams.map((t) => (
                <label key={t.id} className="content-check">
                  <input
                    type="checkbox"
                    checked={teamIds.includes(t.id)}
                    onChange={(e) => setTeamIds(toggle(teamIds, t.id, e.target.checked))}
                  />
                  Team {t.number}
                </label>
              ))}
            </fieldset>
          )}
        </div>
      )}
      <div className="panel-form-actions">
        <button type="button" className="btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save sharing'}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
