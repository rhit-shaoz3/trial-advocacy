import { useEffect, useId, useRef, useState } from 'react'

/** How long after the last keystroke a field saves (as drafts do). */
export const AUTOSAVE_MS = 800

/**
 * A text box that saves itself a moment after the student stops typing, and
 * when they leave it. While they're editing, a teammate's change to the same
 * field doesn't overwrite what they're typing; once it's saved, the field
 * shows what's stored again.
 */
export function AutoField({
  label,
  value,
  onSave,
  multiline = false,
  rows = 3,
  maxLength,
  placeholder,
  hint,
  readOnly = false,
  autoFocus = false,
  className,
}: {
  label: string
  value: string
  onSave(value: string): Promise<void>
  multiline?: boolean
  rows?: number
  maxLength: number
  placeholder?: string
  hint?: string
  readOnly?: boolean
  autoFocus?: boolean
  className?: string
}) {
  const id = useId()
  const [draft, setDraft] = useState(value)
  /** True from the first keystroke until what was typed is saved. */
  const editing = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const latest = useRef({ draft, value, onSave })
  latest.current = { draft, value, onSave }

  useEffect(() => {
    if (!editing.current) setDraft(value)
  }, [value])

  const save = async () => {
    clearTimeout(timer.current)
    const { draft: text, value: stored, onSave: send } = latest.current
    if (text === stored) {
      editing.current = false
      return
    }
    try {
      await send(text)
    } finally {
      // Typing again while it saved keeps the field the student's.
      if (latest.current.draft === text) editing.current = false
    }
  }

  // Leaving the card or the page keeps what was typed.
  useEffect(
    () => () => {
      if (editing.current) void save()
    },
    [],
  )

  const change = (text: string) => {
    editing.current = true
    setDraft(text)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void save(), AUTOSAVE_MS)
  }

  if (readOnly) {
    return (
      <div className={`pl-field ${className ?? ''}`}>
        <span className="pl-field-label">{label}</span>
        <p className={value ? 'pl-field-text' : 'pl-field-text pl-field-empty'}>{value || 'Nothing yet.'}</p>
      </div>
    )
  }
  return (
    <div className={`pl-field ${className ?? ''}`}>
      <label className="pl-field-label" htmlFor={id}>
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          value={draft}
          rows={rows}
          maxLength={maxLength}
          placeholder={placeholder}
          autoFocus={autoFocus}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(e) => change(e.target.value)}
          onBlur={() => void save()}
        />
      ) : (
        <input
          id={id}
          type="text"
          value={draft}
          maxLength={maxLength}
          placeholder={placeholder}
          autoFocus={autoFocus}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(e) => change(e.target.value)}
          onBlur={() => void save()}
        />
      )}
      {hint && (
        <small id={`${id}-hint`} className="pl-field-hint">
          {hint}
        </small>
      )}
    </div>
  )
}
