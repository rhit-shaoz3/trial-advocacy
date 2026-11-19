import { useState, type ReactNode } from 'react'
import { ArrowLeft, FileText, HelpCircle, Plus, Trash2 } from 'lucide-react'
import { Modal } from '../../components/Modal'
import type { PlannerCard, PlannerChange, PlannerChart, PlannerSource, WorkspaceWitness } from '../../courses/types'
import { AutoField } from './AutoField'
import type { PlannerChangeFn } from './usePlanner'
import { EvidencePicker } from './EvidencePicker'
import { cardTitle, childrenOf, familyOf, gapTitle } from './plannerLabels'

/**
 * One card, opened from the chart: the fact, its notes, the evidence and
 * witnesses for it, its sub-facts and gaps, and the feedback on it. Every
 * field saves itself; read-only for the instructor.
 */
export function CardDetail({
  card,
  chart,
  witnesses,
  sources,
  onLoadSources,
  change,
  onOpenCard,
  onOpenGap,
  onAddSubFact,
  onAddGap,
  onClose,
  back,
  feedback,
  readOnly = false,
}: {
  card: PlannerCard
  chart: PlannerChart
  witnesses: Pick<WorkspaceWitness, 'id' | 'name' | 'role'>[]
  sources: PlannerSource[] | null
  onLoadSources(): void
  /** Saves a change, made from the latest chart when it's a function (so quick edits don't undo each other). */
  change: PlannerChangeFn
  onOpenCard(cardId: string): void
  onOpenGap(gapId: string): void
  onAddSubFact(parentId: string): void
  onAddGap(cardId: string): void
  onClose(): void
  /** Where the Back button goes: the card or gap this one was opened from. */
  back?: { label: string; onBack(): void }
  /** The feedback pinned to this card, if any. */
  feedback?: ReactNode
  readOnly?: boolean
}) {
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const parent = card.parentId ? chart.cards.find((c) => c.id === card.parentId) : null
  const kids = childrenOf(chart, card.id)
  const siblings = childrenOf(chart, card.parentId)
  const at = siblings.findIndex((c) => c.id === card.id)
  const gaps = chart.gaps.filter((g) => g.cardId === card.id).sort((a, b) => a.position - b.position)
  const tagged = new Set(card.witnessIds)
  // Where it can go: not under itself or one of its own sub-facts.
  const family = familyOf(chart, card.id)

  const run = async (c: PlannerChange | ((chart: PlannerChart) => PlannerChange)) => {
    setError(null)
    try {
      return await change(c)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  const remove = async () => {
    const lost = kids.length > 0 ? ' Its sub-facts go with it; its gaps stay, about the whole case.' : ''
    if (!window.confirm(`Delete “${cardTitle(card)}”?${lost}`)) return
    await run({ op: 'deleteCard', cardId: card.id })
    onClose()
  }

  return (
    <Modal
      eyebrow={card.parentId ? 'Sub-fact' : 'Fact of consequence'}
      title={cardTitle(card)}
      icon={<FileText aria-hidden="true" />}
      onClose={onClose}
    >
      <div className="pl-detail">
        {back && <BackButton {...back} />}
        {parent && (
          <p className="pl-detail-parent">
            Supports{' '}
            <button type="button" className="pl-link" onClick={() => onOpenCard(parent.id)}>
              {cardTitle(parent)}
            </button>
          </p>
        )}
        {feedback}
        <AutoField
          label={card.parentId ? 'Sub-fact to prove' : 'Fact to prove'}
          value={card.title}
          maxLength={300}
          readOnly={readOnly}
          autoFocus={!card.title}
          placeholder={card.parentId ? 'A smaller fact that makes the one above more likely' : 'Who did what, when, and how'}
          hint={
            card.parentId
              ? 'If this is true, how much more likely is the fact above it, and what else could explain it?'
              : 'A fact about this case, not a topic (“the ride”) or a conclusion (“the park was negligent”).'
          }
          onSave={async (title) => void (await run({ op: 'editCard', cardId: card.id, title }))}
        />
        <AutoField
          label="Notes"
          value={card.notes}
          multiline
          maxLength={4000}
          readOnly={readOnly}
          placeholder="The law behind it, who has the burden, what the other side will say…"
          onSave={async (notes) => void (await run({ op: 'editCard', cardId: card.id, notes }))}
        />

        <section className="pl-detail-section" aria-labelledby="pl-evidence-title">
          <h3 id="pl-evidence-title">Evidence</h3>
          {card.evidence.length === 0 && !picking && <p className="muted">No evidence yet.</p>}
          <ul className="pl-evidence">
            {card.evidence.map((e) => (
              <li key={e.id}>
                <div className="pl-evidence-head">
                  <strong>{e.title}</strong>
                  {!readOnly && (
                    <button
                      type="button"
                      className="pl-icon-btn"
                      aria-label={`Remove ${e.title}`}
                      onClick={() => void run({ op: 'deleteEvidence', cardId: card.id, evidenceId: e.id })}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  )}
                </div>
                <AutoField
                  label="The passage"
                  value={e.excerpt}
                  multiline
                  rows={2}
                  maxLength={4000}
                  readOnly={readOnly}
                  onSave={async (excerpt) => void (await run({ op: 'editEvidence', cardId: card.id, evidenceId: e.id, excerpt }))}
                />
                <AutoField
                  label="Why it matters"
                  value={e.note}
                  multiline
                  rows={2}
                  maxLength={4000}
                  readOnly={readOnly}
                  onSave={async (note) => void (await run({ op: 'editEvidence', cardId: card.id, evidenceId: e.id, note }))}
                />
              </li>
            ))}
          </ul>
          {!readOnly &&
            (picking ? (
              <EvidencePicker
                sources={sources}
                onCancel={() => setPicking(false)}
                onAdd={async ({ source, parts, excerpt, note }) => {
                  await change({ op: 'addEvidence', cardId: card.id, kind: source.kind, id: source.id, parts, excerpt, note })
                  setPicking(false)
                }}
              />
            ) : (
              <button
                type="button"
                className="ws-btn"
                onClick={() => {
                  onLoadSources()
                  setPicking(true)
                }}
              >
                <Plus aria-hidden="true" />
                Add evidence
              </button>
            ))}
        </section>

        <section className="pl-detail-section" aria-labelledby="pl-witnesses-title">
          <h3 id="pl-witnesses-title">Witnesses</h3>
          <p className="muted">Who will testify to this from what they saw or did, or lay the foundation for a document?</p>
          {witnesses.length === 0 ? (
            <p className="muted">There are no witnesses in this case yet.</p>
          ) : (
            <div className="pl-chips" role="group" aria-label="Witnesses for this card">
              {witnesses.map((w) => (
                <label key={w.id} className={`pl-chip${tagged.has(w.id) ? ' pl-chip-on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={tagged.has(w.id)}
                    disabled={readOnly}
                    onChange={(e) => {
                      const on = e.target.checked
                      void run((latest) => {
                        const now = latest.cards.find((c) => c.id === card.id)?.witnessIds ?? []
                        return { op: 'setWitnesses', cardId: card.id, witnessIds: on ? [...now, w.id] : now.filter((id) => id !== w.id) }
                      })
                    }}
                  />
                  {w.name}
                  {w.role && <small>{w.role}</small>}
                </label>
              ))}
            </div>
          )}
        </section>

        <section className="pl-detail-section" aria-labelledby="pl-subfacts-title">
          <h3 id="pl-subfacts-title">Sub-facts</h3>
          {kids.length === 0 && <p className="muted">None yet. What smaller facts add up to this one?</p>}
          <ul className="pl-links">
            {kids.map((k) => (
              <li key={k.id}>
                <button type="button" className="pl-link" onClick={() => onOpenCard(k.id)}>
                  {cardTitle(k)}
                </button>
              </li>
            ))}
          </ul>
          {!readOnly && (
            <button
              type="button"
              className="ws-btn"
              onClick={() => onAddSubFact(card.id)}
            >
              <Plus aria-hidden="true" />
              Add a sub-fact
            </button>
          )}
        </section>

        <section className="pl-detail-section" aria-labelledby="pl-gaps-title">
          <h3 id="pl-gaps-title">Gaps</h3>
          {gaps.length === 0 && <p className="muted">Nothing missing yet. Where would a juror ask “how do you know that?”</p>}
          <ul className="pl-links">
            {gaps.map((g) => (
              <li key={g.id}>
                <button type="button" className="pl-link" onClick={() => onOpenGap(g.id)}>
                  <HelpCircle aria-hidden="true" />
                  {gapTitle(g)}
                </button>
              </li>
            ))}
          </ul>
          {!readOnly && (
            <button type="button" className="ws-btn" onClick={() => onAddGap(card.id)}>
              <Plus aria-hidden="true" />
              Add a gap
            </button>
          )}
        </section>

        {error && (
          <p className="pl-error" role="alert">
            {error}
          </p>
        )}
        {!readOnly && (
          // The same moves as dragging the card on the chart, for the keyboard.
          <fieldset className="pl-place">
            <legend className="pl-field-label">Where it goes on the chart</legend>
            <label className="pl-field">
              <span className="pl-field-label">Belongs under</span>
              <select
                value={card.parentId ?? ''}
                onChange={(e) => {
                  const parentId = e.target.value || null
                  void run({ op: 'moveCard', cardId: card.id, parentId, index: childrenOf(chart, parentId).length })
                }}
              >
                <option value="">Nothing: it’s a fact of consequence</option>
                {chart.cards
                  .filter((c) => !family.has(c.id))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.parentId ? '— ' : ''}
                      {cardTitle(c)}
                    </option>
                  ))}
              </select>
            </label>
            {siblings.length > 1 && (
              <label className="pl-field">
                <span className="pl-field-label">Order</span>
                <select
                  value={at}
                  onChange={(e) => void run({ op: 'moveCard', cardId: card.id, parentId: card.parentId, index: Number(e.target.value) })}
                >
                  {siblings.map((_, i) => (
                    <option key={i} value={i}>
                      {i + 1} of {siblings.length}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </fieldset>
        )}
        {!readOnly && (
          <div className="pl-detail-footer">
            <button type="button" className="ws-btn pl-btn-danger" onClick={() => void remove()}>
              <Trash2 aria-hidden="true" />
              Delete card
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}

/** Back to the card or gap this one was opened from. */
export function BackButton({ label, onBack }: { label: string; onBack(): void }) {
  return (
    <button type="button" className="pl-back" onClick={onBack}>
      <ArrowLeft aria-hidden="true" />
      Back to {label}
    </button>
  )
}
