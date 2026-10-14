import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { useCourseService } from '../../courses/CourseServiceContext'
import { readEmailsFromFile } from '../../courses/emails'
import { AdmissionTable } from '../../dashboard/AdmissionTable'
import type { AddStudentsResult, RosterEntry, RosterStatus } from '../../courses/types'

const STATUS_BADGE: Record<RosterStatus, { label: string; className: string }> = {
  joined: { label: 'Joined', className: 'badge badge-joined' },
  invited: { label: 'Invited', className: 'badge badge-pending' },
  requested: { label: 'Asked to join', className: 'badge badge-pending' },
}

/** Splits pasted text on commas, semicolons and whitespace (one per line works too). */
function parseEmails(text: string) {
  return text.split(/[\s,;]+/).filter(Boolean)
}

function summarize({ added, skipped }: AddStudentsResult) {
  const parts = [`Added ${added.length} student${added.length === 1 ? '' : 's'}.`]
  if (skipped.length) parts.push(`Skipped ${skipped.length}:`)
  return parts.join(' ')
}

export function RosterSection({ courseId }: { courseId: string }) {
  const service = useCourseService()
  const [roster, setRoster] = useState<RosterEntry[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [emails, setEmails] = useState('')
  const [adding, setAdding] = useState(false)
  const [result, setResult] = useState<AddStudentsResult | null>(null)
  const [fileNote, setFileNote] = useState<string | null>(null)

  /** Reads the emails out of a spreadsheet into the box, to review before adding. */
  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // so choosing the same file again still triggers onChange
    if (!file) return
    setActionError(null)
    setFileNote(null)
    try {
      const found = await readEmailsFromFile(file)
      if (found.length === 0) {
        setActionError(`No email addresses found in ${file.name}.`)
        return
      }
      setEmails((current) => [current.trim(), ...found].filter(Boolean).join('\n'))
      setFileNote(`Found ${found.length} email${found.length === 1 ? '' : 's'} in ${file.name}. Check them, then Add.`)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  useEffect(() => {
    let cancelled = false
    service
      .listRoster(courseId)
      .then((r) => !cancelled && setRoster(r))
      .catch((err: Error) => !cancelled && setLoadError(err.message))
    return () => {
      cancelled = true
    }
  }, [service, courseId])

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    setActionError(null)
    setResult(null)
    setAdding(true)
    try {
      const res = await service.addStudents(courseId, parseEmails(emails))
      setRoster(res.roster)
      setResult(res)
      setEmails('')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove(entry: RosterEntry) {
    const who = entry.name ? `${entry.name} (${entry.email})` : entry.email
    if (!window.confirm(`Remove ${who} from this course?`)) return
    setActionError(null)
    try {
      await service.removeStudent(courseId, entry.email)
      setRoster((prev) => prev?.filter((r) => r.email !== entry.email) ?? null)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  // People asking to join get their own table; everyone else is listed below.
  const requests = roster?.filter((r) => r.status === 'requested') ?? []
  const members = roster?.filter((r) => r.status !== 'requested') ?? null

  return (
    <section className="course-section" aria-labelledby="roster-heading">
      <h2 id="roster-heading">Students{members ? ` (${members.length})` : ''}</h2>

      {requests.length > 0 && (
        <AdmissionTable
          courseId={courseId}
          requests={requests}
          onDecided={() => service.listRoster(courseId).then(setRoster).catch(() => {})}
        />
      )}

      <form className="panel-form roster-form" onSubmit={handleAdd}>
        <label>
          Add students by email
          <textarea
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
            placeholder={'ada@u.northwestern.edu\nbo@u.northwestern.edu'}
            rows={3}
            required
          />
        </label>
        <button type="submit" className="btn-primary" disabled={adding || !emails.trim()}>
          {adding ? 'Adding…' : 'Add'}
        </button>
        <label className="roster-file">
          Or upload a spreadsheet of emails (.xlsx or .csv)
          <input type="file" accept=".xlsx,.csv" onChange={handleFile} />
        </label>
        {fileNote && <p className="muted roster-hint">{fileNote}</p>}
        <p className="muted roster-hint">
          One per line, or separated by commas. Each student gets an invitation to accept when they
          log in (or after they sign up with that email). Students can also ask to join with the
          entry code, and you admit or deny them above.
        </p>
      </form>

      {result && (
        <div className="roster-result" role="status">
          <p>{summarize(result)}</p>
          {result.skipped.length > 0 && (
            <ul>
              {result.skipped.map((s) => (
                <li key={s.email}>
                  {s.email}: {s.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {actionError && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      )}

      {loadError ? (
        <p className="form-error" role="alert">
          Could not load the roster. {loadError}
        </p>
      ) : roster === null ? (
        <p className="muted">Loading roster…</p>
      ) : members!.length === 0 ? (
        <p className="muted">No students yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members!.map((entry) => (
                <tr key={entry.email}>
                  <td>{entry.name ?? <span className="muted">—</span>}</td>
                  <td>{entry.email}</td>
                  <td>
                    <span className={STATUS_BADGE[entry.status].className}>
                      {entry.status === 'invited' && !entry.userId
                        ? 'Invited · no account yet'
                        : STATUS_BADGE[entry.status].label}
                    </span>
                  </td>
                  <td className="cell-actions">
                    <button
                      type="button"
                      className="btn-danger"
                      onClick={() => handleRemove(entry)}
                      aria-label={`Remove ${entry.email}`}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
