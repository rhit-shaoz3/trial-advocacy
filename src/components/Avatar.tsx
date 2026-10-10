import { avatarTone, initials } from '../workspace/format'

export function Avatar({ name, size }: { name: string; size?: 'sm' }) {
  return (
    <span
      className={`ws-avatar ws-avatar-${avatarTone(name)}${size ? ` ws-avatar-${size}` : ''}`}
      title={name}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  )
}
