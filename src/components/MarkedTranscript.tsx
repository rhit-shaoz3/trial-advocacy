import type { ReviewTranscript, ReviewTurn } from '../courses/types'
import './MarkedTranscript.css'

/**
 * A reviewed interview's transcript. Exchanges that rest on a denied fact are
 * red and crossed out, with a note saying which fact: the exchange that
 * stated it in full, and a later question that built on it (with its answer
 * too, if the answer relies on it).
 */
export function MarkedTranscript({ transcript }: { transcript: ReviewTranscript }) {
  const { turns, marked } = transcript
  if (turns.length === 0) return <p className="muted">This interview had no questions.</p>
  return (
    <>
      {!marked && (
        <p className="transcript-note">
          This interview was reviewed before transcripts were marked; check the denied facts for what not to rely on.
        </p>
      )}
      <ol className="transcript">
        {turns.map((t) => (
          <Exchange key={t.position} turn={t} />
        ))}
      </ol>
    </>
  )
}

function Exchange({ turn: t }: { turn: ReviewTurn }) {
  const strikeQuestion = t.struck === 'all' || t.struck === 'question'
  const strikeAnswer = t.struck === 'all'
  const number = t.position + 1
  return (
    <li className={t.struck ? 'transcript-turn transcript-turn-struck' : 'transcript-turn'}>
      {t.reasons?.map((r) => (
        <p key={`${r.kind}-${r.fact}`} className="transcript-strike-note">
          {r.kind === 'produced' ? (
            <>
              <strong>Denied:</strong> {r.fact} Don&rsquo;t rely on this answer.
            </>
          ) : (
            <>
              <strong>Built on a denied fact:</strong> {r.fact}
            </>
          )}
        </p>
      ))}
      <p className={strikeQuestion ? 'transcript-strike' : undefined}>
        <strong>Q{number}.</strong> {t.question}
        {t.askedBy && <small> ({t.askedBy})</small>}
        {strikeQuestion && <span className="transcript-sr"> (struck out)</span>}
      </p>
      {t.objection && <p className="transcript-objection">{t.objection}</p>}
      <p className={strikeAnswer ? 'transcript-strike' : undefined}>
        <strong>A{number}.</strong> {t.answer}
        {strikeAnswer && <span className="transcript-sr"> (struck out)</span>}
      </p>
    </li>
  )
}
