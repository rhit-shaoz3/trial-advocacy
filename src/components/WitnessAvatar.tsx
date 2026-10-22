import { UserRound } from 'lucide-react'
import './WitnessAvatar.css'

/** A witness's picture (a design or an upload) in a circle, or a person icon without one. */
export function WitnessAvatar({ src, size = 'md' }: { src?: string | null; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  return (
    <span className={`witness-avatar witness-avatar-${size}`} aria-hidden="true">
      {src ? <img src={src} alt="" /> : <UserRound />}
    </span>
  )
}
