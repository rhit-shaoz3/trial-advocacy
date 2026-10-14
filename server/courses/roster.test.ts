import type request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/pool.ts'
import { createCourseAs, resetDatabase, signedInAgent } from '../test/helpers.ts'

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
  it('adds existing students as joined and unknown emails as pending', async () => {
    await signedInAgent('student', 'ada@example.com', 'Ada Lawyer')

    const res = await prof.post(rosterUrl()).send({ emails: ['  ADA@example.com', 'new@example.com'] })

    expect(res.status).toBe(200)
    expect(res.body.added).toEqual(['ada@example.com', 'new@example.com'])
    expect(res.body.skipped).toEqual([])
    expect(res.body.roster).toEqual([
      { email: 'ada@example.com', name: 'Ada Lawyer', joined: true },
      { email: 'new@example.com', name: null, joined: false },
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
      { email: 'ada@example.com', reason: 'Already on the roster.' },
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

describe('pending students', () => {
  it('are enrolled automatically when they sign up with that email', async () => {
    await prof.post(rosterUrl()).send({ emails: ['ada@example.com'] })

    const { agent: ada } = await signedInAgent('student', 'Ada@Example.com', 'Ada Lawyer')

    expect((await ada.get('/api/courses')).body.courses).toHaveLength(1)
    const roster = (await prof.get(rosterUrl())).body.roster
    expect(roster).toEqual([{ email: 'ada@example.com', name: 'Ada Lawyer', joined: true }])
  })

  it('can also claim their spot with the entry code', async () => {
    const { agent: ada } = await signedInAgent('student', 'ada@example.com')
    // Added after Ada had an account, so the spot is linked immediately; joining is then a no-op 409.
    await prof.post(rosterUrl()).send({ emails: ['ada@example.com'] })

    const res = await ada.post('/api/courses/join').send({ entryCode: course.entryCode })

    expect(res.status).toBe(409)
    expect((await prof.get(rosterUrl())).body.roster).toHaveLength(1)
  })
})

describe('removing students', () => {
  it('takes the student off the roster and out of their course list', async () => {
    const { agent: ada } = await signedInAgent('student', 'ada@example.com')
    await ada.post('/api/courses/join').send({ entryCode: course.entryCode })

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
