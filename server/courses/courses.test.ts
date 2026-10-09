import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../app.ts'
import { pool } from '../db/pool.ts'

async function signedInAgent(role: 'student' | 'instructor' = 'student', email = `${role}@example.com`) {
  const agent = request.agent(app)
  const res = await agent
    .post('/api/auth/signup')
    .send({ name: `Test ${role}`, email, password: 'correct-horse', role })
  return { agent, userId: res.body.user.id as string }
}

async function createCourse(fields: {
  code: string
  title: string
  term: string
  termStart: string
  entryCode: string
  instructorId?: string | null
}) {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO courses (code, title, term, term_start, entry_code, instructor_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [fields.code, fields.title, fields.term, fields.termStart, fields.entryCode, fields.instructorId ?? null],
  )
  return rows[0].id
}

async function enroll(userId: string, courseId: string) {
  await pool.query('INSERT INTO enrollments (user_id, course_id) VALUES ($1, $2)', [userId, courseId])
}

beforeEach(async () => {
  await pool.query('TRUNCATE users, session, courses, enrollments CASCADE')
})

afterAll(async () => {
  await pool.end()
})

describe('GET /api/courses', () => {
  it('requires a login', async () => {
    const res = await request(app).get('/api/courses')

    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Please log in.')
  })

  it('returns an empty list for a new student', async () => {
    const { agent } = await signedInAgent()
    const res = await agent.get('/api/courses')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ courses: [] })
  })

  it("lists only the student's courses, newest term first, with the instructor's name", async () => {
    const { userId: profId } = await signedInAgent('instructor', 'prof@example.com')
    const { agent, userId } = await signedInAgent()
    const evidence = await createCourse({
      code: 'LAW 520', title: 'Evidence', term: 'Spring 2026', termStart: '2026-03-30', entryCode: 'EVID26',
    })
    const trial = await createCourse({
      code: 'LAW 540', title: 'Trial Advocacy', term: 'Fall 2026', termStart: '2026-09-22', entryCode: 'TRIAL1',
      instructorId: profId,
    })
    await createCourse({
      code: 'LAW 999', title: 'Not Mine', term: 'Fall 2026', termStart: '2026-09-22', entryCode: 'OTHER1',
    })
    await enroll(userId, evidence)
    await enroll(userId, trial)

    const res = await agent.get('/api/courses')

    expect(res.body.courses).toEqual([
      { id: trial, code: 'LAW 540', title: 'Trial Advocacy', term: 'Fall 2026', instructorName: 'Test instructor' },
      { id: evidence, code: 'LAW 520', title: 'Evidence', term: 'Spring 2026', instructorName: null },
    ])
    expect(JSON.stringify(res.body)).not.toContain('EVID26') // entry codes stay private
  })
})

describe('POST /api/courses/join', () => {
  let courseId: string

  beforeEach(async () => {
    courseId = await createCourse({
      code: 'LAW 540', title: 'Trial Advocacy', term: 'Fall 2026', termStart: '2026-09-22', entryCode: 'TRIAL1',
    })
  })

  it('enrolls the student, ignoring case and surrounding spaces', async () => {
    const { agent } = await signedInAgent()
    const res = await agent.post('/api/courses/join').send({ entryCode: '  trial1 ' })

    expect(res.status).toBe(201)
    expect(res.body.course).toMatchObject({ id: courseId, code: 'LAW 540' })
    const list = await agent.get('/api/courses')
    expect(list.body.courses).toHaveLength(1)
  })

  it('rejects an unknown code', async () => {
    const { agent } = await signedInAgent()
    const res = await agent.post('/api/courses/join').send({ entryCode: 'NOPE00' })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('No course matches that entry code.')
  })

  it('rejects a missing code', async () => {
    const { agent } = await signedInAgent()
    const res = await agent.post('/api/courses/join').send({ entryCode: 42 })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Enter an entry code.')
  })

  it('rejects joining twice', async () => {
    const { agent } = await signedInAgent()
    await agent.post('/api/courses/join').send({ entryCode: 'TRIAL1' })
    const res = await agent.post('/api/courses/join').send({ entryCode: 'TRIAL1' })

    expect(res.status).toBe(409)
    expect(res.body.error).toBe('You are already enrolled in that course.')
  })

  it('does not let instructors join as students', async () => {
    const { agent } = await signedInAgent('instructor')
    const res = await agent.post('/api/courses/join').send({ entryCode: 'TRIAL1' })

    expect(res.status).toBe(403)
  })

  it('requires a login', async () => {
    const res = await request(app).post('/api/courses/join').send({ entryCode: 'TRIAL1' })

    expect(res.status).toBe(401)
  })
})
