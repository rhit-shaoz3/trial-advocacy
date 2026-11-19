import { forwardRef, type ReactNode } from 'react'
import { ClipboardCheck, HelpCircle, Undo2 } from 'lucide-react'
import type { PlannerChart, PlannerGap, PlannerGapTool, WorkspaceWitness } from '../../courses/types'
import { shortDate } from '../../courses/caseLabels'
import { TOOL_LABEL, WITNESS_TOOLS, cardTitle, gapTitle, gapsInOrder } from './plannerLabels'

/**
 * The finalized plan: every gap's tools in one place, in the chart's order
 * and each gap's own ranking, with the request, email or task each one
 * calls for. A gap opens from its title.
 */
export const PlanActions = forwardRef<
  HTMLElement,
  {
    chart: PlannerChart
    witnesses: Pick<WorkspaceWitness, 'id' | 'name'>[]
    readOnly: boolean
    toolActions?(gap: PlannerGap, tool: PlannerGapTool): ReactNode
    onOpenGap(gap: PlannerGap): void
    onReopen?(): void
  }
>(function PlanActions({ chart, witnesses, readOnly, toolActions, onOpenGap, onReopen }, ref) {
  const gaps = gapsInOrder(chart)
  const planned = gaps.filter((g) => g.tools.length > 0)
  const unplanned = gaps.length - planned.length
  const finalized = chart.finalized!

  return (
    <section ref={ref} className="pl-card pl-plan" aria-labelledby="pl-plan-title" tabIndex={-1}>
      <div className="pl-plan-head">
        <h3 id="pl-plan-title">
          <ClipboardCheck aria-hidden="true" />
          {readOnly ? 'The team’s plan' : 'Your plan'}
        </h3>
        <span className="muted">
          Finalized {shortDate(finalized.at)}
          {finalized.by && ` by ${finalized.by}`}
        </span>
        {!readOnly && onReopen && (
          <button type="button" className="pl-link" onClick={onReopen}>
            <Undo2 aria-hidden="true" />
            Reopen the plan
          </button>
        )}
      </div>
      {!readOnly && (
        <p className="pl-feedback-intro">
          Work down each gap’s tools in order. Each one opens the request or email it means, filled in from your plan, and you
          can change it before you send it.
        </p>
      )}
      {planned.length === 0 && <p className="muted">No gaps have tools yet. Open a gap to choose how you’d fill it.</p>}
      <ul className="pl-plan-gaps">
        {planned.map((g) => {
          const card = g.cardId ? chart.cards.find((c) => c.id === g.cardId) : undefined
          return (
            <li key={g.id} className="pl-plan-gap">
              <div className="pl-plan-gap-head">
                <HelpCircle aria-hidden="true" />
                <button type="button" className="pl-link" onClick={() => onOpenGap(g)}>
                  {gapTitle(g)}
                </button>
                <small className="muted">{card ? `On “${cardTitle(card)}”` : 'About the whole case'}</small>
              </div>
              <ol className="pl-plan-tools">
                {g.tools.map((t) => {
                  const witness = WITNESS_TOOLS.includes(t.tool) ? witnesses.find((w) => w.id === t.witnessId) : undefined
                  const actions = toolActions?.(g, t)
                  return (
                    <li key={t.tool} className="pl-plan-tool">
                      <span className="pl-tool-rank" aria-hidden="true">
                        {t.priority}
                      </span>
                      <div className="pl-plan-tool-text">
                        <strong>
                          {TOOL_LABEL[t.tool]}
                          {witness && `: ${witness.name}`}
                        </strong>
                        {t.specifics.trim() && <span>{t.specifics}</span>}
                      </div>
                      {actions && <div className="pl-tool-actions">{actions}</div>}
                    </li>
                  )
                })}
              </ol>
            </li>
          )
        })}
      </ul>
      {unplanned > 0 && planned.length > 0 && (
        <p className="muted">
          {unplanned === 1 ? '1 gap has' : `${unplanned} gaps have`} no tools yet, so {unplanned === 1 ? 'it isn’t' : 'they aren’t'}{' '}
          here.
        </p>
      )}
    </section>
  )
})
