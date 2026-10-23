import { ImagePlus, UserRound } from 'lucide-react'
import { useEffect, useId, useState, type ChangeEvent } from 'react'
import { AvatarCropper } from '../../../components/AvatarCropper'
import { WITNESS_AVATAR_PRESETS, witnessAvatarPresetUrl } from '../../../courses/types'
import type { PictureChoice } from './witnessPicture'
import './WitnessPicturePicker.css'

/** Big enough for any phone photo; what's uploaded is the far smaller crop. */
const MAX_PICTURE_BYTES = 20 * 1024 * 1024
const PRESETS = Array.from({ length: WITNESS_AVATAR_PRESETS }, (_, i) => i + 1)

/** Twelve picture designs to choose from, or upload a picture and position it in the circle. */
export function WitnessPicturePicker({
  value,
  uploadedUrl,
  onChange,
}: {
  value: PictureChoice
  /** The witness's current uploaded picture, if it has one. */
  uploadedUrl?: string | null
  onChange(choice: PictureChoice): void
}) {
  const name = useId()
  const [cropping, setCropping] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newUrl, setNewUrl] = useState<string | null>(null)
  const newImage = value.kind === 'new' ? value.image : null

  useEffect(() => {
    if (!newImage) return setNewUrl(null)
    const url = URL.createObjectURL(newImage)
    setNewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [newImage])

  function handleChoose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) return setError('Choose a picture (a JPEG or PNG, for example).')
    if (file.size > MAX_PICTURE_BYTES) return setError('That picture is too large. Choose one under 20 MB.')
    setError(null)
    setCropping(file)
  }

  const uploadPreview = newUrl ?? (value.kind !== 'new' ? uploadedUrl : null)

  return (
    <fieldset className="content-form-full content-fieldset witness-picture">
      <legend>Picture</legend>
      <p className="muted section-hint">Shown beside the witness&rsquo;s name and at the top of interviews.</p>
      {cropping ? (
        <AvatarCropper
          file={cropping}
          onCancel={() => setCropping(null)}
          onCrop={async (image) => {
            onChange({ kind: 'new', image })
            setCropping(null)
          }}
        />
      ) : (
        <div className="witness-picture-grid" role="radiogroup" aria-label="Witness picture">
          <label className="witness-picture-option">
            <input
              type="radio"
              name={name}
              aria-label="No picture"
              checked={value.kind === 'none'}
              onChange={() => onChange({ kind: 'none' })}
            />
            <span className="witness-picture-tile witness-picture-none">
              <UserRound aria-hidden="true" />
            </span>
          </label>
          {PRESETS.map((preset) => (
            <label key={preset} className="witness-picture-option">
              <input
                type="radio"
                name={name}
                aria-label={`Picture ${preset}`}
                checked={value.kind === 'preset' && value.preset === preset}
                onChange={() => onChange({ kind: 'preset', preset })}
              />
              <span className="witness-picture-tile">
                <img src={witnessAvatarPresetUrl(preset)} alt="" />
              </span>
            </label>
          ))}
          {uploadPreview && (
            <label className="witness-picture-option">
              <input
                type="radio"
                name={name}
                aria-label="Uploaded picture"
                checked={value.kind === 'uploaded' || value.kind === 'new'}
                onChange={() => onChange(newImage ? { kind: 'new', image: newImage } : { kind: 'uploaded' })}
              />
              <span className="witness-picture-tile">
                <img src={uploadPreview} alt="" />
              </span>
            </label>
          )}
          <label className="witness-picture-upload" title="Upload a picture">
            <input type="file" accept="image/*" className="visually-hidden" aria-label="Upload a picture" onChange={handleChoose} />
            <ImagePlus aria-hidden="true" />
            <span>Upload</span>
          </label>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  )
}
