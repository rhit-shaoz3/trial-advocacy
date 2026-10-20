import type { ReactNode } from 'react'

/** One number in a dashboard's summary row, with an optional note under it. */
export function StatCard({
  icon,
  tone,
  value,
  label,
  note,
  urgent,
}: {
  icon: ReactNode
  tone: string
  value: ReactNode
  label: string
  note?: string
  urgent?: boolean
}) {
  return (
    <div className="ws-stat">
      <span className={`ws-icon-tile ws-tone-${tone}`} aria-hidden="true">
        {icon}
      </span>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
      {note && <small className={urgent ? 'ws-urgent' : undefined}>{note}</small>}
    </div>
  )
}
