import { Lock } from 'lucide-react'
import { worldLabel } from '../../courses/worldLabel'

/** A locked case world's badge: "Locked", or "Locked · World A" on one of its teams. */
export function LockedBadge({ world }: { world?: number }) {
  return (
    <span className="badge badge-locked">
      <Lock aria-hidden="true" />
      {world === undefined ? 'Locked' : `Locked · World ${worldLabel(world)}`}
    </span>
  )
}
