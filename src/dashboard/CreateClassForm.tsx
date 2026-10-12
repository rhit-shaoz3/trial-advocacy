import { ArrowRight, Check, Copy, FileSpreadsheet, Mail, Plus, X } from 'lucide-react'
import { useState, type ChangeEvent, type FormEvent } from 'react'
import { celebrate } from '../classes/celebrate'
import { useClassesApi } from '../classes/ClassesApiContext'
import { EMAIL_PATTERN, readEmailsFromFile } from '../classes/emails'
import type { CreatedClass } from '../classes/types'
import { errorMessage } from './errorMessage'

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

interface Props {
  onCreated(): void
  onClose(): void
}

export function CreateClassForm({ onCreated, onClose }: Props) {
  const api = useClassesApi()
  const [name, setName] = useState('')
  const [emailDraft, setEmailDraft] = useState('')
  const [emails, setEmails] = useState<string[]>([])
  const [fileNote, setFileNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState<CreatedClass | null>(null)
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
      const result = await api.createClass({
        name: name.trim(),
        studentEmails: [...new Set([...emails, ...typed.valid])],
      })
      setCreated(result)
      celebrate()
      onCreated()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
    } catch {
      // Clipboard can be blocked; the code is on screen to copy by hand.
    }
  }

  if (created) {
    const { class: cls, invited, withAccounts } = created
    return (
      <section className="panel create-success" role="status">
        <span className="success-icon" aria-hidden>
          <Check size={22} />
        </span>
        <p className="create-success-text">
          <strong>{cls.name}</strong> has been created. Here's the code for students to join:
        </p>
        <p className="join-code-large">{cls.joinCode}</p>
        {invited > 0 && (
          <p className="hint">
            Invited {invited} student{invited === 1 ? '' : 's'}. {withAccounts} already{' '}
            {withAccounts === 1 ? 'has an account' : 'have accounts'} and will see the invitation
            when they log in.
          </p>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={() => copyCode(cls.joinCode)}>
            <Copy size={16} aria-hidden /> {copied ? 'Copied' : 'Copy code'}
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </section>
    )
  }

  return (
    <form className="panel form create-class" onSubmit={handleSubmit} aria-label="New class">
      <h2 className="panel-title">New class</h2>

      <label>
        Class name
        <input
          type="text"
          placeholder="e.g. Trial Advocacy I · Fall 2026"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          required
        />
      </label>

      <div className="field">
        <label htmlFor="student-email">Add students by email</label>
        <div className="inline-input">
          <input
            id="student-email"
            type="text"
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
          <button type="button" className="btn" onClick={addDraft} disabled={!emailDraft.trim()}>
            <Plus size={16} aria-hidden /> Add
          </button>
        </div>
      </div>

      <label className="drop-zone">
        <FileSpreadsheet size={22} aria-hidden />
        <span className="drop-zone-text">
          <strong>Or upload a spreadsheet of emails (.xlsx or .csv)</strong>
          <span className="hint">Any column works. We pick out every email address.</span>
        </span>
        <input type="file" accept=".xlsx,.csv" onChange={handleFile} />
      </label>
      {fileNote && <p className="hint">{fileNote}</p>}

      {emails.length > 0 && (
        <div>
          <p className="eyebrow invite-count">
            {emails.length} student{emails.length === 1 ? '' : 's'} to invite
          </p>
          <ul className="rows invite-rows" aria-label="Students to invite">
            {emails.map((email) => (
              <li key={email}>
                <span className="row-main">
                  <span>{email}</span>
                </span>
                <button
                  type="button"
                  className="icon-btn"
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

      <p className="note">
        <Mail size={18} aria-hidden />
        Students who already have an account see the invitation when they log in. Anyone else sees
        it after they sign up with that email.
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="actions form-actions">
        <button type="button" className="btn" onClick={onClose} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          <ArrowRight size={16} aria-hidden /> {submitting ? 'Creating…' : 'Create class'}
        </button>
      </div>
    </form>
  )
}
