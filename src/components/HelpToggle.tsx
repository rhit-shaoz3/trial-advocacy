import { useId, useState, type ReactNode } from 'react'
import { ChevronDown, CircleHelp } from 'lucide-react'
import './HelpToggle.css'

/** A "?" link that opens a short explanation below it: what something is for, and the options. */
export function HelpToggle({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className="help-toggle">
      <button type="button" className="help-toggle-button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <CircleHelp aria-hidden="true" />
        {label}
        <ChevronDown aria-hidden="true" className="help-toggle-chevron" />
      </button>
      {open && (
        <div id={id} className="help-toggle-panel">
          {children}
        </div>
      )}
    </div>
  )
}
