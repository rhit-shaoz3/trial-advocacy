import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { errorMessage } from '../dashboard/errorMessage'

interface Props {
  label: string
  published: boolean
  onChange(published: boolean): Promise<void>
}

/** "Published"/"Draft" status plus the button that flips it. */
export function PublishControl({ label, published, onChange }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    setBusy(true)
    setError(null)
    try {
      await onChange(!published)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="publish-control">
      <span className={published ? 'badge' : 'badge badge-muted'}>
        {published ? 'Published' : 'Draft · only you can see this'}
      </span>
      <button
        type="button"
        className={published ? 'btn btn-small' : 'btn btn-small btn-primary'}
        onClick={toggle}
        disabled={busy}
        aria-label={`${published ? 'Unpublish' : 'Publish'} ${label}`}
      >
        {published ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
        {published ? 'Unpublish' : 'Publish to students'}
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
