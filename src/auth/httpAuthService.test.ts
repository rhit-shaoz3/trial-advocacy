import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpAuthService } from './httpAuthService'

const ada = {
  id: 'user-1',
  name: 'Ada Lawyer',
  email: 'ada@example.com',
  role: 'student',
  createdAt: '2026-01-01T00:00:00.000Z',
}

function mockFetch(status: number, body?: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('httpAuthService', () => {
  it('posts sign-up details as JSON and returns the user', async () => {
    const fetchMock = mockFetch(201, { user: ada })
    const input = { name: 'Ada', email: 'ada@example.com', password: 'pw123456', role: 'student' as const }

    await expect(httpAuthService.signUp(input)).resolves.toEqual(ada)
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { 'Content-Type': 'application/json' },
    })
  })

  it('posts login details and returns the user', async () => {
    const fetchMock = mockFetch(200, { user: ada })

    await expect(
      httpAuthService.logIn({ email: 'ada@example.com', password: 'pw123456' }),
    ).resolves.toEqual(ada)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/login')
  })

  it("surfaces the server's error message", async () => {
    mockFetch(401, { error: 'Incorrect email or password.' })

    await expect(
      httpAuthService.logIn({ email: 'ada@example.com', password: 'nope' }),
    ).rejects.toThrow('Incorrect email or password.')
  })

  it('falls back to a generic message when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Bad Gateway', { status: 502 })))

    await expect(httpAuthService.getCurrentUser()).rejects.toThrow('Request failed (502).')
  })

  it('explains when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await expect(httpAuthService.getCurrentUser()).rejects.toThrow('Could not reach the server.')
  })

  it('returns null from getCurrentUser when logged out', async () => {
    mockFetch(200, { user: null })

    await expect(httpAuthService.getCurrentUser()).resolves.toBeNull()
  })

  it('handles the empty 204 response from logout', async () => {
    const fetchMock = mockFetch(204)

    await expect(httpAuthService.logOut()).resolves.toBeUndefined()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/logout')
  })
})
