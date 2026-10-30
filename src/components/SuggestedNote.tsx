import { Sparkles } from 'lucide-react'

/** Says a field's text is the AI's suggestion from the case file, not something the instructor wrote. */
export function SuggestedNote() {
  return (
    <span className="muted field-hint suggested-note">
      <Sparkles aria-hidden="true" />
      Suggested from the case file. Keep it, edit it, or clear it, then save.
    </span>
  )
}
