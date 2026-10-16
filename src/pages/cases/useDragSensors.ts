import { KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'

/** Mouse/touch drag starts after a small movement (so clicks still work); keyboard uses Space. */
export function useDragSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  )
}
