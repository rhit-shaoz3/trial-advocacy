import { useState } from 'react'

/**
 * Whether students can see a file or witness ("Published") or not yet
 * ("Draft"), with the button that flips it.
 */
export function PublishToggle({
  label,
  published,
  onChange,
}: {
  /** What is being published, for the button's accessible name. */
  label: string
  published: boolean
  /** Saves the new state; a rejection's message is shown by the caller. */
  onChange(published: boolean): Promise<void>
}) {
  const [busy, setBusy] = useState(false)

  async function toggle() {
    setBusy(true)
    try {
      await onChange(!published)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="publish-toggle">
      <span className={`badge ${published ? 'badge-case-active' : 'badge-case-draft'}`}>
        {published ? 'Published' : 'Draft'}
      </span>
      <button
        type="button"
        className="link-button"
        onClick={toggle}
        disabled={busy}
        aria-label={`${published ? 'Unpublish' : 'Publish'} ${label}`}
      >
        {published ? 'Unpublish' : 'Publish'}
      </button>
    </span>
  )
}
