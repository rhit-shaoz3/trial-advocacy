import { FileText, Mail, User } from 'lucide-react'
import type { Firm, Side } from '../../courses/types'
import './WelcomeEmail.css'

const COUNSEL: Record<Side, string> = { plaintiff: 'Counsel for the plaintiff', defense: 'Counsel for the defense' }

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')

/**
 * The email a senior partner at the team's firm sends when the introduction
 * phase starts: what the team has to work from, its side's witnesses, and
 * (with initial disclosures on) what to do first. Signed as Senior Partner.
 */
export function WelcomeEmail({
  caseTitle,
  firm,
  side,
  recipients,
  startingFile,
  documents,
  onOpenDocument,
  witnesses,
  disclosures,
  highlightDisclosures = false,
}: {
  caseTitle: string
  firm: Firm
  side: Side
  /** The team's members, by name. */
  recipients: string[]
  /** The file every team starts from, e.g. the amended complaint. */
  startingFile: string | null
  /** The other documents the team's side has; with an id, they open in the viewer. */
  documents: { title: string; id?: string }[]
  /** Opens a document in the viewer; leave out (the setup preview) for plain names. */
  onOpenDocument?(id: string): void
  /** The team's side's witnesses. */
  witnesses: string[]
  /** Whether the case includes initial disclosures (adds a line about them). */
  disclosures: boolean
  /** Marks the initial disclosures line, as the setup's preview does. */
  highlightDisclosures?: boolean
}) {
  const partner = firm.partner || 'Your senior partner'
  const firmName = firm.firm || 'the firm'
  const firstNames = recipients.map((n) => n.split(/\s+/)[0]).filter(Boolean)
  return (
    <article className="welcome-email" aria-label={`Email from ${partner}`}>
      <div className="welcome-email-bar">
        <Mail aria-hidden="true" />
        Inbox
      </div>
      <header className="welcome-email-head">
        <h3>Welcome to {caseTitle}</h3>
        <div className="welcome-email-from">
          <span className="welcome-email-avatar" aria-hidden="true">
            {initials(partner) || 'SP'}
          </span>
          <span>
            <strong>{partner}</strong>
            <small>To: {recipients.length > 0 ? recipients.join(', ') : 'Your team'}</small>
          </span>
        </div>
      </header>
      <div className="welcome-email-body">
        <p>{firstNames.length > 0 ? `${firstNames.join(', ')},` : 'Team,'}</p>
        <p>
          Thanks for taking over this case. You have access to {startingFile ?? 'the case file'}
          {documents.length > 0 ? ' as well as a few other documents to help you along:' : '.'}
        </p>
        {documents.length > 0 && (
          <ul aria-label="Documents">
            {documents.map((d) => (
              <li key={d.id ?? d.title}>
                <FileText aria-hidden="true" />
                {d.id && onOpenDocument ? (
                  <>
                    <button
                      type="button"
                      className="welcome-email-file"
                      title={`Open ${d.title} in the viewer`}
                      onClick={() => onOpenDocument(d.id!)}
                    >
                      {d.title}
                    </button>
                    <button
                      type="button"
                      className="welcome-email-open"
                      aria-label={`Open ${d.title}`}
                      onClick={() => onOpenDocument(d.id!)}
                    >
                      Open
                    </button>
                  </>
                ) : (
                  d.title
                )}
              </li>
            ))}
          </ul>
        )}
        {witnesses.length > 0 && (
          <>
            <p>The witnesses for our side include:</p>
            <ul aria-label="Witnesses">
              {witnesses.map((w) => (
                <li key={w}>
                  <User aria-hidden="true" />
                  {w}
                </li>
              ))}
            </ul>
          </>
        )}
        {disclosures && (
          <p className={highlightDisclosures ? 'welcome-email-first welcome-email-marked' : 'welcome-email-first'}>
            First, you&rsquo;ll have to decide which witnesses and documents should be part of the initial disclosures to
            opposing counsel.
          </p>
        )}
        <p>This case is important to the firm, so don&rsquo;t mess up!</p>
        <div className="welcome-email-signature">
          <span className="welcome-email-sign">{partner}</span>
          <strong>Senior Partner</strong>
          <small>
            {firmName} · {COUNSEL[side]}
          </small>
        </div>
      </div>
    </article>
  )
}
