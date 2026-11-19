import { useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, HelpCircle, Trash2 } from 'lucide-react'
import { Modal } from '../../components/Modal'
import {
  PLANNER_TOOLS,
  type PlannerChart,
  type PlannerGap,
  type PlannerGapTool,
  type PlannerTool,
  type WorkspaceWitness,
} from '../../courses/types'
import { AutoField } from './AutoField'
import { BackButton } from './CardDetail'
import { SPECIFICS_HINT, TOOL_HINT, TOOL_LABEL, WITNESS_TOOLS, cardTitle, gapTitle } from './plannerLabels'
import type { PlannerChangeFn } from './usePlanner'

type ToolEdit = Omit<PlannerGapTool, 'priority'>

const asEdits = (tools: PlannerGapTool[]): ToolEdit[] =>
  [...tools].sort((a, b) => a.priority - b.priority).map(({ tool, reason, specifics, witnessId }) => ({ tool, reason, specifics, witnessId }))

/**
 * One gap, opened from the chart: what's missing, which card it's on, and
 * the tools the team would use to fill it, first choice first, each with
 * why and the specifics. Read-only for the instructor.
 */
export function GapDetail({
  gap,
  chart,
  witnesses,
  change,
  onOpenCard,
  onClose,
  feedback,
  toolActions,
  back,
  readOnly = false,
}: {
  gap: PlannerGap
  chart: PlannerChart
  witnesses: Pick<WorkspaceWitness, 'id' | 'name' | 'role'>[]
  change: PlannerChangeFn
  onOpenCard(cardId: string): void
  onClose(): void
  /** The feedback pinned to this gap, if any. */
  feedback?: ReactNode
  /** Where the Back button goes: the card this gap was opened from. */
  back?: { label: string; onBack(): void }
  /** Buttons that act on one of the gap's tools (draft the interrogatory, email the client…). */
  toolActions?(tool: PlannerGapTool): ReactNode
  readOnly?: boolean
}) {
  const [error, setError] = useState<string | null>(null)
  const tools = asEdits(gap.tools)
  const chosen = new Set(tools.map((t) => t.tool))
  const card = gap.cardId ? chart.cards.find((c) => c.id === gap.cardId) : null

  const run = async (...args: Parameters<PlannerChangeFn>) => {
    setError(null)
    try {
      await change(...args)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  /** Saves the gap's tools as `edit` makes them from the latest ones. */
  const editTools = (edit: (tools: ToolEdit[]) => ToolEdit[]) =>
    run((latest) => {
      const now = latest.gaps.find((g) => g.id === gap.id)
      return { op: 'setTools', gapId: gap.id, tools: edit(asEdits(now?.tools ?? [])) }
    })

  const toggle = (tool: PlannerTool, on: boolean) =>
    editTools((list) => (on ? [...list.filter((t) => t.tool !== tool), { tool, reason: '', specifics: '', witnessId: null }] : list.filter((t) => t.tool !== tool)))

  const move = (tool: PlannerTool, by: -1 | 1) =>
    editTools((list) => {
      const at = list.findIndex((t) => t.tool === tool)
      const to = at + by
      if (at < 0 || to < 0 || to >= list.length) return list
      const next = [...list]
      ;[next[at], next[to]] = [next[to], next[at]]
      return next
    })

  const setField = (tool: PlannerTool, field: Partial<ToolEdit>) =>
    editTools((list) => list.map((t) => (t.tool === tool ? { ...t, ...field } : t)))

  const remove = async () => {
    if (!window.confirm(`Delete the gap “${gapTitle(gap)}”?`)) return
    await run({ op: 'deleteGap', gapId: gap.id })
    onClose()
  }

  return (
    <Modal eyebrow="Gap" title={gapTitle(gap)} icon={<HelpCircle aria-hidden="true" />} onClose={onClose}>
      <div className="pl-detail">
        {back && <BackButton {...back} />}
        {feedback}
        <AutoField
          label="What's missing"
          value={gap.description}
          multiline
          maxLength={4000}
          readOnly={readOnly}
          autoFocus={!gap.description}
          placeholder="What would a juror ask here that you can't answer yet?"
          hint="Be curious. What happened just before and just after? Why would anyone do that? And is this gap worth the time to fill?"
          onSave={(description) => run({ op: 'editGap', gapId: gap.id, description })}
        />
        <label className="pl-field">
          <span className="pl-field-label">About</span>
          {readOnly ? (
            <p className="pl-field-text">{card ? cardTitle(card) : 'The whole case'}</p>
          ) : (
            <select value={gap.cardId ?? ''} onChange={(e) => void run({ op: 'editGap', gapId: gap.id, cardId: e.target.value || null })}>
              <option value="">The whole case</option>
              {chart.cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.parentId ? '— ' : ''}
                  {cardTitle(c)}
                </option>
              ))}
            </select>
          )}
        </label>
        {card && (
          <p className="pl-detail-parent">
            <button type="button" className="pl-link" onClick={() => onOpenCard(card.id)}>
              Open “{cardTitle(card)}”
            </button>
          </p>
        )}

        <section className="pl-detail-section" aria-labelledby="pl-tools-title">
          <h3 id="pl-tools-title">How you&rsquo;d fill it</h3>
          {!readOnly && (
            <>
              <p className="muted">Choose every tool that might work. Then put them in order: most likely to work, for the least cost, first.</p>
              <div className="pl-tool-picks" role="group" aria-label="Tools">
                {PLANNER_TOOLS.map((tool) => (
                  <label key={tool} className={`pl-chip${chosen.has(tool) ? ' pl-chip-on' : ''}`} title={TOOL_HINT[tool]}>
                    <input type="checkbox" checked={chosen.has(tool)} onChange={(e) => void toggle(tool, e.target.checked)} />
                    {TOOL_LABEL[tool]}
                  </label>
                ))}
              </div>
            </>
          )}
          {tools.length === 0 && <p className="muted">No tools chosen yet.</p>}
          <ol className="pl-tools">
            {tools.map((t, i) => (
              <li key={t.tool} className="pl-tool">
                <div className="pl-tool-head">
                  <span className="pl-tool-rank" aria-hidden="true">
                    {i + 1}
                  </span>
                  <div>
                    <strong>{TOOL_LABEL[t.tool]}</strong>
                    <small>{TOOL_HINT[t.tool]}</small>
                  </div>
                  {!readOnly && tools.length > 1 && (
                    <span className="pl-tool-move">
                      <button type="button" className="pl-icon-btn" disabled={i === 0} aria-label={`Move ${TOOL_LABEL[t.tool]} up`} onClick={() => void move(t.tool, -1)}>
                        <ArrowUp aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="pl-icon-btn"
                        disabled={i === tools.length - 1}
                        aria-label={`Move ${TOOL_LABEL[t.tool]} down`}
                        onClick={() => void move(t.tool, 1)}
                      >
                        <ArrowDown aria-hidden="true" />
                      </button>
                    </span>
                  )}
                </div>
                {WITNESS_TOOLS.includes(t.tool) && (
                  <label className="pl-field">
                    <span className="pl-field-label">Witness</span>
                    {readOnly ? (
                      <p className="pl-field-text">{witnesses.find((w) => w.id === t.witnessId)?.name ?? 'Not chosen'}</p>
                    ) : (
                      <select value={t.witnessId ?? ''} onChange={(e) => void setField(t.tool, { witnessId: e.target.value || null })}>
                        <option value="">Choose a witness</option>
                        {witnesses.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                            {w.role ? ` (${w.role})` : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </label>
                )}
                <AutoField
                  label="Why this tool"
                  value={t.reason}
                  multiline
                  rows={2}
                  maxLength={4000}
                  readOnly={readOnly}
                  onSave={(reason) => setField(t.tool, { reason })}
                />
                <AutoField
                  label="Specifics"
                  value={t.specifics}
                  multiline
                  rows={2}
                  maxLength={4000}
                  readOnly={readOnly}
                  placeholder={SPECIFICS_HINT[t.tool]}
                  onSave={(specifics) => setField(t.tool, { specifics })}
                />
                {toolActions && (
                  <div className="pl-tool-actions">{toolActions({ ...t, priority: i + 1 })}</div>
                )}
              </li>
            ))}
          </ol>
        </section>

        {error && (
          <p className="pl-error" role="alert">
            {error}
          </p>
        )}
        {!readOnly && (
          <div className="pl-detail-footer">
            <button type="button" className="ws-btn pl-btn-danger" onClick={() => void remove()}>
              <Trash2 aria-hidden="true" />
              Delete gap
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
