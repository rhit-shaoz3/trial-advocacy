// Light or dark, and the colour theme. index.html sets both on <html> before
// the page draws, so it never flashes the wrong one; keep it in sync with this.
//
// Light or dark follows the computer's setting each time the app is opened;
// the sidebar toggle switches it for the rest of the visit (sessionStorage),
// and the next visit starts from the computer's setting again. The colour
// theme is the user's choice on the account page, kept on their account and,
// so it applies before they're loaded, in localStorage.

export type Mode = 'light' | 'dark'

export const PALETTES = ['navy', 'slate', 'earth', 'vibrant', 'forest', 'lagoon', 'contrast', 'radioactive'] as const
export type Palette = (typeof PALETTES)[number]

const MODE_KEY = 'theme'
const PALETTE_KEY = 'palette'

const systemMode = (): Mode => (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')

/** The mode picked earlier in this visit, or null (then the computer's setting decides). */
export function visitMode(): Mode | null {
  try {
    const value = sessionStorage.getItem(MODE_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

export function currentMode(): Mode {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

/** Switches light/dark for the rest of this visit. */
export function chooseMode(mode: Mode) {
  document.documentElement.dataset.theme = mode
  try {
    sessionStorage.setItem(MODE_KEY, mode)
  } catch {
    // Storage can be blocked; the mode still applies until the page reloads.
  }
}

/** Until the user toggles, follow the computer's setting as it changes. Returns a cleanup. */
export function followSystemMode(onChange: (mode: Mode) => void) {
  const query = window.matchMedia?.('(prefers-color-scheme: dark)')
  if (!query) return () => {}
  const listener = () => {
    if (visitMode()) return
    const mode = systemMode()
    document.documentElement.dataset.theme = mode
    onChange(mode)
  }
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

export const isPalette = (value: unknown): value is Palette => PALETTES.includes(value as Palette)

export function currentPalette(): Palette {
  const value = document.documentElement.dataset.palette
  return isPalette(value) ? value : 'navy'
}

/** Shows a colour theme now, and remembers it on this device for the next page load. */
export function applyPalette(palette: Palette) {
  document.documentElement.dataset.palette = palette
  try {
    localStorage.setItem(PALETTE_KEY, palette)
  } catch {
    // Without storage it still applies once the user's account loads.
  }
}
