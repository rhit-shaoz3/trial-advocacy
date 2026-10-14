/**
 * Calls the Express API in server/ and returns the parsed JSON body (or null
 * for 204). Throws an Error carrying the server's `{ error }` message.
 */
export async function apiRequest(path: string, init?: RequestInit) {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.')
  }

  if (res.status === 204) return null
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(body?.error ?? `Request failed (${res.status}).`)
  }
  return body
}
