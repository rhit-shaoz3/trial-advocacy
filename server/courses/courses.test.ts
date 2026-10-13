import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../app.ts'
import { pool } from '../db/pool.ts'
import { createCourseAs, fallTrial, resetDatabase, signedInAgent } from '../test/helpers.ts'

beforeEach(resetDatabase)

afterAll(async () => {
  await pool.end()
})

describe('POST /api/courses', () => {
  it('creates a course with a fresh entry code for the instructor', async () => {
    const { agent } = await signedInAgent('instructor', 'prof@example.com', 'Prof. Ruiz')
    const res = await agent.post('/api/courses').send({ ...fallTrial, code: '  LAW 540 ' })

    expect(res.status).toBe(201)
    expect(res.body.course).toEqual({
      id: expect.any(String),
      code: 'LAW 540',
      title: 'Trial Advocacy',
      term: 'Fall 2026',
      instructorName: 'Prof. Ruiz',
      season: 'Fall',
      year: 2026,
      entryCode: expect.stringMatching(/^[A-HJ-NP-Z2-9]{6}$/),
      studentCount: 0,
    })
  })

  it('gives every course a different entry code', async () => {
    const { agent } = await signedInAgent('instructor')
    const codes = new Set()
    for (let i = 0; i < 5; i++) codes.add((await createCourseAs(agent)).entryCode)

    expect(codes.size).toBe(5)
  })

  it('does not let students create courses', async () => {
    const { agent } = await signedInAgent('student')
    const res = await agent.post('/api/courses').send(fallTrial)

    expect(res.status).toBe(403)
  })

  it.each([
    ['missing code', { code: ' ' }, 'Course number is required.'],
    ['long code', { code: 'x'.repeat(21) }, 'Course number must be at most 20 characters.'],
    ['missing title', { title: '' }, 'Course title is required.'],
    ['unknown season', { season: 'Autumn' }, 'Choose a term.'],
    ['inherited property as season', { season: 'toString' }, 'Choose a term.'],
    ['year as a string', { year: '2026' }, 'Enter a valid year.'],
    ['fractional year', { year: 2026.5 }, 'Enter a valid year.'],
    ['year out of range', { year: 1999 }, 'Enter a valid year.'],
  ])('rejects %s', async (_label, override, message) => {
    const { agent } = await signedInAgent('instructor')
    const res = await agent.post('/api/courses').send({ ...fallTrial, ...override })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe(message)
  })
})

describe('GET /api/courses/teaching', () => {
  it("lists only the instructor's own courses, newest term first, with student counts", async () => {
    const { agent } = await signedInAgent('instructor')
    const { agent: other } = await signedInAgent('instructor', 'other@example.com')
    const spring = await createCourseAs(agent, { ...fallTrial, code: 'LAW 520', title: 'Evidence', season: 'Spring' })
    const fall = await createCourseAs(agent)
    await createCourseAs(other, { ...fallTrial, title: 'Not mine' })
    await agent.post(`/api/courses/${fall.id}/roster`).send({ emails: ['a@example.com', 'b@example.com'] })

    const res = await agent.get('/api/courses/teaching')

    expect(res.body.courses.map((c: { id: string }) => c.id)).toEqual([fall.id, spring.id])
    expect(res.body.courses[0]).toMatchObject({ term: 'Fall 2026', studentCount: 2 })
    expect(res.body.courses[1]).toMatchObject({ term: 'Spring 2026', studentCount: 0 })
  })

  it('is only for instructors', async () => {
    const { agent } = await signedInAgent('student')
    expect((await agent.get('/api/courses/teaching')).status).toBe(403)
  })
})

describe('GET /api/courses/:courseId', () => {
  it('returns the course to its instructor', async () => {
    const { agent } = await signedInAgent('instructor')
    const course = await createCourseAs(agent)

    const res = await agent.get(`/api/courses/${course.id}`)

    expect(res.status).toBe(200)
    expect(res.body.course).toMatchObject({ id: course.id, entryCode: course.entryCode })
  })

  it("404s for another instructor's course, a student, and a malformed id", async () => {
    const { agent } = await signedInAgent('instructor')
    const course = await createCourseAs(agent)
    const { agent: other } = await signedInAgent('instructor', 'other@example.com')
    const { agent: student } = await signedInAgent('student')
    await student.post('/api/courses/join').send({ entryCode: course.entryCode })

    expect((await other.get(`/api/courses/${course.id}`)).status).toBe(404)
    expect((await student.get(`/api/courses/${course.id}`)).status).toBe(404)
    expect((await agent.get('/api/courses/not-a-uuid')).status).toBe(404)
  })
})

