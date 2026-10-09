import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../app.ts'
import { pool } from '../db/pool.ts'

const SESSION_COOKIE = 'ta.sid'

const validSignup = {
  name: 'Ada Lawyer',
  email: 'ada@example.com',
  password: 'correct-horse',
  role: 'student',
}

function sessionCookie(res: request.Response) {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? [])
  return cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`))
}

async function countUsers() {
  const { rows } = await pool.query<{ count: string }>('SELECT count(*) FROM users')
  return Number(rows[0].count)
}

beforeEach(async () => {
  await pool.query('TRUNCATE users, session CASCADE')
})

afterAll(async () => {
  await pool.end()
})

describe('POST /api/auth/signup', () => {
  it('creates the user, returns it without the password, and logs them in', async () => {
    const res = await request(app).post('/api/auth/signup').send(validSignup)

    expect(res.status).toBe(201)
    expect(res.body.user).toEqual({
      id: expect.any(String),
      name: 'Ada Lawyer',
      email: 'ada@example.com',
      role: 'student',
      createdAt: expect.any(String),
    })
    expect(JSON.stringify(res.body)).not.toContain('correct-horse')
    expect(JSON.stringify(res.body)).not.toContain('password')

    const cookie = sessionCookie(res)
    expect(cookie).toBeDefined()
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
  })

  it('stores a bcrypt hash, never the plain password', async () => {
    await request(app).post('/api/auth/signup').send(validSignup)

    const { rows } = await pool.query('SELECT password_hash FROM users')
    expect(rows).toHaveLength(1)
    expect(rows[0].password_hash).not.toBe(validSignup.password)
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$\d{2}\$/)
  })

  it('trims the name and normalizes the email to lowercase', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ ...validSignup, name: '  Ada Lawyer  ', email: '  Ada@Example.COM ' })

    expect(res.status).toBe(201)
    expect(res.body.user.name).toBe('Ada Lawyer')
    expect(res.body.user.email).toBe('ada@example.com')
  })

  it('accepts the instructor role', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ ...validSignup, role: 'instructor' })

    expect(res.status).toBe(201)
    expect(res.body.user.role).toBe('instructor')
  })

  it('rejects a second account with the same email, ignoring case', async () => {
    await request(app).post('/api/auth/signup').send(validSignup)
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ ...validSignup, name: 'Imposter', email: 'ADA@example.com' })

    expect(res.status).toBe(409)
    expect(res.body.error).toBe('An account with that email already exists.')
    expect(sessionCookie(res)).toBeUndefined()
    expect(await countUsers()).toBe(1)
  })

  it.each([
    ['missing name', { name: '' }, 'Name is required.'],
    ['whitespace-only name', { name: '   ' }, 'Name is required.'],
    ['invalid email', { email: 'not-an-email' }, 'Enter a valid email address.'],
    ['missing email', { email: '' }, 'Enter a valid email address.'],
    ['password under 8 characters', { password: 'short' }, 'Password must be at least 8 characters.'],
    ['password over 72 bytes', { password: 'a'.repeat(73) }, 'Password is too long.'],
    ['unknown role', { role: 'admin' }, 'Choose student or instructor.'],
    ['missing role', { role: undefined }, 'Choose student or instructor.'],
    ['non-string fields', { name: 123, email: ['a@b.co'] }, 'Name is required.'],
  ])('rejects %s with 400 and creates nothing', async (_label, override, message) => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ ...validSignup, ...override })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe(message)
    expect(sessionCookie(res)).toBeUndefined()
    expect(await countUsers()).toBe(0)
  })

  it('accepts a password of exactly 8 characters', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ ...validSignup, password: '12345678' })

    expect(res.status).toBe(201)
  })
})

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/api/auth/signup').send(validSignup)
  })

  it('logs in with the right email and password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: validSignup.email, password: validSignup.password })

    expect(res.status).toBe(200)
    expect(res.body.user).toMatchObject({ email: 'ada@example.com', role: 'student' })
    expect(sessionCookie(res)).toBeDefined()
  })

  it('matches the email regardless of case and surrounding spaces', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: '  ADA@Example.com ', password: validSignup.password })

    expect(res.status).toBe(200)
  })

  it('rejects a wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: validSignup.email, password: 'wrong-password' })

    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Incorrect email or password.')
    expect(sessionCookie(res)).toBeUndefined()
  })

  it('treats the password as case-sensitive', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: validSignup.email, password: validSignup.password.toUpperCase() })

    expect(res.status).toBe(401)
  })

  it('gives an unknown email the same error as a wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: validSignup.password })

    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Incorrect email or password.')
  })

  it.each([
    ['empty body', {}],
    ['missing password', { email: 'ada@example.com' }],
    ['missing email', { password: 'correct-horse' }],
  ])('rejects %s with 401', async (_label, body) => {
    const res = await request(app).post('/api/auth/login').send(body)

    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Incorrect email or password.')
  })

  it('issues a new session ID on login (no session fixation)', async () => {
    const agent = request.agent(app)
    const first = await agent
      .post('/api/auth/login')
      .send({ email: validSignup.email, password: validSignup.password })
    const second = await agent
      .post('/api/auth/login')
      .send({ email: validSignup.email, password: validSignup.password })

    const firstId = sessionCookie(first)?.split(';')[0]
    const secondId = sessionCookie(second)?.split(';')[0]
    expect(firstId).toBeDefined()
    expect(secondId).toBeDefined()
    expect(secondId).not.toBe(firstId)
  })
})

describe('session lifecycle', () => {
  it('reports no user when not logged in', async () => {
    const res = await request(app).get('/api/auth/me')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ user: null })
  })

  it('remembers the user after sign-up, then forgets them after logout', async () => {
    const agent = request.agent(app)

    const signup = await agent.post('/api/auth/signup').send(validSignup)
    const me = await agent.get('/api/auth/me')
    expect(me.body.user).toEqual(signup.body.user)

    const logout = await agent.post('/api/auth/logout')
    expect(logout.status).toBe(204)

    const after = await agent.get('/api/auth/me')
    expect(after.body).toEqual({ user: null })
  })

  it('remembers the user after login', async () => {
    await request(app).post('/api/auth/signup').send(validSignup)
    const agent = request.agent(app)
    await agent
      .post('/api/auth/login')
      .send({ email: validSignup.email, password: validSignup.password })

    const me = await agent.get('/api/auth/me')
    expect(me.body.user.email).toBe('ada@example.com')
  })

  it('invalidates the old cookie on logout, even if someone kept a copy', async () => {
    const signup = await request(app).post('/api/auth/signup').send(validSignup)
    const stolenCookie = sessionCookie(signup)!.split(';')[0]

    await request(app).post('/api/auth/logout').set('Cookie', stolenCookie)
    const me = await request(app).get('/api/auth/me').set('Cookie', stolenCookie)

    expect(me.body).toEqual({ user: null })
  })

  it('ignores a forged session cookie', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `${SESSION_COOKIE}=s%3Aforged.invalidsignature`)

    expect(res.body).toEqual({ user: null })
  })

  it('logs out cleanly even when not logged in', async () => {
    const res = await request(app).post('/api/auth/logout')

    expect(res.status).toBe(204)
  })
})

describe('error handling', () => {
  it('returns 400 for malformed JSON', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{not json')

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Request body is not valid JSON.')
  })

  it('returns a JSON 404 for unknown API routes', async () => {
    const res = await request(app).get('/api/does-not-exist')

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Not found.' })
  })
})
