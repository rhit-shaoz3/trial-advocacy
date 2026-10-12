import { ArrowRight, Users } from 'lucide-react'
import { Link } from 'react-router'
import { initials } from '../layout/initials'
import { SIDE_LABELS } from './format'
import { PublishControl } from './PublishControl'
import type { InstructorCase } from './types'

interface Props {
  c: InstructorCase
  onPublish(published: boolean): Promise<void>
}

export function TeamsSection({ c, onPublish }: Props) {
  const placed = new Set(c.teams.flatMap((t) => t.members.map((m) => m.id)))
  const unplaced = c.students.filter((s) => !placed.has(s.id))
  const teamName = new Map(c.teams.map((t) => [t.id, t.name]))
  const hasTeams = c.teams.length > 0

  return (
    <section className="panel" aria-labelledby="teams-heading">
      <div className="panel-head">
        <h2 id="teams-heading">Teams &amp; match-ups</h2>
        <PublishControl
          label="teams and matchups"
          published={c.published.teams}
          onChange={onPublish}
        />
      </div>

      {hasTeams && unplaced.length > 0 && (
        <p className="form-warning" role="status">
          {unplaced.length} student{unplaced.length === 1 ? " isn't" : "s aren't"} on a team:{' '}
          {unplaced.map((s) => s.name).join(', ')}
        </p>
      )}

      {!hasTeams && (
        <p className="hint section-intro">
          {c.students.length === 0
            ? 'No students are in this class yet.'
            : `${c.students.length} students in ${c.className} are waiting to be put on teams.`}
        </p>
      )}

      {hasTeams && (
        <div className="team-summary">
          {c.teams.map((team) => (
            <div key={team.id} className="team-summary-card">
              <div className="team-summary-head">
                <Users size={18} aria-hidden className="muted" />
                <h3>{team.name}</h3>
                <span className={`badge badge-${team.side}`}>{SIDE_LABELS[team.side]}</span>
              </div>
              <ul className="mini-people">
                {team.members.map((m) => (
                  <li key={m.id}>
                    <span className="avatar avatar-sm" aria-hidden>
                      {initials(m.name)}
                    </span>
                    {m.name}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {hasTeams && (
        <>
          <h3 className="sub-heading">Match-ups</h3>
          {c.matchups.length === 0 ? (
            <p className="hint">No match-ups yet.</p>
          ) : (
            <ul className="matchup-summary">
              {c.matchups.map((m) => (
                <li key={m.id}>
                  <span className="dot dot-plaintiff" aria-hidden />
                  {teamName.get(m.plaintiffTeamId)} <span className="muted">vs</span>{' '}
                  <span className="dot dot-defendant" aria-hidden />
                  {teamName.get(m.defendantTeamId)}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="actions section-actions">
        <Link to={`/cases/${c.id}/teams`} className="btn btn-primary">
          {hasTeams ? 'Edit teams' : 'Build teams'} <ArrowRight size={16} aria-hidden />
        </Link>
        {hasTeams ? (
          <Link to={`/cases/${c.id}/matchups`} className="btn">
            Edit matchups
          </Link>
        ) : (
          <button type="button" className="btn" disabled>
            Edit matchups
          </button>
        )}
      </div>
    </section>
  )
}
