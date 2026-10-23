import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { ReactNode } from 'react'

const classes = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ') || undefined

/** A box that things can be dropped into; highlighted while something is dragged over it. */
export function DropZone({
  id,
  as: Tag = 'div',
  className,
  label,
  children,
}: {
  id: string
  as?: 'div' | 'li'
  className?: string
  /** Accessible name for the box. */
  label?: string
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <Tag ref={setNodeRef} className={classes(className, isOver && 'drop-over')} aria-label={label}>
      {children}
    </Tag>
  )
}

/**
 * Something that can be dragged by its grip handle, with a mouse or touch.
 * The handle is hidden from the keyboard and screen readers, so pages using
 * it keep a button or menu that does the same move.
 */
export function Draggable({
  id,
  label,
  className,
  disabled,
  children,
}: {
  id: string
  /** Tooltip on the handle. */
  label: string
  className?: string
  disabled?: boolean
  children: ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, disabled })
  return (
    <div
      ref={setNodeRef}
      className={classes(className, isDragging && 'dragging')}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
    >
      <span
        className="drag-handle"
        title={label}
        {...attributes}
        {...listeners}
        role={undefined}
        tabIndex={-1}
        aria-hidden="true"
        aria-disabled={undefined}
        aria-roledescription={undefined}
        aria-describedby={undefined}
      >
        ⠿
      </span>
      {children}
    </div>
  )
}
