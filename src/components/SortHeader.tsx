import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import type { SortState } from './sorting'
import './SortHeader.css'

/** A column heading that sorts by its column, with an arrow for which way. */
export function SortHeader<K extends string>({
  column,
  label,
  sort,
  onSort,
  className,
}: {
  column: K
  label: string
  sort: SortState<K>
  onSort(key: K): void
  className?: string
}) {
  const on = sort.key === column
  return (
    <th scope="col" className={className} aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      <button type="button" className="th-sort" onClick={() => onSort(column)}>
        {label}
        {on ? (
          sort.dir === 1 ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />
        ) : (
          <ArrowUpDown aria-hidden="true" className="th-sort-idle" />
        )}
      </button>
    </th>
  )
}
