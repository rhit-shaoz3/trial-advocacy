import { useState, type FormEvent, type ReactNode } from 'react'
import { BookOpen, Check, FileText, Info, Minus, PartyPopper, Plus, Send } from 'lucide-react'
import { WitnessAvatar } from '../../components/WitnessAvatar'
import { shortDate } from '../../courses/caseLabels'
import type { DisclosureItem, DisclosureOption, DisclosurePick, StudentExchange } from '../../courses/types'
import { DictationTextarea } from '../../components/Dictation'

type Disclosures = NonNullable<StudentExchange['disclosures']>

/**
 * A student's own initial disclosures. In the introduction phase: the form
 * (pick witnesses and documents, with a reason for each, and why the rest is
 * held back), then what they submitted. Once the case moves on: how their
 * picks compare with the instructor's.
 */
export function DisclosuresSection({
  disclosures,
  onSubmit,
  onTeach,
}: {
  disclosures: Disclosures
  /** Leave out to make it read-only (a closed case). */
  onSubmit?(picks: DisclosurePick[], heldBackReason: string): Promise<void>
  onTeach(): void
}) {
  const { submission, review, open } = disclosures
  return (
    <section className="cw-card ex-section" aria-labelledby="ex-disclosures-title">
      <header className="ex-section-head">
        <div>
          <span className="ws-eyebrow">Initial disclosures{review ? ' · Review' : ' · FRCP 26(a)(1)'}</span>
          <h2 id="ex-disclosures-title">
            {review
              ? 'How your picks compare with your instructor’s'
              : submission
                ? 'What you disclosed'
                : 'Select what to submit in initial disclosures'}
          </h2>
        </div>
        <button type="button" className="ws-btn ws-btn-secondary" onClick={onTeach} data-tour="ex-teach">
          <BookOpen aria-hidden="true" />
          Teach me
        </button>
      </header>
      {review ? (
        <Review review={review} submitted={Boolean(submission)} />
      ) : submission ? (
        <Submitted disclosures={disclosures} />
      ) : open && onSubmit ? (
        <DisclosureForm options={disclosures.options} onSubmit={onSubmit} />
      ) : (
        <p className="cw-empty">Initial disclosures are closed.</p>
      )}
    </section>
  )
}

