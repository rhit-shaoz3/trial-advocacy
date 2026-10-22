import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../app.ts'
import { pool } from '../db/pool.ts'
import { storage } from '../storage/storage.ts'
import { resetDatabase, signedInAgent } from '../test/helpers.ts'
import { MAX_AVATAR_BYTES } from './avatars.ts'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rest of a png')])
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('rest of a jpeg')])

beforeEach(resetDatabase)

afterAll(async () => {
  await pool.end()
})

const upload = (agent: request.Agent, data: Buffer, type = 'image/png') =>
  agent.put('/api/auth/me/avatar').set('Content-Type', type).send(data)

async function storedKey(userId: string) {
  const { rows } = await pool.query<{ avatar_key: string | null }>('SELECT avatar_key FROM users WHERE id = $1', [userId])
  return rows[0].avatar_key
}

describe('PUT /api/auth/me/avatar', () => {
  it('stores the picture and returns the user with a versioned link to it', async () => {
    const { agent, userId } = await signedInAgent()

    const res = await upload(agent, PNG)

    expect(res.status).toBe(200)
    expect(res.body.user.avatarUrl).toMatch(new RegExp(`^/api/users/${userId}/avatar\\?v=[0-9a-f-]{36}$`))
    const key = await storedKey(userId)
    expect(key).toMatch(new RegExp(`^avatars/${userId}/`))
    expect(await storage.read(key!)).toEqual(PNG)
    expect((await agent.get('/api/auth/me')).body.user.avatarUrl).toBe(res.body.user.avatarUrl)
  })

  it('replaces the old picture and deletes it from storage', async () => {
    const { agent, userId } = await signedInAgent()
    await upload(agent, PNG)
    const oldKey = await storedKey(userId)

    const res = await upload(agent, JPEG, 'image/jpeg')

    expect(res.status).toBe(200)
    expect(await storedKey(userId)).not.toBe(oldKey)
    expect(await storage.size(oldKey!)).toBeNull()
  })

  it('accepts only PNG and JPEG, judged by the file itself', async () => {
    const { agent } = await signedInAgent()

    const res = await upload(agent, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/png')

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Choose a PNG or JPEG picture.')
  })

  it('rejects pictures over 1 MB', async () => {
    const { agent } = await signedInAgent()

    const res = await upload(agent, Buffer.concat([PNG, Buffer.alloc(MAX_AVATAR_BYTES)]))

    expect(res.status).toBe(413)
    expect(res.body.error).toBe('That picture is too large. The limit is 1 MB.')
  })

  it('needs a login', async () => {
    const res = await upload(request.agent(app), PNG)
    expect(res.status).toBe(401)
  })
})

describe('DELETE /api/auth/me/avatar', () => {
  it('removes the picture, going back to initials', async () => {
    const { agent, userId } = await signedInAgent()
    await upload(agent, PNG)
    const key = await storedKey(userId)

    const res = await agent.delete('/api/auth/me/avatar')

    expect(res.status).toBe(200)
    expect(res.body.user.avatarUrl).toBeNull()
    expect(await storedKey(userId)).toBeNull()
    expect(await storage.size(key!)).toBeNull()
  })
})

describe('GET /api/users/:id/avatar', () => {
  it('serves the picture to anyone signed in, cached for good at its current version', async () => {
    const { agent } = await signedInAgent('student', 'ada@example.com')
    const { avatarUrl } = (await upload(agent, JPEG, 'image/jpeg')).body.user
    const { agent: other } = await signedInAgent('instructor')

    const res = await other.get(avatarUrl).buffer(true)

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/jpeg')
    expect(res.headers['cache-control']).toContain('immutable')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(Buffer.from(res.body)).toEqual(JPEG)
  })

  it("doesn't cache an old version's link", async () => {
    const { agent, userId } = await signedInAgent()
    await upload(agent, PNG)

    const res = await agent.get(`/api/users/${userId}/avatar?v=old`)

    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('private, no-cache')
  })

  it('is 404 without a picture, and 401 signed out', async () => {
    const { agent, userId } = await signedInAgent()

    expect((await agent.get(`/api/users/${userId}/avatar`)).status).toBe(404)
    expect((await agent.get('/api/users/not-a-uuid/avatar')).status).toBe(404)
    expect((await request(app).get(`/api/users/${userId}/avatar`)).status).toBe(401)
  })
})

describe('pictures in lists of people', () => {
  it('shows each student’s picture on the roster', async () => {
    const { agent: prof } = await signedInAgent('instructor')
    const course = (await prof.post('/api/courses').send({ code: 'LAW 540', title: 'Trial', season: 'Fall', year: 2026 })).body.course
    await prof.post(`/api/courses/${course.id}/roster`).send({ emails: ['ada@example.com', 'pending@example.com'] })
    const { agent } = await signedInAgent('student', 'ada@example.com', 'Ada')
    const { avatarUrl } = (await upload(agent, PNG)).body.user

    const { roster } = (await prof.get(`/api/courses/${course.id}/roster`)).body

    expect(roster).toEqual([
      { email: 'ada@example.com', name: 'Ada', joined: true, avatarUrl },
      { email: 'pending@example.com', name: null, joined: false, avatarUrl: null },
    ])
  })
})
