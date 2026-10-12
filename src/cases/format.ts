import type { CharacterRole, DocSide } from './types'

export const SIDE_LABELS: Record<DocSide, string> = {
  plaintiff: 'Plaintiff',
  defendant: 'Defendant',
  both: 'Both sides',
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const ROLE_LABELS: Record<CharacterRole, string> = {
  witness: 'Witness',
  investigator: 'Investigator',
}

/** Badge text for a character, e.g. "Plaintiff witness" or "Investigator". */
export function characterBadge(role: CharacterRole, side: DocSide) {
  if (side === 'both') return ROLE_LABELS[role]
  return `${side === 'plaintiff' ? 'Plaintiff' : 'Defense'} ${role}`
}
