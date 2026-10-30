/** The element a step points at, if it's on the page and showing (not hidden by a phone's layout). */
export function findTarget(selector: string): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(selector)
  if (!el?.isConnected) return null
  return typeof el.checkVisibility !== 'function' || el.checkVisibility() ? el : null
}

/** The tour button in the page's corner, where a finished tour minimizes to. */
export const launcher = () => findTarget('[data-tour-launcher]')
