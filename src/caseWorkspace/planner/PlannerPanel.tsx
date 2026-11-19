import { useRef, useState, type ReactNode } from 'react'
import { Check, ClipboardCheck, ListChecks, MessageCircleQuestion } from 'lucide-react'
import type { PlannerGap, PlannerGapTool, WorkspaceWitness } from '../../courses/types'
import { CardDetail } from './CardDetail'
import { GapDetail } from './GapDetail'
import { PlanActions } from './PlanActions'
import { PlannerChart } from './PlannerChart'
import { STEPS, cardTitle, gapTitle, stepsDone } from './plannerLabels'
import { usePlanner, type PlannerActions } from './usePlanner'
import { FeedbackRounds, FeedbackStatus, PinnedNotes } from './PlannerFeedback'
import { noteMarks, usePlannerFeedback, type FeedbackActions } from './usePlannerFeedback'
import './planner.css'

type Target = { kind: 'card' | 'gap'; id: string }

/** The steps that are the team's to do; feedback has its own card. */
const TODO = STEPS.filter((s) => s.id !== 'feedback')

/**
 * The team's case planner: a to-do list of the steps (checked off as the
 * chart fills in, each with what good lawyers do) beside a card for asking
 * for feedback, the rounds of feedback across the width below them, and the
 * chart. Under the chart, the team finalizes its plan; then its gaps' tools
 * are listed there, each with the request, email or task it calls for, and
 * the feedback folds away. A card or gap opens in its own window, where
 * everything saves itself; one opened from another has a Back button to it.
 * Read-only for the instructor and once the case closes.
 */
