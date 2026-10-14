import { Check, X } from 'lucide-react'
import { useState } from 'react'
import { errorMessage } from '../api/useLoad'
import { Avatar } from '../components/Avatar'
import { useCourseService } from '../courses/CourseServiceContext'
import type { Decision, RosterEntry } from '../courses/types'

interface Props {
  courseId: string
  /** Roster entries with status 'requested'. */
  requests: RosterEntry[]
  onDecided(): void
}

/** Students who entered the entry code, with checkboxes for bulk admit/deny. */
export function AdmissionTable({ courseId, requests, onDecided }: Props) {
  const service = useCourseService()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const people = requests.filter((r): r is RosterEntry & { userId: string } => r.userId !== null)
  // Ignore selections for students who have since dropped off the list.
  const selectedIds = people.filter((r) => selected.has(r.userId)).map((r) => r.userId)
  const allSelected = selectedIds.length === people.length

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function decide(decision: Decision) {
    setBusy(true)
    setError(null)
    try {
      await service.decideRequests(courseId, selectedIds, decision)
      setSelected(new Set())
      onDecided()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const headingId = `admission-${courseId}`
  return (
    <section className="admission" aria-labelledby={headingId}>
      <div className="admission-head">
        <h3 id={headingId}>Seeking admission ({people.length})</h3>
        <div className="case-actions">
          <button
            type="button"
            className="ws-btn ws-btn-primary case-btn-sm"
            disabled={busy || selectedIds.length === 0}
            onClick={() => decide('admit')}
          >
            <Check size={16} aria-hidden /> Admit selected
          </button>
          <button
            type="button"
            className="ws-btn ws-btn-secondary case-btn-sm case-danger"
            disabled={busy || selectedIds.length === 0}
            onClick={() => decide('deny')}
          >
            <X size={16} aria-hidden /> Deny selected
          </button>
        </div>
      </div>
      <table className="case-table">
        <thead>
          <tr>
            <th scope="col" className="check-col">
              <input
                type="checkbox"
                aria-label="Select all"
                checked={allSelected}
                onChange={() => setSelected(allSelected ? new Set() : new Set(people.map((r) => r.userId)))}
              />
            </th>
            <th scope="col">Student</th>
            <th scope="col">Email</th>
          </tr>
        </thead>
        <tbody>
          {people.map((r) => (
            <tr key={r.userId}>
              <td className="check-col">
                <input
                  type="checkbox"
                  aria-label={`Select ${r.name ?? r.email}`}
                  checked={selected.has(r.userId)}
                  onChange={() => toggle(r.userId)}
                />
              </td>
              <td>
                <span className="case-person">
                  <Avatar name={r.name ?? r.email} size="sm" />
                  {r.name ?? r.email}
                </span>
              </td>
              <td className="muted">{r.email}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
