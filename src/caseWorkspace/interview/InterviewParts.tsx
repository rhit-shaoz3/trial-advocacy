import type { ReactNode } from 'react'
import { FileText, X } from 'lucide-react'
import { Avatar } from '../../components/Avatar'
import { WitnessAvatar } from '../../components/WitnessAvatar'
import { MAX_EXHIBITS, splitExhibits, type Exhibit } from './exhibits'

// The pieces of a conversation with an AI witness, shared by interviews and
// practice sessions.

/** A question, on the right, with the photo (or initials) of whoever asked it. */
export function Question({
  text,
  name,
  avatarUrl,
  you,
  tag,
  className,
  renderText,
}: {
  text: string
  name: string | null
  avatarUrl?: string | null
  you: boolean
  /** A label above the bubble, like "Edited question". */
  tag?: string
  className?: string
  /** Draws what was asked (after any documents), e.g. with words marked. */
  renderText?(rest: string): ReactNode
}) {
  return (
    <div className={`iv-msg iv-msg-q${className ? ` ${className}` : ''}`}>
      <div className="iv-bubble-wrap">
        <span className="iv-who">
          <span className="iv-sr">Question from </span>
          {you ? 'You' : (name ?? 'Your team')}
          {tag && <span className="iv-tag">{tag}</span>}
        </span>
        <p className="iv-bubble">
          <QuestionText text={text} renderText={renderText} />
        </p>
      </div>
      <Avatar name={name ?? '?'} src={avatarUrl} size="sm" />
    </div>
  )
}

/** The witness's answer, on the left, beside their picture. */
export function Answer({
  name,
  avatarUrl,
  thinking = false,
  children,
}: {
  name: string
  avatarUrl?: string | null
  thinking?: boolean
  children: ReactNode
}) {
  return (
    <div className={`iv-msg iv-msg-a${thinking ? ' iv-thinking' : ''}`}>
      <WitnessAvatar src={avatarUrl} size="sm" />
      <div className="iv-bubble-wrap">
        <span className="iv-who">
          <span className="iv-sr">Answer from </span>
          {name}
        </span>
        <div className="iv-bubble">{children}</div>
      </div>
    </div>
  )
}

/** The "is answering…" dots, while the reply is on its way. */
export function Thinking({ label }: { label: string }) {
  return (
    <p role="status">
      <span className="iv-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span>{label}</span>
    </p>
  )
}

/** A question, with any documents shown to the witness as chips before it. */
function QuestionText({ text, renderText }: { text: string; renderText?(rest: string): ReactNode }) {
  const { titles, rest } = splitExhibits(text)
  return (
    <>
      {titles.map((t, i) => (
        <span key={i} className="iv-exhibit">
          <FileText aria-hidden="true" />
          <span className="iv-sr">Shown: </span>
          {t}
        </span>
      ))}
      {renderText ? renderText(rest) : rest}
    </>
  )
}

/**
 * Pick case files to show the witness with the next question ("Do you
 * recognize this document?"). Nothing is uploaded: the witness already has
 * every case file, so the question just names the one handed over.
 */
export function ExhibitPicker({
  exhibits,
  shown,
  disabled,
  onShow,
  onRemove,
}: {
  exhibits: Exhibit[]
  shown: Exhibit[]
  disabled: boolean
  onShow(exhibit: Exhibit): void
  onRemove(id: string): void
}) {
  const left = exhibits.filter((e) => !shown.some((s) => s.id === e.id))
  return (
    <div className="iv-exhibits">
      <select
        aria-label="Show the witness a document"
        value=""
        disabled={disabled || shown.length >= MAX_EXHIBITS || left.length === 0}
        onChange={(e) => {
          const exhibit = exhibits.find((x) => x.id === e.target.value)
          if (exhibit) onShow(exhibit)
        }}
      >
        <option value="">{shown.length >= MAX_EXHIBITS ? `Up to ${MAX_EXHIBITS} documents` : 'Show a document…'}</option>
        {left.map((e) => (
          <option key={e.id} value={e.id}>
            {e.title}
          </option>
        ))}
      </select>
      {shown.map((e) => (
        <span key={e.id} className="iv-exhibit">
          <FileText aria-hidden="true" />
          {e.title}
          <button type="button" aria-label={`Don't show ${e.title}`} onClick={() => onRemove(e.id)}>
            <X aria-hidden="true" />
          </button>
        </span>
      ))}
    </div>
  )
}
