/** Calls the Express API in server/. The session lives in an httpOnly cookie. */
export async function request(path: string, init?: RequestInit) {
  let res: Response
  try {
    // File uploads (FormData) need the browser to set their own Content-Type.
    const json = !(init?.body instanceof FormData)
    res = await fetch(`/api${path}`, {
      ...init,
      headers: { ...(json && { 'Content-Type': 'application/json' }), ...init?.headers },
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
