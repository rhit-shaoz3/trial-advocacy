import { DndContext, type DragEndEvent } from '@dnd-kit/core'
import { ArrowLeft, Check, Info, Plus, Shuffle, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { errorMessage } from '../dashboard/errorMessage'
import { PageFrame } from '../layout/PageFrame'
import { autoMatchups } from './autoMatch'
import { useCasesApi } from './CasesApiContext'
import { Draggable, DropZone } from './dnd'
import { SIDE_LABELS } from './format'
import { Stepper } from './Stepper'
import type { InstructorCase, Side, Team } from './types'
import { useDragSensors } from './useDragSensors'
import './Cases.css'

/** "Match A", "Match B", … "Match Z", "Match 27", … */
const matchLabel = (i: number) => `Match ${i < 26 ? String.fromCharCode(65 + i) : i + 1}`

const NEW_MATCHUP = 'new-matchup'

/** A matchup being edited; either slot may still be empty. */
interface DraftMatchup {
  key: string
  plaintiff: string | null
  defendant: string | null
}

const slotId = (key: string, side: Side) => `slot|${key}|${side}`
const teamDragId = (teamId: string) => `team|${teamId}`

function findProblems(matchups: DraftMatchup[]) {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const [i, m] of matchups.entries()) {
    if (!m.plaintiff || !m.defendant) {
      problems.push(`${matchLabel(i)} needs both a plaintiff and a defendant team.`)
      continue
    }
    const pair = `${m.plaintiff}|${m.defendant}`
    if (seen.has(pair)) problems.push(`${matchLabel(i)} repeats the same two teams.`)
    seen.add(pair)
  }
  return problems
}

