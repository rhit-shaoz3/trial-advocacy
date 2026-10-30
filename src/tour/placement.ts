import type { TourPlacement } from './tourTypes'

export interface Box {
  top: number
  left: number
  width: number
  height: number
}

export interface CardPosition {
  top: number
  left: number
  /** The side of the target the card sits on; center has no arrow. */
  side: 'top' | 'bottom' | 'left' | 'right' | 'center'
  /** Where the arrow sits along the card's edge, in px from its start. */
  arrow: number
}

/** Space kept between the card and the screen's edge, and between the card and the target. */
export const EDGE = 12
export const GAP = 14
const ARROW_INSET = 18

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), Math.max(min, max))

/**
 * Where a step's card goes: beside the target on the preferred side, or the
 * first side with room (below, above, right, left), or the middle of the
 * screen with no target. Everything is in viewport pixels.
 */
export function placeCard(
  target: Box | null,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  preferred: TourPlacement = 'auto',
): CardPosition {
  const { width: w, height: h } = card
  const { width: vw, height: vh } = viewport
  if (!target) {
    return { top: clamp((vh - h) / 2, EDGE, vh - h - EDGE), left: clamp((vw - w) / 2, EDGE, vw - w - EDGE), side: 'center', arrow: 0 }
  }
  const t = target
  const fits = {
    bottom: t.top + t.height + GAP + h <= vh - EDGE,
    top: t.top - GAP - h >= EDGE,
    right: t.left + t.width + GAP + w <= vw - EDGE,
    left: t.left - GAP - w >= EDGE,
  }
  const order: (keyof typeof fits)[] = ['bottom', 'top', 'right', 'left']
  const side = preferred !== 'auto' && fits[preferred] ? preferred : (order.find((s) => fits[s]) ?? 'bottom')

  if (side === 'top' || side === 'bottom') {
    const left = clamp(t.left + t.width / 2 - w / 2, EDGE, vw - w - EDGE)
    // No room anywhere (a tall target on a phone): keep the card on screen, over the target.
    const top = side === 'bottom' ? Math.min(t.top + t.height + GAP, vh - h - EDGE) : t.top - GAP - h
    return { top: Math.max(EDGE, top), left, side, arrow: clamp(t.left + t.width / 2 - left, ARROW_INSET, w - ARROW_INSET) }
  }
  const top = clamp(t.top + t.height / 2 - h / 2, EDGE, vh - h - EDGE)
  const left = side === 'right' ? t.left + t.width + GAP : t.left - GAP - w
  return { top, left, side, arrow: clamp(t.top + t.height / 2 - top, ARROW_INSET, h - ARROW_INSET) }
}

/** The spotlight around a target: a little padding, and never bigger than the screen. */
export function spotlightBox(target: Box, viewport: { width: number; height: number }, pad = 6): Box {
  const top = Math.max(target.top - pad, 4)
  const left = Math.max(target.left - pad, 4)
  const bottom = Math.min(target.top + target.height + pad, viewport.height - 4)
  const right = Math.min(target.left + target.width + pad, viewport.width - 4)
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}
