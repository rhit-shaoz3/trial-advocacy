import { Copy } from 'lucide-react'
import { useState } from 'react'
import type { InstructorClass } from '../classes/types'
import { initials } from '../layout/initials'
import { AdmissionTable } from './AdmissionTable'

interface Props {
  cls: InstructorClass
  onChanged(): void
}

export function ClassCard({ cls, onChanged }: Props) {
  const headingId = `class-heading-${cls.id}`
  const [copied, setCopied] = useState(false)

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(cls.joinCode)
      setCopied(true)
    } catch {
      // Clipboard can be blocked; the code is on screen to copy by hand.
    }
  }

  return (
    <article id={`class-${cls.id}`} className="panel class-card" aria-labelledby={headingId}>
      <header className="class-card-head">
        <div>
          <h2 id={headingId} className="serif class-card-name">
            {cls.name}
          </h2>
          <p className="hint">
            {cls.students.length} students · {cls.invitations.length} invited
          </p>
        </div>
        <div className="join-code">
          <span className="eyebrow">Join code</span>
          <strong>{cls.joinCode}</strong>
          <button type="button" className="icon-btn" aria-label="Copy join code" onClick={copyCode}>
            <Copy size={16} />
          </button>
          {copied && <span className="hint">Copied</span>}
        </div>
      </header>

      {cls.pendingRequests.length > 0 && (
        <AdmissionTable classId={cls.id} requests={cls.pendingRequests} onDecided={onChanged} />
      )}

      <h3 className="class-card-sub">Students ({cls.students.length})</h3>
      {cls.students.length === 0 ? (
        <p className="hint">No students yet. Share the join code or invite students by email.</p>
      ) : (
        <ul className="rows people-rows">
          {cls.students.map((s) => (
            <li key={s.id}>
              <span className="avatar" aria-hidden>
                {initials(s.name)}
              </span>
              <span className="row-main">
                <span>{s.name}</span>
                <span>{s.email}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {cls.invitations.length > 0 && (
        <>
          <h3 className="class-card-sub">Invited ({cls.invitations.length})</h3>
          <ul className="rows people-rows">
            {cls.invitations.map((inv) => (
              <li key={inv.id}>
                <span className="avatar avatar-muted" aria-hidden>
                  {initials(inv.name ?? inv.email)}
                </span>
                <span className="row-main">
                  <span>{inv.name ?? inv.email}</span>
                  {inv.name && <span>{inv.email}</span>}
                </span>
                <span className={inv.hasAccount ? 'badge' : 'badge badge-muted'}>
                  {inv.hasAccount ? 'Invited' : 'No account'}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </article>
  )
}
