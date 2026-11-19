import { Check, MessageCircleQuestion, RotateCcw, X } from 'lucide-react'
import type { PlannerChart, PlannerReview, PlannerTag } from '../../courses/types'
import { AutoField } from './AutoField'
import { cardTitle, gapTitle } from './plannerLabels'
import { readyRounds as ready, type FeedbackState } from './usePlannerFeedback'

const TAG: Record<PlannerTag, { label: string; tone: string; icon: typeof Check }> = {
  LOOKS_GOOD: { label: 'Ready to act on', tone: 'good', icon: Check },
  SMALL_EDITS: { label: 'Small edits', tone: 'edits', icon: MessageCircleQuestion },
  NEEDS_IMPROVEMENT: { label: 'Needs work', tone: 'work', icon: X },
}

function TagBadge({ tag }: { tag: PlannerTag }) {
  const t = TAG[tag]
  const Icon = t.icon
  return (
    <span className={`pl-tag pl-tag-${t.tone}`}>
      <Icon aria-hidden="true" />
      {t.label}
    </span>
  )
}

/** Asking for the next round, with how many are left; at the top of the feedback, and under the chart. */
export function AskFeedback({ state }: { state: FeedbackState }) {
  const { feedback, busy, waiting, ask } = state
  if (!feedback) return null
  const { limit, used } = feedback
  const left = Math.max(0, limit.max - used)
  return (
    <div className="pl-feedback-ask">
      <button type="button" className="ws-btn ws-btn-primary" disabled={busy || waiting || left === 0} onClick={() => void ask()}>
        <MessageCircleQuestion aria-hidden="true" />
        {waiting ? 'Feedback on its way…' : ready(feedback).length ? 'Ask for another round' : 'Ask for feedback'}
      </button>
      <span className="muted">
        {used} of {limit.max} {limit.max === 1 ? 'round' : 'rounds'} used {limit.per === 'student' ? 'by you' : 'by your team'}
        {left > 0 ? ` · ${left} left` : ''}
      </span>
    </div>
  )
}

/**
 * The feedback: asking for the next round, and the rounds so far, newest
 * first. Each question on a card or gap opens it, and shows a check once
 * the team has replied to it.
 */
export function FeedbackPanel({
  state,
  chart,
  readOnly,
  onOpen,
}: {
  state: FeedbackState
  chart: PlannerChart
  readOnly: boolean
  onOpen(kind: 'card' | 'gap', id: string): void
}) {
  const { feedback, error, busy, waiting, retry } = state
  if (!feedback) return null
  const { reviews } = feedback
  const failed = reviews.at(-1)?.status === 'failed' ? reviews.at(-1) : null
  const rounds = ready(feedback).reverse()

  const target = (kind: 'card' | 'gap', id: string) => {
    if (kind === 'card') {
      const card = chart.cards.find((c) => c.id === id)
      return card ? cardTitle(card) : null
    }
    const gap = chart.gaps.find((g) => g.id === id)
    return gap ? gapTitle(gap) : null
  }

  return (
    <div className="pl-feedback">
      {!readOnly && <AskFeedback state={state} />}
      {waiting && (
        <p className="pl-feedback-waiting" role="status">
          <span className="pl-spinner" aria-hidden="true" />
          A mentor is reading your chart as it was when you asked. It takes a minute or two; you can keep working, or leave
          and come back.
        </p>
      )}
      {error && (
        <p className="pl-error" role="alert">
          {error}
        </p>
      )}
      {failed && !waiting && (
        <p className="pl-error" role="alert">
          {failed.error ?? 'The feedback couldn’t be written.'}{' '}
          {!readOnly && (
            <button type="button" className="pl-link" disabled={busy} onClick={() => void retry(failed.id)}>
              <RotateCcw aria-hidden="true" />
              Try again
            </button>
          )}
        </p>
      )}
      {rounds.length === 0 && !waiting && (
        <p className="muted">{readOnly ? 'The team hasn’t asked for feedback yet.' : 'No feedback yet.'}</p>
      )}
      {rounds.map((r, i) => (
        <Round key={r.id} review={r} target={target} onOpen={onOpen} open={i === 0} />
      ))}
    </div>
  )
}