export function PlannerPanel({
  actions,
  witnesses,
  rootLabel,
  readOnly = false,
  feedback,
  toolActions,
}: {
  actions: PlannerActions
  witnesses: Pick<WorkspaceWitness, 'id' | 'name' | 'role'>[]
  rootLabel: string
  readOnly?: boolean
  /** The rounds of AI feedback on the chart; leave out to show the chart without them. */
  feedback?: FeedbackActions
  toolActions?(gap: PlannerGap, tool: PlannerGapTool): ReactNode
}) {
  const { chart, sources, loadSources, change, status, error } = usePlanner(actions)
  const review = usePlannerFeedback(feedback)
  /** The card or gap open now, and the ones it was opened from, for Back. */
  const [trail, setTrail] = useState<Target[]>([])
  const [addError, setAddError] = useState<string | null>(null)
  /** Whether the feedback is unfolded, once someone has folded or unfolded it; it starts folded once the plan is finalized. */
  const [roundsOpen, setRoundsOpen] = useState<boolean | null>(null)
  const plan = useRef<HTMLElement>(null)

  if (chart === undefined) return <p className="muted" role="status">{error ?? 'Loading your planner…'}</p>
  if (chart === null) return <p className="muted">Your team gets its planner once it is in a case world.</p>

  const done = stepsDone(chart)
  const next = TODO.find((s) => !done[s.id])?.id
  const open = trail.at(-1)
  const card = open?.kind === 'card' ? chart.cards.find((c) => c.id === open.id) : undefined
  const gap = open?.kind === 'gap' ? chart.gaps.find((g) => g.id === open.id) : undefined
  const from = trail.at(-2)

  /** Opens a card or gap from the chart, starting a new trail. */
  const openFresh = (target: Target) => setTrail([target])
  /** Opens one from inside another, so Back returns to it. */
  const openFrom = (target: Target) => setTrail((t) => [...t, target])
  const back = from && {
    label: `“${from.kind === 'card' ? cardTitle(chart.cards.find((c) => c.id === from.id) ?? { title: '', parentId: null }) : gapTitle(chart.gaps.find((g) => g.id === from.id) ?? { description: '' })}”`,
    onBack: () => setTrail((t) => t.slice(0, -1)),
  }

  const add = async (made: Parameters<typeof change>[0], kind: 'card' | 'gap', fromOpen: boolean) => {
    setAddError(null)
    try {
      const result = await change(made)
      if (result?.id) (fromOpen ? openFrom : openFresh)({ kind, id: result.id })
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }
  const addSubFact = (parentId: string, fromOpen: boolean) => add({ op: 'addCard', parentId, title: '' }, 'card', fromOpen)
  const addGap = (cardId: string | null, fromOpen: boolean) => add({ op: 'addGap', cardId, description: '' }, 'gap', fromOpen)
  const finalize = async (finalized: boolean) => {
    setAddError(null)
    try {
      await change({ op: 'finalize', finalized })
      setRoundsOpen(!finalized)
      if (finalized) requestAnimationFrame(() => plan.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }))
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }
  const pinned = (kind: 'card' | 'gap', id: string) => feedback && <PinnedNotes state={review} kind={kind} id={id} readOnly={readOnly} />

  return (
    <div className="pl">
      <header className="pl-head">
        <div>
          <span className="ws-eyebrow">Where do I start?</span>
          <h2 className="cw-section-title">Case planner</h2>
          <p className="cw-section-sub">
            {readOnly
              ? 'The team’s chart of what it must prove, its evidence, its gaps, and how it plans to fill them.'
              : 'Your team’s chart of what you must prove, your evidence, your gaps, and how you’ll fill them. Your partner sees every change.'}
          </p>
        </div>
        {!readOnly && (
          <span className={`pl-status pl-status-${status}`} role="status">
            {status === 'saving' ? 'Saving…' : status === 'error' ? 'Couldn’t save the last change' : 'All changes saved'}
          </span>
        )}
      </header>

      <div className={feedback ? 'pl-top' : 'pl-top pl-top-one'}>
        <section className="pl-card pl-todo" aria-labelledby="pl-todo-title">
          <h3 id="pl-todo-title">
            <ListChecks aria-hidden="true" />
            To do
          </h3>
          <ul>
            {TODO.map((s) => (
              <li key={s.id} className={done[s.id] ? 'pl-todo-done' : undefined}>
                <details open={!readOnly && s.id === next}>
                  <summary>
                    <span className="pl-todo-box" aria-hidden="true">
                      {done[s.id] && <Check />}
                    </span>
                    <span>
                      {s.title}
                      <span className="pl-visually-hidden">{done[s.id] ? ', done' : ', to do'}</span>
                    </span>
                  </summary>
                  {s.guide.map((p) => (
                    <p key={p}>{p}</p>
                  ))}
                </details>
              </li>
            ))}
          </ul>
        </section>
        {feedback && (
          <section className="pl-card pl-feedback-card" aria-labelledby="pl-feedback-title">
            <h3 id="pl-feedback-title">
              <MessageCircleQuestion aria-hidden="true" />
              Feedback
            </h3>
            {!readOnly && <p className="pl-feedback-intro">{STEPS.find((s) => s.id === 'feedback')!.guide[0]}</p>}
            <FeedbackStatus state={review} readOnly={readOnly} />
          </section>
        )}
      </div>
      {feedback && (
        <FeedbackRounds
          state={review}
          chart={chart}
          readOnly={readOnly}
          open={roundsOpen ?? !chart.finalized}
          onToggle={setRoundsOpen}
          onOpen={(kind, id) => openFresh({ kind, id })}
        />
      )}

      {addError && (
        <p className="pl-error" role="alert">
          {addError}
        </p>
      )}
      <PlannerChart
        chart={chart}
        rootLabel={rootLabel}
        notes={noteMarks(review.feedback)}
        onOpenCard={(c) => openFresh({ kind: 'card', id: c.id })}
        onOpenGap={(g) => openFresh({ kind: 'gap', id: g.id })}
        onAddFact={readOnly ? undefined : () => void add({ op: 'addCard', parentId: null, title: '' }, 'card', false)}
        onAddSubFact={readOnly ? undefined : (parent) => void addSubFact(parent.id, false)}
        onAddGap={readOnly ? undefined : () => void addGap(null, false)}
        onMove={readOnly ? undefined : (m) => void change({ op: 'moveCard', ...m }).catch((err: Error) => setAddError(err.message))}
      />
      {!readOnly && !chart.finalized && chart.cards.length > 0 && (
        <div className="pl-bottom-ask">
          <p>When your chart tells your story and each gap has its tools, finalize your plan to turn the tools into requests, emails and tasks.</p>
          <button type="button" className="ws-btn ws-btn-primary" disabled={status === 'saving'} onClick={() => void finalize(true)}>
            <ClipboardCheck aria-hidden="true" />
            Finalize plan
          </button>
        </div>
      )}
      {chart.finalized && (
        <PlanActions
          ref={plan}
          chart={chart}
          witnesses={witnesses}
          readOnly={readOnly}
          toolActions={toolActions}
          onOpenGap={(g) => openFresh({ kind: 'gap', id: g.id })}
          onReopen={() => void finalize(false)}
        />
      )}

      {card && (
        <CardDetail
          key={card.id}
          card={card}
          chart={chart}
          witnesses={witnesses}
          sources={sources}
          onLoadSources={loadSources}
          change={change}
          readOnly={readOnly}
          feedback={pinned('card', card.id)}
          back={back}
          onOpenCard={(id) => openFrom({ kind: 'card', id })}
          onOpenGap={(id) => openFrom({ kind: 'gap', id })}
          onAddSubFact={(parentId) => void addSubFact(parentId, true)}
          onAddGap={(cardId) => void addGap(cardId, true)}
          onClose={() => setTrail([])}
        />
      )}
      {gap && (
        <GapDetail
          key={gap.id}
          gap={gap}
          chart={chart}
          witnesses={witnesses}
          change={change}
          readOnly={readOnly}
          feedback={pinned('gap', gap.id)}
          back={back}
          toolActions={chart.finalized && toolActions ? (tool) => toolActions(gap, tool) : undefined}
          onOpenCard={(id) => openFrom({ kind: 'card', id })}
          onClose={() => setTrail([])}
        />
      )}
    </div>
  )
}

