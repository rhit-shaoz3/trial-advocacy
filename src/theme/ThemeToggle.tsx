import { Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { chooseMode, currentMode, followSystemMode } from './theme'
import './ThemeToggle.css'

/** Sun/moon button that switches between light and dark mode for this visit. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const [mode, setMode] = useState(currentMode)

  useEffect(() => followSystemMode(setMode), [])

  const next = mode === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      className={`theme-toggle ${className}`.trim()}
      onClick={() => {
        chooseMode(next)
        setMode(next)
      }}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      {mode === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
      <span>{mode === 'dark' ? 'Light mode' : 'Dark mode'}</span>
    </button>
  )
}
