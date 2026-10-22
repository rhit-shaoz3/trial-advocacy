import type { Witness } from '../../../courses/types'

/** What the instructor picked: nothing, a design, the picture already uploaded, or a new (cropped) one. */
export type PictureChoice =
  | { kind: 'none' }
  | { kind: 'preset'; preset: number }
  | { kind: 'uploaded' }
  | { kind: 'new'; image: Blob }

export function initialPicture(witness: Pick<Witness, 'avatarPreset' | 'avatarUrl'>): PictureChoice {
  if (witness.avatarPreset) return { kind: 'preset', preset: witness.avatarPreset }
  if (witness.avatarUrl) return { kind: 'uploaded' }
  return { kind: 'none' }
}
