import { Fragment, useState, type ReactNode } from 'react'
import { Check, Crosshair, Gavel, Landmark, MessageCircle, Scale, ShieldAlert, Signpost, Sparkles, SpellCheck, Users } from 'lucide-react'
import type { CoachKind, PracticeSession, PracticeTurn, PracticeTurnKind } from '../../courses/types'
import { Answer, Question } from '../interview/InterviewParts'
import { COACH_LABEL, COACH_TONE, markQuotes } from './practiceLabels'
import './practice.css'

const COACH_ICON: Record<CoachKind, typeof Check> = {
  good: Check,
  off_target: Crosshair,
  leading: Signpost,
  evidence: Scale,
  ethics: ShieldAlert,
  judge_jury: Users,
  grammar: SpellCheck,
  polish: Sparkles,
  note: MessageCircle,
}

const TURN_TAG: Record<PracticeTurnKind, string | undefined> = {
  question: undefined,
  edited: 'Edited question',
  as_written: 'Asked as written',
  objection_response: 'Your response to the objection',
}

/**
 * A practice session's transcript, with the coach's notes in a margin beside
 * each turn, like comments on a document: the words a note quotes are marked
 * in the question, and pointing at either lights up both. Narrow, the notes
 * sit under the question. Held questions say so; objections and rulings
 * show as counsel and the court speaking.
 */
export function PracticeTranscript({
  session,
  you,
  children,
}: {
  session: Pick<PracticeSession, 'witness' | 'turns'>
  you: { name: string | null; avatarUrl?: string | null }
  /** More turns at the end, like the one waiting for its reply. */
  children?: ReactNode
}) {
  /** The note pointed at, as "position:index". */
  const [active, setActive] = useState<string | null>(null)
  return (
    <ol className="iv-transcript pr-transcript" aria-label="Transcript">
      {session.turns.map((t) => (
        <PracticeTurnRow key={t.position} turn={t} witness={session.witness} you={you} active={active} onActive={setActive} />
      ))}
      {children}
    </ol>
  )
}

function PracticeTurnRow({
  turn,
  witness,
  you,
  active,
  onActive,
}: {
  turn: PracticeTurn
  witness: PracticeSession['witness']
  you: { name: string | null; avatarUrl?: string | null }
  active: string | null
  onActive(key: string | null): void
}) {
  const { blocks } = turn
  const key = (i: number) => `${turn.position}:${i}`
  const point = (i: number) => ({
    onMouseEnter: () => onActive(key(i)),
    onMouseLeave: () => onActive(null),
  })
  const marked = (rest: string) => {
    const spans = markQuotes(rest, blocks.coach.map((n) => n.quote))
    if (spans.length === 0) return rest
    const out: ReactNode[] = []
    let at = 0
    for (const s of spans) {
      out.push(rest.slice(at, s.start))
      const tone = COACH_TONE[blocks.coach[s.index].kind]
      out.push(
        <mark
          key={s.index}
          className={`pr-mark pr-mark-${tone}${active === key(s.index) ? ' pr-active' : ''}`}
          aria-describedby={`pr-note-${key(s.index).replace(':', '-')}`}
          {...point(s.index)}
        >
          {rest.slice(s.start, s.end)}
        </mark>,
      )
      at = s.end
    }
    out.push(rest.slice(at))
    return out.map((part, i) => <Fragment key={i}>{part}</Fragment>)
  }

  return (
    <li className={`pr-turn${blocks.coach.length ? ' pr-turn-noted' : ''}`}>
      <div className="pr-q">
        <Question
          text={turn.text}
          name={you.name}
          avatarUrl={you.avatarUrl}
          you
          tag={blocks.hold ? 'Held, not asked' : TURN_TAG[turn.kind]}
          className={`${turn.kind === 'objection_response' ? 'pr-q-response' : ''}${blocks.hold ? ' pr-q-held' : ''}`}
          renderText={marked}
        />
      </div>
      {blocks.coach.length > 0 && (
        <aside className="pr-margin" aria-label="Coach’s notes">
          {blocks.coach.map((n, i) => {
            const Icon = COACH_ICON[n.kind]
            return (
              <div
                key={i}
                id={`pr-note-${key(i).replace(':', '-')}`}
                className={`pr-note pr-note-${COACH_TONE[n.kind]}${active === key(i) ? ' pr-active' : ''}`}
                tabIndex={0}
                onFocus={() => onActive(key(i))}
                onBlur={() => onActive(null)}
                {...point(i)}
              >
                <span className="pr-note-head">
                  <Icon aria-hidden="true" />
                  {COACH_LABEL[n.kind]}
                </span>
                {n.quote && <q className="pr-note-quote">{n.quote}</q>}
                <p>{n.text}</p>
              </div>
            )
          })}
        </aside>
      )}
      <div className="pr-rest">
        {blocks.hold && <p className="pr-held">Not asked yet. Edit the question, or ask it as written.</p>}
        {blocks.objection && (
          <p className="iv-objection pr-objection">
            <Gavel aria-hidden="true" />
            <span>
              <strong>{blocks.objection.by}:</strong> {blocks.objection.text}
            </span>
          </p>
        )}
        {blocks.ruling && (
          <p className={`pr-ruling pr-ruling-${blocks.ruling.result}`}>
            <Landmark aria-hidden="true" />
            <span>
              <strong>The Court:</strong> {blocks.ruling.text}
            </span>
          </p>
        )}
        {blocks.counsel && (
          <p className="iv-objection">
            <Gavel aria-hidden="true" />
            <span>{blocks.counsel}</span>
          </p>
        )}
        {blocks.witness && (
          <Answer name={witness.name} avatarUrl={witness.avatarUrl}>
            <p>{blocks.witness}</p>
          </Answer>
        )}
      </div>
    </li>
  )
}
