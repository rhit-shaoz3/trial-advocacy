export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'theme'
const systemDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false

/** The theme the user picked, or null if they haven't (then we follow the computer). */
export function savedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
}

/** Switches theme and remembers the choice. */
export function chooseTheme(theme: Theme) {
  applyTheme(theme)
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Storage can be blocked; the theme still applies for this visit.
  }
}

/** Until the user picks a theme, follow the computer's setting as it changes. */
export function followSystemTheme(onChange: (theme: Theme) => void) {
  const query = window.matchMedia?.('(prefers-color-scheme: dark)')
  if (!query) return () => {}
  const listener = () => {
    if (savedTheme()) return
    const theme = systemDark() ? 'dark' : 'light'
    applyTheme(theme)
    onChange(theme)
  }
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}
