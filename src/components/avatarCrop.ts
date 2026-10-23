// Positioning a picture in the profile circle. The crop is the zoom and how
// far the picture's centre sits from the circle's centre, in preview pixels;
// the saved picture is the circle's square, drawn at EXPORT_SIZE.

/** The preview circle's width, in CSS pixels. */
export const PREVIEW_SIZE = 200
/** The saved picture's width and height. */
export const EXPORT_SIZE = 512
export const MAX_ZOOM = 3

export interface Crop {
  zoom: number
  x: number
  y: number
}

export const START_CROP: Crop = { zoom: 1, x: 0, y: 0 }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** The picture's size on screen: at zoom 1 its shorter side just fills the circle. */
export function displaySize(width: number, height: number, zoom: number, frame = PREVIEW_SIZE) {
  const scale = (frame / Math.min(width, height)) * zoom
  return { width: width * scale, height: height * scale }
}

/** Keeps the zoom in range and the picture covering the whole circle. */
export function clampCrop(crop: Crop, width: number, height: number, frame = PREVIEW_SIZE): Crop {
  const zoom = clamp(crop.zoom, 1, MAX_ZOOM)
  const size = displaySize(width, height, zoom, frame)
  const maxX = (size.width - frame) / 2
  const maxY = (size.height - frame) / 2
  // `|| 0` turns -0 into 0.
  return { zoom, x: clamp(crop.x, -maxX, maxX) || 0, y: clamp(crop.y, -maxY, maxY) || 0 }
}

/** Zooms around the circle's centre, so the part of the picture there stays put. */
export function zoomTo(crop: Crop, zoom: number, width: number, height: number): Crop {
  const ratio = clamp(zoom, 1, MAX_ZOOM) / crop.zoom
  return clampCrop({ zoom, x: crop.x * ratio, y: crop.y * ratio }, width, height)
}

/** Where to draw the picture on the EXPORT_SIZE canvas so it matches the preview. */
export function exportRect(crop: Crop, width: number, height: number) {
  const ratio = EXPORT_SIZE / PREVIEW_SIZE
  const size = displaySize(width, height, crop.zoom)
  const w = size.width * ratio
  const h = size.height * ratio
  return { x: EXPORT_SIZE / 2 + crop.x * ratio - w / 2, y: EXPORT_SIZE / 2 + crop.y * ratio - h / 2, width: w, height: h }
}

/** Draws the cropped picture as a JPEG (small enough for the 1 MB upload limit). */
export function cropToBlob(image: HTMLImageElement, crop: Crop): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = EXPORT_SIZE
  canvas.height = EXPORT_SIZE
  const context = canvas.getContext('2d')
  if (!context) return Promise.reject(new Error('Your browser could not prepare the picture.'))
  // JPEG has no transparency, so a transparent PNG gets a white background.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, EXPORT_SIZE, EXPORT_SIZE)
  const rect = exportRect(crop, image.naturalWidth, image.naturalHeight)
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height)
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Your browser could not prepare the picture.'))),
      'image/jpeg',
      0.9,
    ),
  )
}
