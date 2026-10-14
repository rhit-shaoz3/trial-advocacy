import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../app.ts'
import { pool } from '../db/pool.ts'
import { createCourseAs, joinCourse, resetDatabase, signedInAgent } from '../test/helpers.ts'

let prof: request.Agent
let course: { id: string; entryCode: string }

beforeEach(async () => {
  await resetDatabase()
  prof = (await signedInAgent('instructor', 'prof@example.com')).agent
  course = await createCourseAs(prof)
})

afterAll(async () => {
  await pool.end()
})

const rosterUrl = () => `/api/courses/${course.id}/roster`

describe('adding students', () => {
  it('invites existing students and unknown emails alike', async () => {
    const { userId } = await signedInAgent('student', 'ada@example.com', 'Ada Lawyer')

    const res = await prof.post(rosterUrl()).send({ emails: ['  ADA@example.com', 'new@example.com'] })

    expect(res.status).toBe(200)
    expect(res.body.added).toEqual(['ada@example.com', 'new@example.com'])
    expect(res.body.skipped).toEqual([])
    expect(res.body.roster).toEqual([
      { email: 'ada@example.com', name: 'Ada Lawyer', userId, status: 'invited' },
      { email: 'new@example.com', name: null, userId: null, status: 'invited' },
    ])
  })

  it('reports what it skipped and why, and ignores repeats in the same request', async () => {
    await signedInAgent('instructor', 'colleague@example.com')
    await prof.post(rosterUrl()).send({ emails: ['ada@example.com'] })

    const res = await prof.post(rosterUrl()).send({
      emails: ['ada@example.com', 'not-an-email', 'colleague@example.com', 'bo@example.com', 'BO@example.com'],
    })

    expect(res.body.added).toEqual(['bo@example.com'])
    expect(res.body.skipped).toEqual([
      { email: 'ada@example.com', reason: 'Already invited.' },
      { email: 'not-an-email', reason: 'Not a valid email address.' },
      { email: 'colleague@example.com', reason: 'Belongs to an instructor account.' },
    ])
    expect(res.body.roster).toHaveLength(2)
  })

  it('rejects an empty list', async () => {
    const res = await prof.post(rosterUrl()).send({ emails: ['  ', 7] })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Enter at least one email address.')
  })
})

describe('invitations', () => {
  it('reach students who sign up later with that email, who then accept', async () => {
    await prof.post(rosterUrl()).send({ emails: ['ada@example.com'] })

    const { agent: ada } = await signedInAgent('student', 'Ada@Example.com', 'Ada Lawyer')

    expect((await ada.get('/api/courses')).body.courses).toEqual([])
    expect((await ada.get('/api/courses/inbox')).body.invitations).toEqual([
      { courseId: course.id, courseName: 'LAW 540: Trial Advocacy' },
    ])
    expect((await ada.post(`/api/courses/${course.id}/invitation/accept`)).status).toBe(204)

    expect((await ada.get('/api/courses')).body.courses).toHaveLength(1)
    expect((await prof.get(rosterUrl())).body.roster).toEqual([
      expect.objectContaining({ email: 'ada@example.com', name: 'Ada Lawyer', status: 'joined' }),
    ])
  })

  it('take the email off the roster when rejected', async () => {
    const { agent: ada } = await signedInAgent('student', 'ada@example.com')
    await prof.post(rosterUrl()).send({ emails: ['ada@example.com'] })

    expect((await ada.post(`/api/courses/${course.id}/invitation/reject`)).status).toBe(204)

    expect((await prof.get(rosterUrl())).body.roster).toEqual([])
    expect((await ada.get('/api/courses')).body.courses).toEqual([])
  })

  it('let an invited student in straight away with the entry code', async () => {
    const { agent: ada } = await signedInAgent('student', 'ada@example.com')
    await prof.post(rosterUrl()).send({ emails: ['ada@example.com'] })

    const res = await ada.post('/api/courses/join').send({ entryCode: course.entryCode })

    expect(res.status).toBe(201)
    expect(res.body.status).toBe('joined')
    expect((await ada.get('/api/courses')).body.courses).toHaveLength(1)
  })

  it("can't be answered by someone else", async () => {
    await signedInAgent('student', 'ada@example.com')
    await prof.post(rosterUrl()).send({ emails: ['ada@example.com'] })
    const { agent: eve } = await signedInAgent('student', 'eve@example.com')

    expect((await eve.post(`/api/courses/${course.id}/invitation/accept`)).status).toBe(404)
    expect((await prof.get(rosterUrl())).body.roster[0].status).toBe('invited')
  })
})

