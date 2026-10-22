import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { clampCrop, cropToBlob, displaySize, MAX_ZOOM, PREVIEW_SIZE, START_CROP, zoomTo, type Crop } from './avatarCrop'
import './AvatarCropper.css'

const NUDGE = 8

interface Props {
  /** The picture the user chose. */
  file: Blob
  /** Called with the cropped picture; the cropper shows "Saving…" until it settles. */
  onCrop(picture: Blob): Promise<void>
  onCancel(): void
}

/** Drag (or use the arrow keys) and zoom to position a picture in a circle. */
export function AvatarCropper({ file, onCrop, onCancel }: Props) {
  const [src, setSrc] = useState<string | null>(null)
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const [crop, setCrop] = useState<Crop>(START_CROP)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const drag = useRef<{ pointerX: number; pointerY: number; crop: Crop } | null>(null)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    setSrc(url)
    setNatural(null)
    setCrop(START_CROP)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const move = (next: Crop) => natural && setCrop(clampCrop(next, natural.width, natural.height))

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drag.current = { pointerX: event.clientX, pointerY: event.clientY, crop }
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current
    if (!start) return
    move({ ...start.crop, x: start.crop.x + event.clientX - start.pointerX, y: start.crop.y + event.clientY - start.pointerY })
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [-NUDGE, 0],
      ArrowRight: [NUDGE, 0],
      ArrowUp: [0, -NUDGE],
      ArrowDown: [0, NUDGE],
    }
    const step = steps[event.key]
    if (!step) return
    event.preventDefault()
    move({ ...crop, x: crop.x + step[0], y: crop.y + step[1] })
  }

  async function handleSave() {
    if (!imageRef.current) return
    setSaving(true)
    setError(null)
    try {
      await onCrop(await cropToBlob(imageRef.current, crop))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the picture.')
      setSaving(false)
    }
  }

  const size = natural ? displaySize(natural.width, natural.height, crop.zoom) : null

  return (
    <div className="cropper">
      <div
        className="cropper-frame"
        style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE }}
        tabIndex={0}
        role="group"
        aria-label="Picture position. Drag it, or use the arrow keys, to move it in the circle."
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={handleKeyDown}
      >
        {src && (
          <img
            ref={imageRef}
            src={src}
            alt="Your new picture"
            draggable={false}
            onLoad={(e) => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
            onError={() => setError('That file isn’t a picture this browser can open. Try a JPEG or PNG.')}
            style={
              size
                ? {
                    width: size.width,
                    height: size.height,
                    transform: `translate(calc(-50% + ${crop.x}px), calc(-50% + ${crop.y}px))`,
                  }
                : { opacity: 0 }
            }
          />
        )}
      </div>

      <label className="cropper-zoom">
        Zoom
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={crop.zoom}
          disabled={!natural}
          onChange={(e) => natural && setCrop(zoomTo(crop, Number(e.target.value), natural.width, natural.height))}
        />
      </label>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="cropper-actions">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={handleSave} disabled={!natural || saving}>
          {saving ? 'Saving…' : 'Use this picture'}
        </button>
      </div>
    </div>
  )
}
