import { ArrowRight, Check, Copy, FileSpreadsheet, Mail, Plus, X } from 'lucide-react'
import { useState, type ChangeEvent, type FormEvent } from 'react'
import { errorMessage } from '../api/useLoad'
import { celebrate } from '../courses/celebrate'
import { useCourseService } from '../courses/CourseServiceContext'
import { EMAIL_PATTERN, readEmailsFromFile } from '../courses/emails'
import { SEASONS, type Season, type TaughtCourse } from '../courses/types'

/** "a@x.com, b@y.com" -> valid and invalid addresses, lowercased. */
function splitEmails(text: string) {
  const all = text
    .split(/[\s,;]+/)
    .map((e) => e.toLowerCase())
    .filter(Boolean)
  return {
    valid: all.filter((e) => EMAIL_PATTERN.test(e)),
    invalid: all.filter((e) => !EMAIL_PATTERN.test(e)),
  }
}

function currentTerm(now = new Date()): { season: Season; year: number } {
  const month = now.getMonth()
  const season = month >= 8 ? 'Fall' : month >= 5 ? 'Summer' : month >= 2 ? 'Spring' : 'Winter'
  return { season, year: now.getFullYear() }
}

interface Props {
  onCreated(): void
  onClose(): void
}

interface Created {
  course: TaughtCourse
  invited: number
  skipped: number
}

/** New course plus its first invitations; ends on the entry code, with confetti. */
export function CreateCourseForm({ onCreated, onClose }: Props) {
  const service = useCourseService()
  const [code, setCode] = useState('')
  const [title, setTitle] = useState('')
  const [season, setSeason] = useState<Season>(() => currentTerm().season)
  const [year, setYear] = useState(() => String(currentTerm().year))
  const [emailDraft, setEmailDraft] = useState('')
  const [emails, setEmails] = useState<string[]>([])
  const [fileNote, setFileNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState<Created | null>(null)
  const [copied, setCopied] = useState(false)

  function addEmails(more: string[]) {
    setEmails((current) => [...new Set([...current, ...more])])
  }

  /** Adds what's typed in the email box. Returns false if any of it is invalid. */
  function addDraft() {
    const { valid, invalid } = splitEmails(emailDraft)
    if (invalid.length) {
      setError(`Not a valid email address: ${invalid.join(', ')}`)
      return false
    }
    addEmails(valid)
    setEmailDraft('')
    setError(null)
    return true
  }

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // so choosing the same file again still triggers onChange
    if (!file) return
    setError(null)
    setFileNote(null)
    try {
      const found = await readEmailsFromFile(file)
      if (found.length === 0) {
        setError(`No email addresses found in ${file.name}.`)
        return
      }
      addEmails(found)
      setFileNote(`Added ${found.length} email${found.length === 1 ? '' : 's'} from ${file.name}.`)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    // Include anything typed in the email box but never added with the Add button.
    const typed = splitEmails(emailDraft)
    if (typed.invalid.length) {
      setError(`Not a valid email address: ${typed.invalid.join(', ')}`)
      return
    }

    setError(null)
    setSubmitting(true)
    try {
      const course = await service.createCourse({
        code: code.trim(),
        title: title.trim(),
        season,
        year: Number(year),
      })
      const toInvite = [...new Set([...emails, ...typed.valid])]
      const result = toInvite.length ? await service.addStudents(course.id, toInvite) : null
      setCreated({ course, invited: result?.added.length ?? 0, skipped: result?.skipped.length ?? 0 })
      celebrate()
      onCreated()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function copyCode(entryCode: string) {
    try {
      await navigator.clipboard.writeText(entryCode)
      setCopied(true)
    } catch {
      // Clipboard can be blocked; the code is on screen to copy by hand.
    }
  }

  if (created) {
    const { course, invited, skipped } = created
    return (
      <section className="ws-panel create-success" role="status">
        <span className="success-icon" aria-hidden>
          <Check size={22} />
        </span>
        <p className="create-success-text">
          <strong>
            {course.code}: {course.title}
          </strong>{' '}
          has been created. Here's the code for students to join:
        </p>
        <p className="entry-code-large">{course.entryCode}</p>
        {invited > 0 && (
          <p className="case-hint">
            Invited {invited} student{invited === 1 ? '' : 's'}. They'll see the invitation when they log
            in, or after they sign up with that email.
            {skipped > 0 && ` ${skipped} email${skipped === 1 ? ' was' : 's were'} skipped.`}
          </p>
        )}
        <div className="case-actions">
          <button type="button" className="ws-btn ws-btn-secondary" onClick={() => copyCode(course.entryCode)}>
            <Copy size={16} aria-hidden /> {copied ? 'Copied' : 'Copy code'}
          </button>
          <button type="button" className="ws-btn ws-btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </section>
    )
  }

  return (
    <form className="ws-panel case-form create-course" onSubmit={handleSubmit} aria-label="New course">
      <h2 className="case-panel-title">New course</h2>

      <div className="create-course-row">
        <label>
          Course number
          <input
            type="text"
            placeholder="LAW 540"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={20}
            required
          />
        </label>
        <label className="create-course-title">
          Course title
          <input
            type="text"
            placeholder="Trial Advocacy"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            required
          />
        </label>
      </div>

      <div className="create-course-row">
        <label>
          Term
          <select value={season} onChange={(e) => setSeason(e.target.value as Season)}>
            {SEASONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Year
          <input
            type="number"
            min={2000}
            max={2100}
            value={year}
            onChange={(e) => setYear(e.target.value)}
            required
          />
        </label>
      </div>

      <div className="case-field">
        <label htmlFor="student-email">Invite students by email</label>
        <div className="case-inline">
          <input
            id="student-email"
            type="text"
            className="case-input"
            inputMode="email"
            placeholder="student@school.edu"
            value={emailDraft}
            onChange={(e) => setEmailDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addDraft()
              }
            }}
          />
          <button
            type="button"
            className="ws-btn ws-btn-secondary"
            onClick={addDraft}
            disabled={!emailDraft.trim()}
          >
            <Plus size={16} aria-hidden /> Add
          </button>
        </div>
      </div>

      <label className="case-drop-zone">
        <FileSpreadsheet size={22} aria-hidden />
        <span className="case-drop-zone-text">
          <strong>Or upload a spreadsheet of emails (.xlsx or .csv)</strong>
          <span className="case-hint">Any column works. We pick out every email address.</span>
        </span>
        <input type="file" accept=".xlsx,.csv" onChange={handleFile} />
      </label>
      {fileNote && <p className="case-hint">{fileNote}</p>}

      {emails.length > 0 && (
        <div>
          <p className="ws-eyebrow invite-count">
            {emails.length} student{emails.length === 1 ? '' : 's'} to invite
          </p>
          <ul className="case-rows invite-rows" aria-label="Students to invite">
            {emails.map((email) => (
              <li key={email}>
                <span className="case-row-main">
                  <span>{email}</span>
                </span>
                <button
                  type="button"
                  className="case-icon-btn"
                  aria-label={`Remove ${email}`}
                  onClick={() => setEmails((current) => current.filter((e) => e !== email))}
                >
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="case-note">
        <Mail size={18} aria-hidden />
        Invited students accept or reject the invitation when they log in. Students can also ask to
        join with the entry code, and you admit or deny them.
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="case-actions form-actions">
        <button type="button" className="ws-btn ws-btn-secondary" onClick={onClose} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className="ws-btn ws-btn-primary" disabled={submitting}>
          <ArrowRight size={16} aria-hidden /> {submitting ? 'Creating…' : 'Create course'}
        </button>
      </div>
    </form>
  )
}
