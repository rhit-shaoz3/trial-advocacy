import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { ReactNode } from 'react'

/** A box that things can be dropped into; highlighted while something is dragged over it. */
export function DropZone({
  id,
  className,
  children,
}: {
  id: string
  className?: string
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div ref={setNodeRef} className={`${className ?? ''}${isOver ? 'drop-over' : ''}`}>
      {children}
    </div>
  )
}

/** Something that can be dragged by its grip handle. */
export function Draggable({
  id,
  label,
  className,
  children,
}: {
  id: string
  label: string
  className?: string
  children: ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id })
  return (
    <div
      ref={setNodeRef}
      className={`${className ?? ''}${isDragging ? 'dragging' : ''}`}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
    >
      <button type="button" className="drag-handle" aria-label={label} {...attributes} {...listeners}>
        ⠿
      </button>
      {children}
    </div>
  )
}
