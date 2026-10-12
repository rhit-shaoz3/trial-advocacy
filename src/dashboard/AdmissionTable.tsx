import { Check, X } from 'lucide-react'
import { useState } from 'react'
import { useClassesApi } from '../classes/ClassesApiContext'
import type { Decision, Person } from '../classes/types'
import { initials } from '../layout/initials'
import { errorMessage } from './errorMessage'

interface Props {
  classId: string
  requests: Person[]
  onDecided(): void
}

/** Students who entered the class code, with checkboxes for bulk admit/deny. */
export function AdmissionTable({ classId, requests, onDecided }: Props) {
  const api = useClassesApi()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Ignore selections for students who have since dropped off the list.
  const selectedIds = requests.filter((r) => selected.has(r.id)).map((r) => r.id)
  const allSelected = selectedIds.length === requests.length

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(requests.map((r) => r.id)))
  }

  async function decide(decision: Decision) {
    setBusy(true)
    setError(null)
    try {
      await api.decideRequests(classId, selectedIds, decision)
      setSelected(new Set())
      onDecided()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const headingId = `admission-${classId}`
  return (
    <section className="admission" aria-labelledby={headingId}>
      <div className="admission-head">
        <h3 id={headingId}>Seeking admission ({requests.length})</h3>
        <div className="actions">
          <button
            type="button"
            className="btn btn-small btn-primary"
            disabled={busy || selectedIds.length === 0}
            onClick={() => decide('admit')}
          >
            <Check size={16} aria-hidden /> Admit selected
          </button>
          <button
            type="button"
            className="btn btn-small btn-danger"
            disabled={busy || selectedIds.length === 0}
            onClick={() => decide('deny')}
          >
            <X size={16} aria-hidden /> Deny selected
          </button>
        </div>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col" className="check-col">
              <input
                type="checkbox"
                aria-label="Select all"
                checked={allSelected}
                onChange={toggleAll}
              />
            </th>
            <th scope="col">Student</th>
            <th scope="col">Email</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id}>
              <td className="check-col">
                <input
                  type="checkbox"
                  aria-label={`Select ${r.name}`}
                  checked={selected.has(r.id)}
                  onChange={() => toggle(r.id)}
                />
              </td>
              <td>
                <span className="person">
                  <span className="avatar" aria-hidden>
                    {initials(r.name)}
                  </span>
                  {r.name}
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
