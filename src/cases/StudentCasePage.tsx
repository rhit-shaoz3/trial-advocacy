import { Download, FileText, UserRound } from 'lucide-react'
import { useCallback, type ReactNode } from 'react'
import { useParams } from 'react-router'
import { useLoad } from '../api/useLoad'
import { useAuth } from '../auth/useAuth'
import type { Person } from '../classes/types'
import { firstName, initials } from '../layout/initials'
import { PageFrame } from '../layout/PageFrame'
import { useCasesApi } from './CasesApiContext'
import { formatBytes, ROLE_LABELS, SIDE_LABELS } from './format'
import { documentUrl } from './httpCasesApi'
import './Cases.css'

const NOT_RELEASED = "Your instructor hasn't released this yet."

function PersonRow({ person }: { person: Person }) {
  return (
    <li className="person">
      <span className="avatar" aria-hidden>
        {initials(person.name)}
      </span>
      <span className="person-text">
        <span>{person.name}</span>
        <span>{person.email}</span>
      </span>
    </li>
  )
}

function Card({ id, title, children, aside }: { id: string; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="panel" aria-labelledby={id}>
      <div className="panel-head">
        <h2 id={id}>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function StudentCasePage() {
  const { caseId = '' } = useParams()
  const { user } = useAuth()
  const api = useCasesApi()
  const { data: c, error } = useLoad(useCallback(() => api.getStudentCase(caseId), [api, caseId]))

  const team = c?.team
  return (
    <PageFrame crumbs={[{ label: 'My cases', to: '/cases' }, { label: c?.name ?? 'Case' }]}>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {c && (
        <>
          <div className="page-header">
            <div>
              <p className="eyebrow">Your simulation workspace</p>
              <h1 className="page-title">
                Welcome to your case{user ? `, ${firstName(user.name)}` : ''}.
              </h1>
              <p className="page-lede">Meet your team and start building your argument.</p>
            </div>
            <span className="badge badge-muted">{c.className}</span>
          </div>

          <section className="case-hero" aria-label="Assigned case">
            <div className="case-hero-main">
              <p className="eyebrow hero-eyebrow">Assigned case · {c.className}</p>
              <p className="serif case-hero-name">{c.name}</p>
              {team && team.opponents.length > 0 && (
                <p className="hint">
                  {team.name} vs {team.opponents.map((o) => o.name).join(' and ')}
                </p>
              )}
            </div>
            <div className="case-hero-side">
              <p className="eyebrow hero-eyebrow">Your side</p>
              {team ? (
                <>
                  <p className={`serif case-hero-sidename side-${team.side}`}>
                    {SIDE_LABELS[team.side]}
                  </p>
                  <p className="hint">{team.name}</p>
                </>
              ) : (
                <p className="hint">
                  {c.published.teams ? "You haven't been put on a team yet." : 'Announced with teams.'}
                </p>
              )}
            </div>
          </section>

          <div className="two-col">
            <div className="page-stack">
              <Card
                id="characters-heading"
                title="Characters"
                aside={
                  c.characters && c.characters.length > 0 ? (
                    <span className="hint">{c.characters.length} available</span>
                  ) : undefined
                }
              >
                {c.characters === null ? (
                  <p className="hint">{NOT_RELEASED}</p>
                ) : c.characters.length === 0 ? (
                  <p className="hint">No characters yet.</p>
                ) : (
                  <ul className="character-grid">
                    {c.characters.map((ch) => (
                      <li key={ch.id} className="character-card">
                        <div className="character-card-top">
                          <span className="avatar avatar-muted" aria-hidden>
                            <UserRound size={18} />
                          </span>
                          <span className="badge">{ROLE_LABELS[ch.role]}</span>
                        </div>
                        <p className="character-name">{ch.name}</p>
                        <p className="hint">{ch.title}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card id="documents-heading" title="Case files">
                {c.documents === null ? (
                  <p className="hint">{NOT_RELEASED}</p>
                ) : c.documents.length === 0 ? (
                  <p className="hint">No files yet.</p>
                ) : (
                  <ul className="rows">
                    {c.documents.map((doc) => (
                      <li key={doc.id}>
                        <span className="icon-tile" aria-hidden>
                          <FileText size={18} />
                        </span>
                        <span className="row-main">
                          <span>{doc.filename}</span>
                          <span>{formatBytes(doc.sizeBytes)}</span>
                        </span>
                        <a href={documentUrl(c.id, doc.id)} className="link-arrow" aria-label={doc.filename}>
                          <Download size={16} aria-hidden /> Download
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            <Card id="team-heading" title="Your match-up">
              {!c.published.teams ? (
                <p className="hint">{NOT_RELEASED}</p>
              ) : !team ? (
                <p className="hint">You haven't been put on a team yet.</p>
              ) : (
                <div className="matchup-side">
                  <div className="matchup-side-team">
                    <strong>{team.name}</strong>
                    <span className={`badge badge-${team.side}`}>{SIDE_LABELS[team.side]}</span>
                  </div>
                  <p className="eyebrow">Your teammates</p>
                  {team.teammates.length === 0 ? (
                    <p className="hint">You're on your own for this one.</p>
                  ) : (
                    <ul className="people-list">
                      {team.teammates.map((m) => (
                        <PersonRow key={m.id} person={m} />
                      ))}
                    </ul>
                  )}

                  <hr className="divider" />
                  <p className="eyebrow">
                    Opposing {team.opponents.length > 1 ? 'teams' : 'team'}
                  </p>
                  {team.opponents.length === 0 ? (
                    <p className="hint">Your team hasn't been matched with an opponent yet.</p>
                  ) : (
                    team.opponents.map((o) => (
                      <div key={o.id} className="opponent">
                        <div className="matchup-side-team">
                          <strong>{o.name}</strong>
                          <span className={`badge badge-${o.side}`}>{SIDE_LABELS[o.side]}</span>
                        </div>
                        <ul className="people-list">
                          {o.members.map((m) => (
                            <PersonRow key={m.id} person={m} />
                          ))}
                        </ul>
                      </div>
                    ))
                  )}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </PageFrame>
  )
}