function DisclosureForm({
  options,
  onSubmit,
}: {
  options: DisclosureOption[]
  onSubmit(picks: DisclosurePick[], heldBackReason: string): Promise<void>
}) {
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [heldBack, setHeldBack] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const key = (o: DisclosureOption) => `${o.kind}:${o.id}`
  const picked = options.filter((o) => key(o) in reasons)
  const missingReason = picked.find((o) => !reasons[key(o)].trim())
  const holdsBack = picked.length < options.length
  const ready = !missingReason && (!holdsBack || heldBack.trim() !== '')

  function flip(o: DisclosureOption) {
    setReasons((r) => {
      const next = { ...r }
      if (key(o) in next) delete next[key(o)]
      else next[key(o)] = ''
      return next
    })
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(
        picked.map((o) => ({ kind: o.kind, id: o.id, reason: reasons[key(o)].trim() })),
        holdsBack ? heldBack.trim() : '',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  const group = (kind: DisclosureOption['kind'], title: string) => {
    const list = options.filter((o) => o.kind === kind)
    if (list.length === 0) return null
    return (
      <fieldset className="ex-group">
        <legend>{title}</legend>
        {list.map((o) => {
          const on = key(o) in reasons
          return (
            <div key={o.id} className={on ? 'ex-option ex-option-on' : 'ex-option'}>
              <label className="ex-option-row">
                <input type="checkbox" checked={on} onChange={() => flip(o)} />
                <OptionFace item={o} />
                {on && <span className="cw-badge ex-badge-blue">Disclosing</span>}
              </label>
              {on && (
                <label className="ex-reason">
                  Why disclose this?
                  <DictationTextarea
                    value={reasons[key(o)]}
                    onChange={(e) => setReasons((r) => ({ ...r, [key(o)]: e.target.value }))}
                    placeholder="Write a sentence or two…"
                    rows={2}
                    maxLength={1000}
                  />
                </label>
              )}
            </div>
          )
        })}
      </fieldset>
    )
  }

  return (
    <form className="ex-form" onSubmit={submit} aria-label="Initial disclosures">
      <p className="cw-section-sub">
        Choose the witnesses and documents you&rsquo;d disclose to opposing counsel. For each one you disclose, say why. You
        can submit once.
      </p>
      <p className="ex-note">
        <Info aria-hidden="true" />
        Just for you: your picks are practice. They don&rsquo;t change what the other team sees.
      </p>
      {options.length === 0 && <p className="cw-empty">Your side has no witnesses or documents to disclose.</p>}
      {group('witness', 'Your witnesses')}
      {group('material', 'Your documents')}
      {holdsBack && (
        <label className="ex-reason ex-reason-wide">
          Why are you holding back the rest?
          <DictationTextarea value={heldBack} onChange={(e) => setHeldBack(e.target.value)} rows={2} maxLength={1000} />
        </label>
      )}
      <div className="ex-footer">
        <span className="cw-section-sub">
          {picked.length} disclosed · {picked.filter((o) => reasons[key(o)].trim()).length} of {picked.length} reasons
          written
        </span>
        <button type="submit" className="ws-btn ws-btn-primary" disabled={!ready || busy}>
          <Send aria-hidden="true" />
          {busy ? 'Submitting…' : 'Submit initial disclosures'}
        </button>
      </div>
      {!ready && (
        <p className="ex-hint">
          {missingReason
            ? `Write a reason for ${missingReason.name} to submit.`
            : 'Say why you’re holding back the rest to submit.'}{' '}
          Once you submit, you can&rsquo;t change your picks.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}

function Submitted({ disclosures: { submission, options } }: { disclosures: Disclosures }) {
  const picked = new Set(submission!.items.map((i) => `${i.kind}:${i.id}`))
  const heldBack = options.filter((o) => !picked.has(`${o.kind}:${o.id}`))
  return (
    <div className="ex-submitted">
      <p className="ex-done">
        <Check aria-hidden="true" />
        Submitted {shortDate(submission!.submittedAt)}
      </p>
      <div className="ex-columns">
        <div className="ex-box">
          <h3>Disclosed</h3>
          {submission!.items.length === 0 && <p className="cw-empty">Nothing.</p>}
          <ul className="ex-items">
            {submission!.items.map((i) => (
              <li key={`${i.kind}:${i.id}`}>
                <OptionFace item={i} />
                {i.reason && <q>{i.reason}</q>}
              </li>
            ))}
          </ul>
        </div>
        <div className="ex-box ex-box-quiet">
          <h3>Held back</h3>
          {heldBack.length === 0 && <p className="cw-empty">Nothing.</p>}
          <ul className="ex-items">
            {heldBack.map((o) => (
              <li key={o.id}>
                <OptionFace item={o} />
              </li>
            ))}
          </ul>
          {submission!.heldBackReason && <q>{submission!.heldBackReason}</q>}
        </div>
      </div>
      <p className="ex-note">
        <Info aria-hidden="true" />
        When your instructor moves the case to information exchange, this shows how your picks compare with your
        instructor&rsquo;s.
      </p>
    </div>
  )
}

function Review({ review, submitted }: { review: NonNullable<Disclosures['review']>; submitted: boolean }) {
  const perfect = submitted && review.extra.length === 0 && review.missing.length === 0
  return (
    <div className="ex-review">
      <p className="cw-section-sub">Your instructor&rsquo;s picks are now shared with both sides. Here&rsquo;s how yours line up.</p>
      {!submitted && <p className="ex-hint">You didn&rsquo;t submit initial disclosures before the case moved on.</p>}
      {perfect && (
        <p className="ex-perfect">
          <PartyPopper aria-hidden="true" />
          <span>
            <strong>Nicely done: your picks match your instructor&rsquo;s exactly.</strong>
            You disclosed everything you&rsquo;ll rely on, and nothing you didn&rsquo;t need to.
          </span>
        </p>
      )}
      <ul className="ex-score" aria-label="Your score">
        <li className="ex-score-green">
          <strong>{review.matched.length}</strong> Matched
        </li>
        <li className="ex-score-amber">
          <strong>{review.extra.length}</strong> Extra
        </li>
        <li className="ex-score-rose">
          <strong>{review.missing.length}</strong> Missing
        </li>
      </ul>
      <ReviewGroup
        title="Matched"
        tone="green"
        icon={<Check />}
        hint="You and your instructor both disclosed these."
        empty="Nothing matched."
        items={review.matched}
      />
      <ReviewGroup
        title="Extra"
        tone="amber"
        icon={<Plus />}
        hint="You disclosed these, but your instructor didn’t."
        empty="Nothing extra. You didn’t give away anything your instructor kept back."
        items={review.extra}
      />
      <ReviewGroup
        title="Missing"
        tone="rose"
        icon={<Minus />}
        hint="Your instructor disclosed these, but you didn’t."
        empty="Nothing missing."
        items={review.missing}
      />
      {review.missing.length > 0 && (
        <p className="ex-note ex-note-rose">
          <Info aria-hidden="true" />
          If you plan to use a witness or document at trial and don&rsquo;t disclose it, the court can keep it out (FRCP
          37(c)(1)).
        </p>
      )}
    </div>
  )
}

function ReviewGroup({
  title,
  tone,
  icon,
  hint,
  empty,
  items,
}: {
  title: string
  tone: 'green' | 'amber' | 'rose'
  icon: ReactNode
  hint: string
  empty: string
  items: DisclosureItem[]
}) {
  return (
    <section className={`ex-box ex-group-${tone}`} aria-label={title}>
      <h3>
        <span aria-hidden="true">{icon}</span>
        {title}
      </h3>
      <small>{hint}</small>
      {items.length === 0 ? (
        <p className="cw-empty">{empty}</p>
      ) : (
        <ul className="ex-items">
          {items.map((i) => (
            <li key={`${i.kind}:${i.id}`}>
              <OptionFace item={i} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function OptionFace({ item }: { item: Pick<DisclosureItem, 'kind' | 'name' | 'detail' | 'avatarUrl'> }) {
  return (
    <span className="ex-face">
      {item.kind === 'witness' ? (
        <WitnessAvatar src={item.avatarUrl} size="sm" />
      ) : (
        <span className="ws-icon-tile ws-icon-tile-sm ws-tone-blue" aria-hidden="true">
          <FileText />
        </span>
      )}
      <span>
        <strong>{item.name}</strong>
        {item.detail && <small>{item.detail}</small>}
      </span>
    </span>
  )
}
