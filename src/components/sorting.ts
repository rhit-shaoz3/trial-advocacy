import { useState } from 'react'

/** A table's sort: the column, and 1 for A to Z or oldest first, -1 for Z to A or newest first. */
export interface SortState<K extends string> {
  key: K
  dir: 1 | -1
}

/** Compares words the way people read them: ignoring case, with numbers in order ("File 2" before "File 10"). */
export const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })

/**
 * A sortable table's state. A column's first click sorts it its usual way
 * (`first`: words A to Z, dates newest first); clicking it again reverses it.
 */
export function useSort<K extends string>(initial: K, first: Record<K, 1 | -1>) {
  const [sort, setSort] = useState<SortState<K>>({ key: initial, dir: first[initial] })
  const sortBy = (key: K) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: first[key] }))
  return [sort, sortBy] as const
}
