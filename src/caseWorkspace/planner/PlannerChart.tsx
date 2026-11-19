import { useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core'
import { Check, FileText, GripVertical, HelpCircle, MessageCircleQuestion, Plus, Users } from 'lucide-react'
import type { PlannerCard, PlannerChart as Chart, PlannerGap } from '../../courses/types'
import { cardTitle, childrenOf, dropTarget, gapTitle, type CardMove } from './plannerLabels'
import type { NoteMark } from './usePlannerFeedback'

/** The edge zones (before, after) win over the card they're on (into). */
const collisions: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  const edge = hits.filter((h) => /^(before|after):/.test(String(h.id)))
  return edge.length ? edge : hits
}

/**
 * The team's chart as a tree: its case at the top, the facts of consequence
 * under it, each one's sub-facts under that, joined by lines. A card's gaps
 * hang under it as dashed cards; gaps about the whole case sit in a row of
 * their own. Clicking a card or a gap opens it, and a card's plus adds a
 * sub-fact under it. Dragging a card onto another makes it a sub-fact of that
 * one; dropping it on a card's edge puts it beside that card; dropping it on
 * the top makes it a fact of consequence. Narrow, the tree is an indented list.
 */
export function PlannerChart({
  chart,
  rootLabel,
  notes,
  onOpenCard,
  onOpenGap,
  onAddFact,
  onAddSubFact,
  onAddGap,
  onMove,
}: {
  chart: Chart
  /** The top of the tree, e.g. "Team 1 for the plaintiff". */
  rootLabel: string
  /** The latest feedback on each card or gap, by id. */
  notes?: Map<string, NoteMark>
  onOpenCard(card: PlannerCard): void
  onOpenGap(gap: PlannerGap): void
  /** Leave these out to make the chart read-only. */
  onAddFact?(): void
  onAddSubFact?(parent: PlannerCard): void
  onAddGap?(): void
  onMove?(move: CardMove): void
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const [dragging, setDragging] = useState<string | null>(null)
  const facts = childrenOf(chart, null)
  const loose = chart.gaps.filter((g) => !g.cardId).sort((a, b) => a.position - b.position)
  const dragged = dragging ? chart.cards.find((c) => c.id === dragging) : undefined
  const canDrag = Boolean(onMove)

  const end = ({ active, over }: DragEndEvent) => {
    setDragging(null)
    if (!over || !onMove) return
    const cardId = String(active.id).replace(/^card:/, '')
    const move = dropTarget(chart, cardId, String(over.id))
    if (!move) return
    const card = chart.cards.find((c) => c.id === cardId)!
    const now = childrenOf(chart, move.parentId).findIndex((c) => c.id === cardId)
    if (card.parentId === move.parentId && now === move.index) return
    onMove(move)
  }

  const branch = (card: PlannerCard) => {
    const kids = childrenOf(chart, card.id)
    const gaps = chart.gaps.filter((g) => g.cardId === card.id).sort((a, b) => a.position - b.position)
    return (
      <li key={card.id}>
        <div className="pl-node-stack">
          <CardNode
            card={card}
            gaps={gaps.length}
            mark={notes?.get(card.id)}
            draggable={canDrag}
            dragging={dragging}
            blocked={dragging ? !dropTarget(chart, dragging, `into:${card.id}`) : false}
            onOpen={() => onOpenCard(card)}
            onAddSubFact={onAddSubFact && (() => onAddSubFact(card))}
          />
          {gaps.map((g) => (
            <GapNode key={g.id} gap={g} mark={notes?.get(g.id)} onOpen={() => onOpenGap(g)} />
          ))}
        </div>
        {kids.length > 0 && <ul>{kids.map(branch)}</ul>}
      </li>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisions}
      onDragStart={({ active }) => setDragging(String(active.id).replace(/^card:/, ''))}
      onDragCancel={() => setDragging(null)}
      onDragEnd={end}
    >
      <div className={`pl-chart${dragging ? ' pl-chart-dragging' : ''}`}>
        {canDrag && facts.length > 0 && (
          <p className="pl-chart-hint">Drag a card onto another to make it a sub-fact of that one, or onto a card’s edge to put it beside it.</p>
        )}
        <div className="pl-tree-scroll">
          <ul className="pl-tree" aria-label="Your case chart">
            <li>
              <div className="pl-node-stack">
                <RootNode label={rootLabel} dragging={Boolean(dragging && dragged?.parentId)} />
              </div>
              {facts.length > 0 && <ul>{facts.map(branch)}</ul>}
            </li>
          </ul>
        </div>
        {facts.length === 0 && (
          <p className="pl-chart-empty">
            No facts of consequence yet. Start with the elements of each claim and defense: what has to be proven?
          </p>
        )}
        <div className="pl-chart-actions">
          {onAddFact && (
            <button type="button" className="ws-btn ws-btn-primary" onClick={onAddFact}>
              <Plus aria-hidden="true" />
              Add a fact of consequence
            </button>
          )}
          {onAddGap && (
            <button type="button" className="ws-btn" onClick={onAddGap}>
              <HelpCircle aria-hidden="true" />
              Add a gap about the whole case
            </button>
          )}
        </div>
        {loose.length > 0 && (
          <section className="pl-loose" aria-labelledby="pl-loose-title">
            <h3 id="pl-loose-title">Gaps about the whole case</h3>
            <div className="pl-loose-row">
              {loose.map((g) => (
                <GapNode key={g.id} gap={g} mark={notes?.get(g.id)} onOpen={() => onOpenGap(g)} />
              ))}
            </div>
          </section>
        )}
      </div>
      <DragOverlay dropAnimation={null}>
        {dragged && (
          <div className={`pl-node pl-node-ghost ${dragged.parentId ? 'pl-node-sub' : 'pl-node-fact'}`}>
            <span className="pl-node-title">{cardTitle(dragged)}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

/** The top of the tree: dropping a sub-fact here makes it a fact of consequence. */
function RootNode({ label, dragging }: { label: string; dragging: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'root:', disabled: !dragging })
  return (
    <div ref={setNodeRef} className={`pl-root${dragging ? ' pl-drop-ready' : ''}${isOver ? ' pl-drop-over' : ''}`}>
      {label}
      {dragging && <small>Drop here to make it a fact of consequence</small>}
    </div>
  )
}

function EdgeZone({ id, side }: { id: string; side: 'before' | 'after' }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${side}:${id}` })
  return <div ref={setNodeRef} className={`pl-zone pl-zone-${side}${isOver ? ' pl-zone-over' : ''}`} aria-hidden="true" />
}

function CardNode({
  card,
  gaps,
  mark,
  draggable,
  dragging,
  blocked,
  onOpen,
  onAddSubFact,
}: {
  card: PlannerCard
  gaps: number
  mark?: NoteMark
  draggable: boolean
  /** The card being dragged, if any. */
  dragging: string | null
  /** Whether the dragged card can't go under this one. */
  blocked: boolean
  onOpen(): void
  onAddSubFact?(): void
}) {
  const title = cardTitle(card)
  const drag = useDraggable({ id: `card:${card.id}`, disabled: !draggable })
  const drop = useDroppable({ id: `into:${card.id}`, disabled: !dragging || blocked })
  const counts = [
    card.evidence.length && `${card.evidence.length} evidence`,
    card.witnessIds.length && `${card.witnessIds.length} ${card.witnessIds.length === 1 ? 'witness' : 'witnesses'}`,
    gaps && `${gaps} ${gaps === 1 ? 'gap' : 'gaps'}`,
    mark && `${mark.count} feedback${mark.replied ? ', replied' : ''}`,
  ].filter(Boolean)
  const moving = dragging === card.id
  return (
    <div
      ref={drop.setNodeRef}
      className={`pl-node-wrap${drop.isOver ? ' pl-drop-over' : ''}${moving ? ' pl-node-moving' : ''}${dragging && !blocked && !moving ? ' pl-drop-ready' : ''}`}
    >
      <button
        ref={drag.setNodeRef}
        type="button"
        className={`pl-node ${card.parentId ? 'pl-node-sub' : 'pl-node-fact'}${card.title.trim() ? '' : ' pl-node-untitled'}`}
        onClick={onOpen}
        aria-label={`${title}${counts.length ? `, ${counts.join(', ')}` : ''}`}
        {...drag.listeners}
      >
        <span className="pl-node-kind">
          {card.parentId ? 'Sub-fact' : 'Fact of consequence'}
          {draggable && <GripVertical className="pl-node-grip" aria-hidden="true" />}
        </span>
        <span className="pl-node-title">{title}</span>
        <span className="pl-node-meta" aria-hidden="true">
          <span title="Evidence">
            <FileText />
            {card.evidence.length}
          </span>
          <span title="Witnesses">
            <Users />
            {card.witnessIds.length}
          </span>
          {mark && <NoteBadge mark={mark} />}
        </span>
      </button>
      {dragging && !moving && (
        <>
          <EdgeZone id={card.id} side="before" />
          <EdgeZone id={card.id} side="after" />
        </>
      )}
      {onAddSubFact && !dragging && (
        <button type="button" className="pl-add-sub" aria-label={`Add a sub-fact to ${title}`} title="Add a sub-fact" onClick={onAddSubFact}>
          <Plus aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

/** The latest round's questions on a card or gap, checked once the team has replied. */
function NoteBadge({ mark }: { mark: NoteMark }) {
  return (
    <span className={`pl-node-notes${mark.replied ? ' pl-node-replied' : ''}`} title={mark.replied ? 'Feedback, replied' : 'Feedback'}>
      {mark.replied ? <Check /> : <MessageCircleQuestion />}
      {mark.count}
    </span>
  )
}

function GapNode({ gap, mark, onOpen }: { gap: PlannerGap; mark?: NoteMark; onOpen(): void }) {
  const title = gapTitle(gap)
  const tools = gap.tools.length
  return (
    <button
      type="button"
      className="pl-gap"
      onClick={onOpen}
      aria-label={`Gap: ${title}, ${tools === 0 ? 'no tools yet' : `${tools} ${tools === 1 ? 'tool' : 'tools'}`}${mark ? `, ${mark.count} feedback${mark.replied ? ', replied' : ''}` : ''}`}
    >
      <span className="pl-gap-kind">
        <HelpCircle aria-hidden="true" />
        Gap
      </span>
      <span className="pl-gap-title">{title}</span>
      <span className="pl-gap-meta" aria-hidden="true">
        {tools === 0 ? 'No tools yet' : `${tools} ${tools === 1 ? 'tool' : 'tools'}`}
        {mark && <NoteBadge mark={mark} />}
      </span>
    </button>
  )
}
