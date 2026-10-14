import { SIDE_LABELS } from './format'
import type { DocSide } from './types'

export function SideSelect({
  value,
  onChange,
  label,
  className = 'case-select-sm',
}: {
  value: DocSide
  onChange(side: DocSide): void
  label: string
  className?: string
}) {
  return (
    <select
      className={className}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as DocSide)}
    >
      {(Object.keys(SIDE_LABELS) as DocSide[]).map((side) => (
        <option key={side} value={side}>
          {SIDE_LABELS[side]}
        </option>
      ))}
    </select>
  )
}
