import { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { Side } from '../../courses/types'
import { SIDE_FACT_LABEL, toRows, type FactRow } from './factRows'

/**
 * One side's "most important facts": a list of one-line inputs with a remove
 * button on each and an "Add fact" button. Always keeps at least one row.
 */
export function ImportantFactsField({
  side,
  rows,
  onChange,
}: {
  side: Side
  rows: FactRow[]
  onChange(rows: FactRow[]): void
}) {
  const label = SIDE_FACT_LABEL[side]
  const list = useRef<HTMLOListElement>(null)
  const [focusLast, setFocusLast] = useState(false)

  useEffect(() => {
    if (!focusLast) return
    list.current?.querySelector<HTMLInputElement>('li:last-child input')?.focus()
    setFocusLast(false)
  }, [focusLast])

  const update = (key: number, text: string) => onChange(rows.map((r) => (r.key === key ? { ...r, text } : r)))

  return (
    <fieldset className="case-facts-side">
      <legend>{side === 'plaintiff' ? "Plaintiff's" : "Defense's"} most important facts</legend>
      <ol ref={list} className="case-facts-list">
        {rows.map((row, i) => (
          <li key={row.key}>
            <input
              type="text"
              value={row.text}
              onChange={(e) => update(row.key, e.target.value)}
              aria-label={`${side === 'plaintiff' ? 'Plaintiff' : 'Defense'} fact ${i + 1}`}
              maxLength={500}
            />
            <button
              type="button"
              className="icon-button"
              onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
              disabled={rows.length === 1}
              aria-label={`Remove ${label} fact ${i + 1}`}
              title="Remove fact"
            >
              <X aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="link-button case-facts-add"
        onClick={() => {
          onChange([...rows, ...toRows([''])])
          setFocusLast(true)
        }}
        disabled={rows.length >= 20}
      >
        <Plus aria-hidden="true" /> Add {label} fact
      </button>
    </fieldset>
  )
}