describe('admitting and denying', () => {
  async function requesters() {
    const ana = await signedInAgent('student', 'ana@example.com', 'Ana')
    const bo = await signedInAgent('student', 'bo@example.com', 'Bo')
    for (const s of [ana, bo]) await s.agent.post('/api/courses/join').send({ entryCode: course.entryCode })
    return { ana, bo }
  }

  it('shows requests on the roster and admits several at once', async () => {
    const { ana, bo } = await requesters()
    expect((await prof.get(rosterUrl())).body.roster.map((r: { status: string }) => r.status)).toEqual([
      'requested',
      'requested',
    ])

    const res = await prof
      .post(`${rosterUrl()}/requests`)
      .send({ userIds: [ana.userId, bo.userId], decision: 'admit' })

    expect(res.status).toBe(200)
    expect(res.body.updated).toBe(2)
    expect(res.body.roster.every((r: { status: string }) => r.status === 'joined')).toBe(true)
    expect((await ana.agent.get('/api/courses')).body.courses).toHaveLength(1)
  })

  it('hides denied students from the roster and tells the student once', async () => {
    const { ana, bo } = await requesters()

    await prof.post(`${rosterUrl()}/requests`).send({ userIds: [ana.userId], decision: 'deny' })

    expect((await prof.get(rosterUrl())).body.roster).toEqual([
      expect.objectContaining({ userId: bo.userId, status: 'requested' }),
    ])
    expect((await ana.agent.get('/api/courses/inbox')).body.denials).toEqual([
      { courseId: course.id, courseName: 'LAW 540: Trial Advocacy' },
    ])
    expect((await ana.agent.post(`/api/courses/${course.id}/denial/dismiss`)).status).toBe(204)
    expect((await ana.agent.get('/api/courses/inbox')).body.denials).toEqual([])
    expect((await ana.agent.get('/api/courses')).body.courses).toEqual([])
  })

  it('lets a denied student ask again', async () => {
    const { ana } = await requesters()
    await prof.post(`${rosterUrl()}/requests`).send({ userIds: [ana.userId], decision: 'deny' })

    const res = await ana.agent.post('/api/courses/join').send({ entryCode: course.entryCode })

    expect(res.body.status).toBe('requested')
  })

  it.each([
    ['no students', { userIds: [], decision: 'admit' }, 'Choose at least one student.'],
    ['a bad decision', { userIds: ['00000000-0000-0000-0000-000000000000'], decision: 'maybe' }, 'Decision must be admit or deny.'],
  ])('rejects %s', async (_label, body, message) => {
    const res = await prof.post(`${rosterUrl()}/requests`).send(body)

    expect(res.status).toBe(400)
    expect(res.body.error).toBe(message)
  })
})

describe('signing up with a course code', () => {
  it('refuses an unknown code and creates no account', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Sam', email: 'sam@example.com', password: 'correct-horse', role: 'student', classCode: 'NOPE00' })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe("Sorry, we can't find a course with that code.")
    const { rows } = await pool.query('SELECT 1 FROM users WHERE email = $1', ['sam@example.com'])
    expect(rows).toHaveLength(0)
  })

  it('creates the account and asks to join', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Sam', email: 'sam@example.com', password: 'correct-horse', role: 'student', classCode: course.entryCode.toLowerCase() })

    expect(res.status).toBe(201)
    expect((await prof.get(rosterUrl())).body.roster).toEqual([
      expect.objectContaining({ email: 'sam@example.com', status: 'requested' }),
    ])
  })
})

describe('removing students', () => {
  it('takes the student off the roster and out of their course list', async () => {
    const { agent: ada } = await signedInAgent('student', 'ada@example.com')
    await joinCourse(ada, prof, course)

    const res = await prof.delete(`${rosterUrl()}/${encodeURIComponent('ADA@example.com')}`)

    expect(res.status).toBe(204)
    expect((await prof.get(rosterUrl())).body.roster).toEqual([])
    expect((await ada.get('/api/courses')).body.courses).toEqual([])
  })

  it('404s for an email that is not on the roster', async () => {
    const res = await prof.delete(`${rosterUrl()}/nobody%40example.com`)

    expect(res.status).toBe(404)
  })
})

describe('access', () => {
  it('is limited to the instructor who teaches the course', async () => {
    const { agent: other } = await signedInAgent('instructor', 'other@example.com')
    const { agent: student } = await signedInAgent('student', 'ada@example.com')
    await student.post('/api/courses/join').send({ entryCode: course.entryCode })

    for (const agent of [other, student]) {
      expect((await agent.get(rosterUrl())).status).toBe(404)
      expect((await agent.post(rosterUrl()).send({ emails: ['x@example.com'] })).status).toBe(404)
      expect((await agent.delete(`${rosterUrl()}/ada%40example.com`)).status).toBe(404)
    }
    expect((await prof.get(rosterUrl())).body.roster).toHaveLength(1)
  })
})
