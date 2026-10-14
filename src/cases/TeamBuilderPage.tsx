import { DndContext, type DragEndEvent } from '@dnd-kit/core'
import { ArrowLeft, ArrowLeftRight, ArrowRight, Plus, Search, Shuffle, Trash2, Users, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { errorMessage } from '../api/useLoad'
import { Avatar } from '../components/Avatar'
import { autoTeams } from './autoMatch'
import { useCasesApi } from './CasesApiContext'
import { Draggable, DropZone } from './dnd'
import { SIDE_LABELS } from './format'
import { Stepper } from './Stepper'
import type { InstructorCase, Person, Side, TeamInput } from './types'
import { useDragSensors } from './useDragSensors'
import './Cases.css'

const UNASSIGNED = 'unassigned'

/** A team being edited. `key` identifies it on screen; `id` is set once it's saved. */
interface DraftTeam extends TeamInput {
  key: string
}

/** Everything that would stop the teams from being saved. */
function findProblems(teams: DraftTeam[], unassigned: Person[]) {
  const problems: string[] = []
  if (teams.length === 0) problems.push('Add at least one team.')
  const seen = new Set<string>()
  for (const [i, team] of teams.entries()) {
    const name = team.name.trim()
    if (!name) problems.push(`Team ${i + 1} needs a name.`)
    else if (seen.has(name.toLowerCase())) problems.push(`There are two teams named "${name}".`)
    seen.add(name.toLowerCase())
    if (team.studentIds.length === 0) problems.push(`${name || `Team ${i + 1}`} has no students.`)
  }
  if (unassigned.length > 0) {
    problems.push(`Not on a team yet: ${unassigned.map((s) => s.name).join(', ')}.`)
  }
  return problems
}

interface ChipProps {
  student: Person
  currentKey: string
  targets: { key: string; name: string }[]
  onMove(studentId: string, target: string): void
  /** Shown on team members: puts the student back in Unassigned. */
  onRemove?(): void
  teamName?: string
}

/** A student that can be dragged to a team, or moved with the dropdown. */
function StudentChip({ student, currentKey, targets, onMove, onRemove, teamName }: ChipProps) {
  return (
    <Draggable id={student.id} label={`Drag ${student.name}`} className="member-row">
      <Avatar name={student.name} />
      <span className="case-row-main">
        <span>{student.name}</span>
        <span>{student.email}</span>
      </span>
      {/* A compact button that opens a normal dropdown, for moving without dragging. */}
      <span className="move-select" title="Move to another team">
        <ArrowLeftRight size={16} aria-hidden />
        <select
          aria-label={`Move ${student.name} to`}
          value={currentKey}
          onChange={(e) => onMove(student.id, e.target.value)}
        >
          {targets.map((t) => (
            <option key={t.key} value={t.key}>
              {t.name}
            </option>
          ))}
        </select>
      </span>
      {onRemove && (
        <button
          type="button"
          className="case-icon-btn"
          aria-label={`Remove ${student.name} from ${teamName}`}
          onClick={onRemove}
        >
          <X size={16} />
        </button>
      )}
    </Draggable>
  )
}

export function TeamBuilderPage() {
  const { courseId = '', caseId = '' } = useParams()
  const caseUrl = `/courses/${courseId}/cases/${caseId}`
  const api = useCasesApi()
  const navigate = useNavigate()
  const sensors = useDragSensors()
  const [c, setCase] = useState<InstructorCase | null>(null)
  const [teams, setTeams] = useState<DraftTeam[]>([])
  const [teamSize, setTeamSize] = useState('2')
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const keyCounter = useRef(0)
  const newKey = () => `new-${++keyCounter.current}`

  useEffect(() => {
    api
      .getInstructorCase(caseId)
      .then((loaded) => {
        setCase(loaded)
        setTeams(
          loaded.teams.map((t) => ({
            key: t.id,
            id: t.id,
            name: t.name,
            side: t.side,
            studentIds: t.members.map((m) => m.id),
          })),
        )
      })
      .catch((err) => setError(errorMessage(err)))
  }, [api, caseId])

  if (!c) {
    return (
      <main className="ws-page case-page">
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </main>
    )
  }

  const studentById = new Map(c.students.map((s) => [s.id, s]))
  const assigned = new Set(teams.flatMap((t) => t.studentIds))
  const unassigned = c.students.filter((s) => !assigned.has(s.id))
  const problems = findProblems(teams, unassigned)
  const plaintiffCount = teams.filter((t) => t.side === 'plaintiff').length

  function moveStudent(studentId: string, target: string) {
    setTeams((current) =>
      current.map((t) => {
        const without = t.studentIds.filter((id) => id !== studentId)
        return { ...t, studentIds: t.key === target ? [...without, studentId] : without }
      }),
    )
  }

  function updateTeam(key: string, changes: Partial<DraftTeam>) {
    setTeams((current) => current.map((t) => (t.key === key ? { ...t, ...changes } : t)))
  }

  function addTeam() {
    const used = new Set(teams.map((t) => t.name))
    let n = teams.length + 1
    while (used.has(`${c!.name} ${n}`)) n++
    const side: Side = plaintiffCount <= teams.length - plaintiffCount ? 'plaintiff' : 'defendant'
    setTeams([...teams, { key: newKey(), name: `${c!.name} ${n}`, side, studentIds: [] }])
  }

  function runAutoMatch() {
    const size = Number(teamSize)
    if (!Number.isInteger(size) || size < 1) {
      setError('Students per team must be a whole number of at least 1.')
      return
    }
    if (c!.students.length === 0) {
      setError('There are no students in this class yet.')
      return
    }
    if (teams.length > 0 && !window.confirm('Replace the current teams with new automatic teams?')) {
      return
    }
    setError(null)
    const generated = autoTeams(
      c!.students.map((s) => s.id),
      size,
      c!.name,
    )
    setTeams(generated.map((t) => ({ ...t, key: newKey() })))
  }

  async function submit() {
    setError(null)
    setSubmitting(true)
    try {
      await api.saveTeams(
        caseId,
        teams.map(({ id, name, side, studentIds }) => ({
          ...(id && { id }),
          name: name.trim(),
          side,
          studentIds,
        })),
      )
      navigate(`${caseUrl}/matchups`)
    } catch (err) {
      setError(errorMessage(err))
      setSubmitting(false)
    }
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (over) moveStudent(String(active.id), String(over.id))
  }

  const moveTargets = [
    { key: UNASSIGNED, name: 'Unassigned' },
    ...teams.map((t, i) => ({ key: t.key, name: t.name.trim() || `Team ${i + 1}` })),
  ]

  const shownUnassigned = unassigned.filter((s) =>
    s.name.toLowerCase().includes(filter.trim().toLowerCase()),
  )
  const placedCount = c.students.length - unassigned.length

  return (
    <main className="ws-page case-page">
      <Link to={caseUrl} className="ws-link case-back">
        <ArrowLeft aria-hidden="true" /> Back to {c.name}
      </Link>
      <Stepper current={1} />
      <div className="ws-welcome">
        <div>
          <h1 className="ws-title">Good advocacy starts with a team.</h1>
          <p className="ws-subtle">
            Put every student in {c.courseName} on a team for {c.name}. Sides alternate when you
            auto-pair; you can change anything before continuing.
          </p>
        </div>
      </div>

      <div className="builder-toolbar">
        <div className="case-actions">
          <span className={unassigned.length === 0 ? 'case-badge' : 'case-badge case-badge-warning'}>
            {placedCount} of {c.students.length} students assigned
          </span>
          <span className="case-hint">
            {teams.length} teams · {plaintiffCount} plaintiff · {teams.length - plaintiffCount}{' '}
            defendant
          </span>
        </div>
        <div className="case-actions">
          <label className="team-size">
            Students per team
            <input
              type="number"
              className="case-input"
              min={1}
              value={teamSize}
              onChange={(e) => setTeamSize(e.target.value)}
            />
          </label>
          <button type="button" className="ws-btn ws-btn-secondary" onClick={runAutoMatch}>
            <Shuffle size={16} aria-hidden /> Auto-pair students
          </button>
          <button type="button" className="ws-btn ws-btn-secondary" onClick={addTeam}>
            <Plus size={16} aria-hidden /> New team
          </button>
        </div>
      </div>

      {c.matchups.length > 0 && (
        <p className="case-hint builder-hint">
          Removing a team or changing its side also removes the match-ups it's in.
        </p>
      )}

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="builder">
          <DropZone id={UNASSIGNED} className="ws-panel case-panel builder-pool">
            <div className="case-panel-head">
              <h2>Unassigned ({unassigned.length})</h2>
            </div>
            {unassigned.length > 0 && (
              <label className="search">
                <Search size={16} aria-hidden />
                <input
                  type="search"
                  placeholder="Search students"
                  aria-label="Search unassigned students"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </label>
            )}
            {unassigned.length === 0 ? (
              <p className="case-hint">Everyone is on a team.</p>
            ) : (
              shownUnassigned.map((s) => (
                <StudentChip
                  key={s.id}
                  student={s}
                  currentKey={UNASSIGNED}
                  targets={moveTargets}
                  onMove={moveStudent}
                />
              ))
            )}
            <p className="case-hint pool-hint">
              Drag a student by the grip onto a team, or use the ⇄ button to pick one.
            </p>
          </DropZone>

          <div className="team-grid">
            {teams.length === 0 && (
              <div className="ws-panel case-panel ws-empty">
                <p className="case-serif case-empty-title">No teams yet.</p>
                <p className="case-hint">Auto-pair students, or add a team and drag students into it.</p>
              </div>
            )}
            {teams.map((team, i) => {
              const label = team.name.trim() || `Team ${i + 1}`
              const count = team.studentIds.length
              return (
                <DropZone key={team.key} id={team.key} className={`ws-panel case-panel team-card team-${team.side}`}>
                  <div className="team-card-head">
                    <Users size={18} aria-hidden className="muted" />
                    <input
                      type="text"
                      className="team-name-input"
                      aria-label={`Name of team ${i + 1}`}
                      value={team.name}
                      onChange={(e) => updateTeam(team.key, { name: e.target.value })}
                      maxLength={100}
                    />
                    <button
                      type="button"
                      className="case-icon-btn"
                      aria-label={`Remove ${label}`}
                      onClick={() => setTeams(teams.filter((t) => t.key !== team.key))}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="case-actions">
                    <span className={count ? 'case-badge' : 'case-badge case-badge-warning'}>
                      {count} member{count === 1 ? '' : 's'}
                      {count ? ' · Ready' : ''}
                    </span>
                    <select
                      className="case-select-sm"
                      aria-label={`Side of ${label}`}
                      value={team.side}
                      onChange={(e) => updateTeam(team.key, { side: e.target.value as Side })}
                    >
                      <option value="plaintiff">{SIDE_LABELS.plaintiff}</option>
                      <option value="defendant">{SIDE_LABELS.defendant}</option>
                    </select>
                  </div>
                  <div className="team-members">
                    {count === 0 ? (
                      <p className="case-hint drop-hint">Drag students here.</p>
                    ) : (
                      team.studentIds.map((id) => {
                        const student = studentById.get(id)
                        return student ? (
                          <StudentChip
                            key={id}
                            student={student}
                            currentKey={team.key}
                            targets={moveTargets}
                            onMove={moveStudent}
                            teamName={label}
                            onRemove={() => moveStudent(id, UNASSIGNED)}
                          />
                        ) : null
                      })
                    )}
                  </div>
                </DropZone>
              )
            })}
          </div>
        </div>
      </DndContext>

      {problems.length > 0 && (
        <ul className="case-problems" aria-label="Before you can continue">
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

      <div className="case-footer">
        <Link to={caseUrl} className="ws-btn ws-btn-secondary">
          <ArrowLeft size={16} aria-hidden /> Back to case
        </Link>
        <button
          type="button"
          className="ws-btn ws-btn-primary"
          onClick={submit}
          disabled={submitting || problems.length > 0}
        >
          {submitting ? 'Saving…' : 'Continue to match-ups'} <ArrowRight size={16} aria-hidden />
        </button>
      </div>
    </main>
  )
}