function Round({
  review,
  target,
  onOpen,
  open,
}: {
  review: PlannerReview
  target(kind: 'card' | 'gap', id: string): string | null
  onOpen(kind: 'card' | 'gap', id: string): void
  open: boolean
}) {
  const body = (
    <>
      {review.overview && <p className="pl-round-text">{review.overview}</p>}
      {review.notes.length > 0 && (
        <ul className="pl-round-notes">
          {review.notes.map((n, i) => {
            const title = target(n.targetKind, n.targetId)
            const replied = review.replies.some((r) => r.targetKind === n.targetKind && r.targetId === n.targetId)
            return (
              <li key={i} className={replied ? 'pl-note-replied' : undefined}>
                <span className="pl-note-head">
                  {replied && (
                    <span className="pl-note-check" title="You replied">
                      <Check aria-label="Replied" />
                    </span>
                  )}
                  {title ? (
                    <button type="button" className="pl-link" onClick={() => onOpen(n.targetKind, n.targetId)}>
                      {n.targetKind === 'gap' ? 'Gap: ' : ''}
                      {title}
                    </button>
                  ) : (
                    <span className="muted">On a {n.targetKind} you’ve removed</span>
                  )}
                </span>
                <p className="pl-round-text">{n.text}</p>
              </li>
            )
          })}
        </ul>
      )}
      {review.bigPicture && (
        <div className="pl-round-big">
          <strong>The big picture</strong>
          <p className="pl-round-text">{review.bigPicture}</p>
        </div>
      )}
    </>
  )
  const head = (
    <>
      <span>
        Round {review.round}
        {review.askedBy && <small> · asked by {review.mine ? 'you' : review.askedBy}</small>}
      </span>
      {review.tag && <TagBadge tag={review.tag} />}
    </>
  )
  return open ? (
    <section className="pl-round" aria-label={`Feedback, round ${review.round}`}>
      <h4 className="pl-round-head">{head}</h4>
      {body}
    </section>
  ) : (
    <details className="pl-round">
      <summary className="pl-round-head">{head}</summary>
      {body}
    </details>
  )
}

/** The questions on one card or gap, newest round first, each with the team's reply. */
export function PinnedNotes({
  state,
  kind,
  id,
  readOnly,
}: {
  state: FeedbackState
  kind: 'card' | 'gap'
  id: string
  readOnly: boolean
}) {
  const rounds = ready(state.feedback)
    .filter((r) => r.notes.some((n) => n.targetKind === kind && n.targetId === id))
    .reverse()
  if (rounds.length === 0) return null
  return (
    <section className="pl-pinned" aria-label="Feedback on this">
      {rounds.map((r, i) => {
        const reply = r.replies.find((p) => p.targetKind === kind && p.targetId === id)
        const notes = r.notes.filter((n) => n.targetKind === kind && n.targetId === id)
        const inner = (
          <>
            {notes.map((n, j) => (
              <p key={j} className="pl-round-text">
                {n.text}
              </p>
            ))}
            <AutoField
              label="Your reply (optional)"
              value={reply?.text ?? ''}
              multiline
              rows={2}
              maxLength={4000}
              readOnly={readOnly || i > 0}
              hint={i === 0 && !readOnly ? 'Your next round of feedback reads it.' : undefined}
              onSave={(text) => state.reply(r.id, { kind, id }, text)}
            />
          </>
        )
        return i === 0 ? (
          <div key={r.id} className="pl-pinned-round">
            <span className="pl-pinned-head">
              <MessageCircleQuestion aria-hidden="true" />
              Feedback, round {r.round}
            </span>
            {inner}
          </div>
        ) : (
          <details key={r.id} className="pl-pinned-round">
            <summary className="pl-pinned-head">Feedback, round {r.round}</summary>
            {inner}
          </details>
        )
      })}
    </section>
  )
}