describe('PATCH /api/courses/:courseId', () => {
  it('updates the details and keeps the entry code and roster', async () => {
    const { agent } = await signedInAgent('instructor')
    const course = await createCourseAs(agent)
    await agent.post(`/api/courses/${course.id}/roster`).send({ emails: ['a@example.com'] })

    const res = await agent
      .patch(`/api/courses/${course.id}`)
      .send({ code: ' LAW 541 ', title: 'Advanced Trial Advocacy', season: 'Winter', year: 2027 })

    expect(res.status).toBe(200)
    expect(res.body.course).toMatchObject({
      id: course.id,
      code: 'LAW 541',
      title: 'Advanced Trial Advocacy',
      term: 'Winter 2027',
      season: 'Winter',
      year: 2027,
      entryCode: course.entryCode,
      studentCount: 1,
    })
    expect((await agent.get(`/api/courses/${course.id}`)).body.course.term).toBe('Winter 2027')
  })

  it('moves the course to its new place in the term order', async () => {
    const { agent } = await signedInAgent('instructor')
    const fall = await createCourseAs(agent)
    const winter = await createCourseAs(agent, { ...fallTrial, title: 'Evidence', season: 'Winter' })

    await agent.patch(`/api/courses/${winter.id}`).send({ ...fallTrial, title: 'Evidence', season: 'Winter', year: 2027 })

    const ids = (await agent.get('/api/courses/teaching')).body.courses.map((c: { id: string }) => c.id)
    expect(ids).toEqual([winter.id, fall.id])
  })

  it('validates like create', async () => {
    const { agent } = await signedInAgent('instructor')
    const course = await createCourseAs(agent)

    const res = await agent.patch(`/api/courses/${course.id}`).send({ ...fallTrial, title: '  ' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Course title is required.')
  })

  it("404s for another instructor's course", async () => {
    const { agent } = await signedInAgent('instructor')
    const course = await createCourseAs(agent)
    const { agent: other } = await signedInAgent('instructor', 'other@example.com')

    const res = await other.patch(`/api/courses/${course.id}`).send({ ...fallTrial, title: 'Mine now' })

    expect(res.status).toBe(404)
    expect((await agent.get(`/api/courses/${course.id}`)).body.course.title).toBe('Trial Advocacy')
  })
})

describe('DELETE /api/courses/:courseId', () => {
  it('deletes the course with its roster and fact patterns, and retires the entry code', async () => {
    const { agent } = await signedInAgent('instructor')
    const course = await createCourseAs(agent)
    const { agent: student } = await signedInAgent()
    await student.post('/api/courses/join').send({ entryCode: course.entryCode })
    await agent
      .post(`/api/courses/${course.id}/fact-patterns`)
      .set('Content-Type', 'application/pdf')
      .set('X-Filename', 'case.pdf')
      .send(Buffer.from('%PDF'))

    const res = await agent.delete(`/api/courses/${course.id}`)

    expect(res.status).toBe(204)
    expect((await agent.get(`/api/courses/${course.id}`)).status).toBe(404)
    expect((await agent.get('/api/courses/teaching')).body.courses).toEqual([])
    expect((await student.get('/api/courses')).body.courses).toEqual([])
    const leftovers = await pool.query(
      `SELECT (SELECT count(*) FROM enrollments)::int AS enrollments,
              (SELECT count(*) FROM fact_patterns)::int AS files`,
    )
    expect(leftovers.rows[0]).toEqual({ enrollments: 0, files: 0 })
    const join = await student.post('/api/courses/join').send({ entryCode: course.entryCode })
    expect(join.status).toBe(404)
  })

  it("404s for another instructor's course or a student, and deletes nothing", async () => {
    const { agent } = await signedInAgent('instructor')
    const course = await createCourseAs(agent)
    const { agent: other } = await signedInAgent('instructor', 'other@example.com')
    const { agent: student } = await signedInAgent()

    expect((await other.delete(`/api/courses/${course.id}`)).status).toBe(404)
    expect((await student.delete(`/api/courses/${course.id}`)).status).toBe(404)
    expect((await agent.get(`/api/courses/${course.id}`)).status).toBe(200)
  })
})

describe('GET /api/courses/:courseId/home', () => {
  it('returns the course and (for now) empty case lists to an enrolled student', async () => {
    const { agent: prof } = await signedInAgent('instructor', 'prof@example.com', 'Prof. Ruiz')
    const course = await createCourseAs(prof)
    const { agent } = await signedInAgent()
    await agent.post('/api/courses/join').send({ entryCode: course.entryCode })

    const res = await agent.get(`/api/courses/${course.id}/home`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      course: { id: course.id, code: 'LAW 540', title: 'Trial Advocacy', term: 'Fall 2026', instructorName: 'Prof. Ruiz' },
      cases: [],
      activity: [],
      upcoming: [],
      stats: { tasksCompleted: 0, tasksCompletedThisWeek: 0 },
    })
  })

  it('is open to the instructor who teaches the course', async () => {
    const { agent: prof } = await signedInAgent('instructor')
    const course = await createCourseAs(prof)

    expect((await prof.get(`/api/courses/${course.id}/home`)).status).toBe(200)
  })

  it('404s for students who are not enrolled or give a bad id, and 401s when logged out', async () => {
    const { agent: prof } = await signedInAgent('instructor')
    const course = await createCourseAs(prof)
    const { agent: outsider } = await signedInAgent('student', 'outsider@example.com')

    expect((await outsider.get(`/api/courses/${course.id}/home`)).status).toBe(404)
    expect((await outsider.get('/api/courses/nope/home')).status).toBe(404)
    expect((await request(app).get(`/api/courses/${course.id}/home`)).status).toBe(401)
  })
})

describe('GET /api/courses', () => {
  it('requires a login', async () => {
    const res = await request(app).get('/api/courses')

    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Please log in.')
  })

  it("lists only the student's joined courses, newest term first, without entry codes", async () => {
    const { agent: prof } = await signedInAgent('instructor', 'prof@example.com', 'Prof. Ruiz')
    const evidence = await createCourseAs(prof, { ...fallTrial, code: 'LAW 520', title: 'Evidence', season: 'Spring' })
    const trial = await createCourseAs(prof)
    await createCourseAs(prof, { ...fallTrial, title: 'Not mine' })
    const { agent } = await signedInAgent()
    await agent.post('/api/courses/join').send({ entryCode: evidence.entryCode })
    await agent.post('/api/courses/join').send({ entryCode: trial.entryCode })

    const res = await agent.get('/api/courses')

    expect(res.body.courses).toEqual([
      { id: trial.id, code: 'LAW 540', title: 'Trial Advocacy', term: 'Fall 2026', instructorName: 'Prof. Ruiz' },
      { id: evidence.id, code: 'LAW 520', title: 'Evidence', term: 'Spring 2026', instructorName: 'Prof. Ruiz' },
    ])
  })

  it('leaves out courses where the student is still pending', async () => {
    const { agent: prof } = await signedInAgent('instructor')
    const course = await createCourseAs(prof)
    await prof.post(`/api/courses/${course.id}/roster`).send({ emails: ['someone-else@example.com'] })
    const { agent } = await signedInAgent()

    expect((await agent.get('/api/courses')).body.courses).toEqual([])
  })
})

describe('POST /api/courses/join', () => {
  let course: { id: string; entryCode: string }

  beforeEach(async () => {
    const { agent } = await signedInAgent('instructor')
    course = await createCourseAs(agent)
  })

  it('enrolls the student, ignoring case and surrounding spaces', async () => {
    const { agent } = await signedInAgent()
    const res = await agent
      .post('/api/courses/join')
      .send({ entryCode: `  ${course.entryCode.toLowerCase()} ` })

    expect(res.status).toBe(201)
    expect(res.body.course).toMatchObject({ id: course.id, code: 'LAW 540' })
    expect(res.body.course.entryCode).toBeUndefined()
    expect((await agent.get('/api/courses')).body.courses).toHaveLength(1)
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
    await agent.post('/api/courses/join').send({ entryCode: course.entryCode })
    const res = await agent.post('/api/courses/join').send({ entryCode: course.entryCode })

    expect(res.status).toBe(409)
    expect(res.body.error).toBe('You are already enrolled in that course.')
  })

  it('does not let instructors join as students', async () => {
    const { agent } = await signedInAgent('instructor', 'other@example.com')
    const res = await agent.post('/api/courses/join').send({ entryCode: course.entryCode })

    expect(res.status).toBe(403)
  })

  it('requires a login', async () => {
    const res = await request(app).post('/api/courses/join').send({ entryCode: course.entryCode })

    expect(res.status).toBe(401)
  })
})