export function MatchupBuilderPage() {
  const { caseId = '' } = useParams()
  const api = useCasesApi()
  const navigate = useNavigate()
  const sensors = useDragSensors()
  const [c, setCase] = useState<InstructorCase | null>(null)
  const [matchups, setMatchups] = useState<DraftMatchup[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const keyCounter = useRef(0)
  const newKey = () => `new-${++keyCounter.current}`

  useEffect(() => {
    api
      .getInstructorCase(caseId)
      .then((loaded) => {
        setCase(loaded)
        setMatchups(
          loaded.matchups.map((m) => ({
            key: m.id,
            plaintiff: m.plaintiffTeamId,
            defendant: m.defendantTeamId,
          })),
        )
      })
      .catch((err) => setError(errorMessage(err)))
  }, [api, caseId])

  if (!c) {
    return (
      <PageFrame crumbs={[{ label: 'Cases', to: '/cases' }, { label: 'Match-ups' }]}>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </PageFrame>
    )
  }

  const teamById = new Map(c.teams.map((t) => [t.id, t]))
  const bySide = (side: Side) => c.teams.filter((t) => t.side === side)
  const inUse = new Set(matchups.flatMap((m) => [m.plaintiff, m.defendant]))
  const unmatched = c.teams.filter((t) => !inUse.has(t.id))
  const problems = findProblems(matchups)

  function setSlot(key: string, side: Side, teamId: string | null) {
    setMatchups((current) => current.map((m) => (m.key === key ? { ...m, [side]: teamId } : m)))
  }

  function addMatchup(plaintiff: string | null = null, defendant: string | null = null) {
    setMatchups((current) => [...current, { key: newKey(), plaintiff, defendant }])
  }

  /** Puts `team` in a new matchup against `opponentId`. */
  function matchWith(team: Team, opponentId: string) {
    if (team.side === 'plaintiff') addMatchup(team.id, opponentId)
    else addMatchup(opponentId, team.id)
  }

  function runAutoMatch() {
    if (matchups.length > 0 && !window.confirm('Replace the current matchups with new automatic ones?')) {
      return
    }
    const result = autoMatchups(c!.teams)
    setMatchups(
      result.matchups.map((m) => ({
        key: newKey(),
        plaintiff: m.plaintiffTeamId,
        defendant: m.defendantTeamId,
      })),
    )
    setNotice(
      result.unmatched.length
        ? `${result.unmatched.map((id) => teamById.get(id)?.name).join(', ')} couldn't be paired. Choose what to do with ${result.unmatched.length === 1 ? 'it' : 'them'} below.`
        : null,
    )
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over) return
    const team = teamById.get(String(active.id).split('|')[1])
    if (!team) return
    const target = String(over.id)
    if (target === NEW_MATCHUP) {
      if (team.side === 'plaintiff') addMatchup(team.id, null)
      else addMatchup(null, team.id)
      return
    }
    const [, key, side] = target.split('|')
    if (side !== team.side) {
      setNotice(`${team.name} is a ${team.side} team, so it can only go in a ${SIDE_LABELS[team.side]} slot.`)
      return
    }
    setNotice(null)
    setSlot(key, side as Side, team.id)
  }

  async function submit() {
    setError(null)
    setSubmitting(true)
    try {
      await api.saveMatchups(
        caseId,
        matchups.map((m) => ({ plaintiffTeamId: m.plaintiff!, defendantTeamId: m.defendant! })),
      )
      navigate(`/cases/${caseId}`)
    } catch (err) {
      setError(errorMessage(err))
      setSubmitting(false)
    }
  }

  const countFor = (teamId: string) =>
    matchups.filter((m) => m.plaintiff === teamId || m.defendant === teamId).length

  const matchedTeams = c.teams.filter((t) => inUse.has(t.id)).length
  const complete = matchups.filter((m) => m.plaintiff && m.defendant).length

  return (
    <PageFrame
      crumbs={[
        { label: 'Cases', to: '/cases' },
        { label: c.name, to: `/cases/${caseId}` },
        { label: 'Match-ups' },
      ]}
    >
      <Stepper current={2} />
      <div className="page-header">
        <div>
          <h1 className="page-title">Give every team a worthy opponent.</h1>
          <p className="page-lede">
            Pair each plaintiff team with a defendant team. Drag teams into a match, or pick them
            from the dropdowns.
          </p>
        </div>
      </div>

      {c.teams.length === 0 ? (
        <p className="hint">Build teams first.</p>
      ) : (
        <>
          <div className="builder-toolbar">
            <span className={unmatched.length === 0 ? 'badge' : 'badge badge-warning'}>
              {matchedTeams} of {c.teams.length} teams matched
            </span>
            <div className="actions">
              <button type="button" className="btn" onClick={runAutoMatch}>
                <Shuffle size={16} aria-hidden /> Auto-match
              </button>
              <button type="button" className="btn" onClick={() => addMatchup()}>
                <Plus size={16} aria-hidden /> Add match-up
              </button>
            </div>
          </div>
          {notice && (
            <p className="form-warning" role="status">
              {notice}
            </p>
          )}

          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <div className="two-col matchup-layout">
              <div className="page-stack">
                {matchups.map((m, i) => {
                  const ready = Boolean(m.plaintiff && m.defendant)
                  return (
                    <section key={m.key} className="panel matchup-card" aria-label={matchLabel(i)}>
                      <div className="panel-head">
                        <h2>{matchLabel(i)}</h2>
                        <div className="actions">
                          <span className={ready ? 'badge' : 'badge badge-warning'}>
                            {ready ? 'Ready' : 'Incomplete'}
                          </span>
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`Remove matchup ${i + 1}`}
                            onClick={() => setMatchups(matchups.filter((x) => x.key !== m.key))}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                      <div className="matchup-slots">
                        {(['plaintiff', 'defendant'] as const).map((side) => {
                          const team = m[side] ? teamById.get(m[side]!) : undefined
                          return (
                            <DropZone key={side} id={slotId(m.key, side)} className={`slot slot-${side}`}>
                              <p className="eyebrow slot-label">{SIDE_LABELS[side]}</p>
                              <select
                                className="input"
                                aria-label={`${SIDE_LABELS[side]} team for matchup ${i + 1}`}
                                value={m[side] ?? ''}
                                onChange={(e) => setSlot(m.key, side, e.target.value || null)}
                              >
                                <option value="">Drop or choose a {side} team</option>
                                {bySide(side).map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.name}
                                  </option>
                                ))}
                              </select>
                              <p className="slot-members">
                                {team ? team.members.map((p) => p.name).join(' · ') : '\u00a0'}
                              </p>
                            </DropZone>
                          )
                        })}
                        <span className="versus" aria-hidden>
                          vs
                        </span>
                      </div>
                    </section>
                  )
                })}
                <DropZone id={NEW_MATCHUP} className="new-matchup-zone">
                  Drop a team here to start a new match-up
                </DropZone>
                <p className="note">
                  <Info size={18} aria-hidden />
                  Each match-up pairs one plaintiff team with one defendant team. A team can be in
                  more than one match-up if you need to double up.
                </p>
              </div>

              <aside className="page-stack">
                <section className="panel" aria-labelledby="teams-pool-heading">
                  <h2 id="teams-pool-heading" className="panel-title">
                    Teams
                  </h2>
                  {(['plaintiff', 'defendant'] as const).map((side) => (
                    <div key={side} className="pool-group">
                      <p className="eyebrow">{SIDE_LABELS[side]}</p>
                      {bySide(side).map((team) => (
                        <Draggable
                          key={team.id}
                          id={teamDragId(team.id)}
                          label={`Drag ${team.name}`}
                          className={`member-row team-chip team-${side}`}
                        >
                          <span className="row-main">
                            <span>{team.name}</span>
                            <span>
                              {countFor(team.id) === 0 ? 'unmatched' : `in ${countFor(team.id)}`}
                            </span>
                          </span>
                        </Draggable>
                      ))}
                    </div>
                  ))}
                </section>

                <section className="panel summary-card" aria-labelledby="summary-heading">
                  <p className="eyebrow" id="summary-heading">
                    Ready for the classroom
                  </p>
                  <p className="serif summary-title">{c.name}</p>
                  <p className="hint">{c.className}</p>
                  <dl className="summary-list">
                    <div>
                      <dt>Students</dt>
                      <dd>{c.students.length}</dd>
                    </div>
                    <div>
                      <dt>Teams</dt>
                      <dd>{c.teams.length}</dd>
                    </div>
                    <div>
                      <dt>Match-ups</dt>
                      <dd>{complete}</dd>
                    </div>
                  </dl>
                  {unmatched.length === 0 && problems.length === 0 && matchups.length > 0 && (
                    <span className="badge">
                      <Check size={14} aria-hidden /> Every team has an opponent
                    </span>
                  )}
                </section>

                {unmatched.length > 0 && (
                  <section className="panel" aria-labelledby="unmatched-heading">
                    <h2 id="unmatched-heading" className="panel-title">
                      Unmatched
                    </h2>
                    <p className="hint">
                      Leave a team unmatched, or double it up with an opposing team that's already
                      in a match-up.
                    </p>
                    <ul className="rows">
                      {unmatched.map((team) => {
                        const opponents = bySide(team.side === 'plaintiff' ? 'defendant' : 'plaintiff')
                        return (
                          <li key={team.id} className="unmatched-row">
                            <span className="row-main">
                              <span>{team.name}</span>
                              <span>{SIDE_LABELS[team.side]}</span>
                            </span>
                            <select
                              className="select-sm"
                              aria-label={`Match ${team.name} with`}
                              value=""
                              onChange={(e) => e.target.value && matchWith(team, e.target.value)}
                            >
                              <option value="">Leave unmatched</option>
                              {opponents.map((o) => (
                                <option key={o.id} value={o.id}>
                                  Match with {o.name}
                                </option>
                              ))}
                            </select>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                )}
              </aside>
            </div>
          </DndContext>

          {problems.length > 0 && (
            <ul className="problems" aria-label="Before you can save">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <div className="footer-bar">
            <Link to={`/cases/${caseId}/teams`} className="btn">
              <ArrowLeft size={16} aria-hidden /> Back to teams
            </Link>
            <button
              type="button"
              className="btn btn-primary"
              onClick={submit}
              disabled={submitting || problems.length > 0}
            >
              <Check size={16} aria-hidden /> {submitting ? 'Saving…' : 'Save match-ups'}
            </button>
          </div>
        </>
      )}
    </PageFrame>
  )
}
