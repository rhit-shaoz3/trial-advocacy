export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function readString(body: unknown, key: string) {
  const value = (body as Record<string, unknown> | undefined)?.[key]
  return typeof value === 'string' ? value : ''
}

/** Returns null if the field is present but isn't an array of strings. */
export function readStringArray(body: unknown, key: string) {
  const value = (body as Record<string, unknown> | undefined)?.[key]
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) return null
  return value as string[]
}

/** Postgres rejects malformed uuids with an error, so check before querying. */
export function isUuid(value: string) {
  return UUID_PATTERN.test(value)
}
