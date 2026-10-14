import { Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { chooseTheme, currentTheme, followSystemTheme } from './theme'
import './ThemeToggle.css'

/** Sun/moon button that switches between light and dark mode. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState(currentTheme)

  useEffect(() => followSystemTheme(setTheme), [])

  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      className={`theme-toggle ${className}`}
      onClick={() => {
        chooseTheme(next)
        setTheme(next)
      }}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      {theme === 'dark' ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
      <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
    </button>
  )
}
