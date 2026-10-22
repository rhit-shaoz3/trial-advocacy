import { describe, expect, it } from 'vitest'
import { clampCrop, displaySize, EXPORT_SIZE, exportRect, MAX_ZOOM, PREVIEW_SIZE, zoomTo } from './avatarCrop'

describe('positioning a picture in the circle', () => {
  it('fits the shorter side to the circle at zoom 1', () => {
    expect(displaySize(1000, 500, 1)).toEqual({ width: 400, height: 200 })
    expect(displaySize(500, 1000, 2)).toEqual({ width: 400, height: 800 })
  })

  it('stops the picture from uncovering any of the circle', () => {
    // 400×200 on screen: it can slide 100px either way sideways, not at all up or down.
    expect(clampCrop({ zoom: 1, x: 150, y: 30 }, 1000, 500)).toEqual({ zoom: 1, x: 100, y: 0 })
    expect(clampCrop({ zoom: 1, x: -150, y: -30 }, 1000, 500)).toEqual({ zoom: 1, x: -100, y: 0 })
  })

  it('keeps the zoom between 1 and the maximum', () => {
    expect(clampCrop({ zoom: 0.5, x: 0, y: 0 }, 300, 300).zoom).toBe(1)
    expect(clampCrop({ zoom: 9, x: 0, y: 0 }, 300, 300).zoom).toBe(MAX_ZOOM)
  })

  it('zooms around the centre of the circle', () => {
    expect(zoomTo({ zoom: 1, x: 50, y: 0 }, 2, 1000, 500)).toEqual({ zoom: 2, x: 100, y: 0 })
    // Zooming back out pulls the picture in so it still covers the circle.
    expect(zoomTo({ zoom: 2, x: 300, y: 100 }, 1, 1000, 500)).toEqual({ zoom: 1, x: 100, y: 0 })
  })

  it('draws the saved picture to match the preview', () => {
    const scale = EXPORT_SIZE / PREVIEW_SIZE
    // Centred, square: the picture exactly fills the canvas.
    expect(exportRect({ zoom: 1, x: 0, y: 0 }, 300, 300)).toEqual({ x: 0, y: 0, width: EXPORT_SIZE, height: EXPORT_SIZE })
    // Slid fully right: the picture's left edge lines up with the canvas's.
    const rect = exportRect({ zoom: 1, x: 100, y: 0 }, 1000, 500)
    expect(rect.x).toBeCloseTo(0)
    expect(rect.width).toBeCloseTo(400 * scale)
  })
})
