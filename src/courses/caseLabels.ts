import type { Audience } from './types'

/** How the instructor sees who an item is for. */
export const AUDIENCE_LABEL: Record<Audience, string> = {
  all: 'Everyone',
  plaintiff: 'Plaintiff only',
  defense: 'Defense only',
}

/** The broad kinds of file in a case file, in the order they're listed. */
export const FILE_CATEGORIES = ['document', 'image', 'audio', 'video'] as const
export type FileCategory = (typeof FILE_CATEGORIES)[number]

export const CATEGORY_LABEL: Record<FileCategory, string> = {
  document: 'Document',
  image: 'Image',
  audio: 'Audio',
  video: 'Video',
}

/** Plural headings for a case file grouped by category. */
export const CATEGORY_HEADING: Record<FileCategory, string> = {
  document: 'Documents',
  image: 'Images',
  audio: 'Audio',
  video: 'Video',
}

/** Which category a stored file's content type falls in. */
export function fileCategory(contentType: string): FileCategory {
  if (contentType.startsWith('image/')) return 'image'
  if (contentType.startsWith('audio/')) return 'audio'
  if (contentType.startsWith('video/')) return 'video'
  return 'document'
}

/** The specific format: "PDF", "Word document", "Text", "Image", "Audio", "Video". */
export function fileTypeLabel(contentType: string) {
  if (contentType === 'application/pdf') return 'PDF'
  if (contentType.startsWith('text/')) return 'Text'
  const category = fileCategory(contentType)
  return category === 'document' ? 'Word document' : CATEGORY_LABEL[category]
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** "Mar 4" (adds the year when it isn't this year). */
export function shortDate(iso: string, now = new Date()) {
  const date = new Date(iso)
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  })
}

/** "Mar 12 · 11:59 PM" */
export function dueLabel(iso: string, now = new Date()) {
  const time = new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `${shortDate(iso, now)} · ${time}`
}

/** A `datetime-local` input's value for an ISO timestamp, in local time. */
export function toLocalInput(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Back from a `datetime-local` value (local time) to ISO, or null when empty. */
export function fromLocalInput(value: string) {
  return value ? new Date(value).toISOString() : null
}
