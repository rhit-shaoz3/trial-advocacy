export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Postgres rejects malformed UUIDs with an error, so check route params first. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

/** Reads a string field from a JSON body, or '' if it is missing or not a string. */
export function readString(body: unknown, key: string) {
  const value = (body as Record<string, unknown> | undefined)?.[key]
  return typeof value === 'string' ? value : ''
}
