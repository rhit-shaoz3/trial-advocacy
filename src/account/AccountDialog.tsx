import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { ImagePlus, Trash2, X } from 'lucide-react'
import { useAuth } from '../auth/useAuth'
import { Avatar } from '../components/Avatar'
import { AvatarCropper } from '../components/AvatarCropper'
import { PALETTE_INFO } from '../theme/palettes'
import { applyPalette, PALETTES, type Palette } from '../theme/theme'
import './AccountDialog.css'

/** Big enough for any phone photo; the cropped picture that's uploaded is far smaller. */
const MAX_PICTURE_BYTES = 20 * 1024 * 1024
const MAX_NAME_LENGTH = 100

const messageOf = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback)

/** Your name, profile picture and colour theme. Opened from your name in the sidebar. */
export function AccountDialog({ onClose }: { onClose(): void }) {
  const { user } = useAuth()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  if (!user) return null

  return (
    <dialog
      ref={dialogRef}
      className="account-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      // A click on the backdrop lands on the dialog itself.
      onClick={(e) => e.target === e.currentTarget && dialogRef.current?.close()}
    >
      <div className="account-panel">
        <header className="account-head">
          <h2 id={titleId}>Your account</h2>
          <button type="button" className="account-close" aria-label="Close" onClick={() => dialogRef.current?.close()}>
            <X aria-hidden="true" />
          </button>
        </header>
        <PictureSection />
        <NameSection />
        <ThemeSection />
      </div>
    </dialog>
  )
}

function PictureSection() {
  const { user, uploadAvatar, removeAvatar } = useAuth()
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const inputId = useId()
  if (!user) return null

  function handleChoose(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0]
    event.target.value = '' // so choosing the same file again still opens the cropper
    if (!chosen) return
    if (!chosen.type.startsWith('image/')) return setError('Choose a picture (a JPEG or PNG, for example).')
    if (chosen.size > MAX_PICTURE_BYTES) return setError('That picture is too large. Choose one under 20 MB.')
    setError(null)
    setFile(chosen)
  }

  async function handleRemove() {
    setRemoving(true)
    setError(null)
    try {
      await removeAvatar()
    } catch (err) {
      setError(messageOf(err, 'Could not remove the picture.'))
    } finally {
      setRemoving(false)
    }
  }

  return (
    <section className="account-section" aria-labelledby={`${inputId}-title`}>
      <h3 id={`${inputId}-title`}>Profile picture</h3>
      {file ? (
        <AvatarCropper
          file={file}
          onCancel={() => setFile(null)}
          onCrop={async (picture) => {
            await uploadAvatar(picture)
            setFile(null)
          }}
        />
      ) : (
        <div className="account-picture">
          <Avatar name={user.name} src={user.avatarUrl} size="lg" />
          <div className="account-picture-actions">
            <p className="account-hint">Shown beside your name in your courses, on your team and in interviews.</p>
            <div>
              <label htmlFor={inputId} className="btn-secondary account-file-label">
                <ImagePlus aria-hidden="true" />
                {user.avatarUrl ? 'Change picture' : 'Upload a picture'}
              </label>
              <input id={inputId} type="file" accept="image/*" className="account-file" onChange={handleChoose} />
              {user.avatarUrl && (
                <button type="button" className="btn-danger" onClick={handleRemove} disabled={removing}>
                  <Trash2 aria-hidden="true" />
                  {removing ? 'Removing…' : 'Remove'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

function NameSection() {
  const { user, updateProfile } = useAuth()
  const [name, setName] = useState(user?.name ?? '')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)
  const inputId = useId()
  if (!user) return null

  const trimmed = name.trim()
  const changed = trimmed !== user.name

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!trimmed || !changed) return
    setStatus('saving')
    setError(null)
    try {
      await updateProfile({ name: trimmed })
      setName(trimmed)
      setStatus('saved')
    } catch (err) {
      setError(messageOf(err, 'Could not save your name.'))
      setStatus('idle')
    }
  }

  return (
    <section className="account-section">
      <h3>
        <label htmlFor={inputId}>Name</label>
      </h3>
      <form className="account-name" onSubmit={handleSubmit}>
        <input
          id={inputId}
          value={name}
          maxLength={MAX_NAME_LENGTH}
          autoComplete="name"
          onChange={(e) => {
            setName(e.target.value)
            setStatus('idle')
          }}
        />
        <button type="submit" className="btn-primary" disabled={!trimmed || !changed || status === 'saving'}>
          {status === 'saving' ? 'Saving…' : 'Save'}
        </button>
      </form>
      <p className="account-hint" role="status">
        {status === 'saved' ? 'Saved.' : `Signed in as ${user.email}.`}
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

function ThemeSection() {
  const { user, updateProfile } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const titleId = useId()
  if (!user) return null

  async function choose(theme: Palette) {
    const previous = user!.theme
    // Show it straight away; the saved account theme follows.
    applyPalette(theme)
    setError(null)
    try {
      await updateProfile({ theme })
    } catch (err) {
      applyPalette(previous)
      setError(messageOf(err, 'Could not save the theme.'))
    }
  }

  return (
    <section className="account-section">
      <h3 id={titleId}>Theme</h3>
      <p className="account-hint">Each theme has a light and a dark side. Light or dark follows your computer, or the switch in the sidebar.</p>
      <div className="account-themes" role="radiogroup" aria-labelledby={titleId}>
        {PALETTES.map((palette) => {
          const info = PALETTE_INFO[palette]
          return (
            <label key={palette} className="account-theme">
              <input
                type="radio"
                name="theme"
                value={palette}
                checked={user.theme === palette}
                onChange={() => choose(palette)}
              />
              <span className="account-swatch" aria-hidden="true">
                {[info.light, info.dark].map((p, i) => (
                  <span key={i} className="account-swatch-half" style={{ background: p.page }}>
                    <span className="account-swatch-side" style={{ background: p.sidebar }} />
                    <span className="account-swatch-card" style={{ background: p.card }}>
                      <span style={{ background: p.button }} />
                    </span>
                  </span>
                ))}
              </span>
              <span className="account-theme-text">
                <strong>
                  {info.label}
                  <span className="account-accents" aria-hidden="true">
                    {info.accents.map((color) => (
                      <span key={color} style={{ background: color }} />
                    ))}
                  </span>
                </strong>
                <small>{info.description}</small>
              </span>
            </label>
          )
        })}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
