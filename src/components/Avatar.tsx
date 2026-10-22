import { avatarTone, initials } from '../workspace/format'

/** A person's profile picture in a circle, or their initials until they add one. */
export function Avatar({ name, src, size }: { name: string; src?: string | null; size?: 'sm' | 'lg' }) {
  return (
    <span
      className={`ws-avatar ws-avatar-${avatarTone(name)}${size ? ` ws-avatar-${size}` : ''}${src ? ' ws-avatar-photo' : ''}`}
      title={name}
      aria-hidden="true"
    >
      {src ? <img src={src} alt="" /> : initials(name)}
    </span>
  )
}
