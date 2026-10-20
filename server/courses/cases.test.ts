import type request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/pool.ts'
import { createCourseAs, resetDatabase, sampleFacts, signedInAgent } from '../test/helpers.ts'

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

const baseUrl = () => `/api/courses/${course.id}/cases`
const coaster = { title: 'Rivera v. Thrill Park', summary: 'A rollercoaster stops mid-loop.', importantFacts: sampleFacts }

async function createCase(input: Record<string, unknown> = coaster) {
  const res = await prof.post(baseUrl()).send({ importantFacts: sampleFacts, ...input })
  if (res.status !== 201) throw new Error(`Create case failed: ${JSON.stringify(res.body)}`)
  return res.body.case as { id: string; status: string }
}

describe('creating', () => {
  it('starts the case as a draft and lists it', async () => {
    const res = await prof.post(baseUrl()).send({
      title: '  Rivera v. Thrill Park ',
      summary: coaster.summary,
      importantFacts: { plaintiff: ['  The lap bar light was red. ', '', '  '], defense: ['It passed inspection.'] },
    })

    expect(res.status).toBe(201)
    expect(res.body.case).toEqual({
      id: expect.any(String),
      title: 'Rivera v. Thrill Park',
      summary: coaster.summary,
      status: 'draft',
      phase: 'subpoena',
      instructorNote: '',
      inWorldDate: null,
      disputedIssues: '',
      importantFacts: { plaintiff: ['The lap bar light was red.'], defense: ['It passed inspection.'] },
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    })

    const list = await prof.get(baseUrl())
    expect(list.body.cases).toEqual([res.body.case])
  })

  it('lists cases oldest first', async () => {
    await createCase({ title: 'First case' })
    await createCase({ title: 'Second case' })

    const list = await prof.get(baseUrl())
    expect(list.body.cases.map((c: { title: string }) => c.title)).toEqual(['First case', 'Second case'])
  })

  it('allows an empty summary', async () => {
    expect((await createCase({ title: 'No summary yet' })).status).toBe('draft')
  })

  it('validates the fields', async () => {
    const error = async (body: Record<string, unknown>) =>
      (await prof.post(baseUrl()).send({ importantFacts: sampleFacts, ...body })).body.error

    expect(await error({ title: '   ' })).toBe('Case title is required.')
    expect(await error({ title: 'x'.repeat(121) })).toBe('Case title must be at most 120 characters.')
    expect(await error({ title: 'Ok', summary: 'x'.repeat(2001) })).toBe(
      'Summary must be at most 2000 characters.',
    )
    expect(await error({ title: 'Ok', status: 'archived' })).toBe('Choose a valid status.')
  })

  it('needs at least one important fact for each side', async () => {
    const error = async (importantFacts: unknown) =>
      (await prof.post(baseUrl()).send({ title: 'Ok', importantFacts })).body.error

    expect(await error(undefined)).toBe('List at least one important fact for the plaintiff.')
    expect(await error({ plaintiff: ['  '], defense: ['A fact.'] })).toBe(
      'List at least one important fact for the plaintiff.',
    )
    expect(await error({ plaintiff: ['A fact.'], defense: [] })).toBe('List at least one important fact for the defense.')
    expect(await error({ plaintiff: 'A fact.', defense: ['A fact.'] })).toBe("List the plaintiff's important facts as text.")
    expect(await error({ plaintiff: ['A fact.'], defense: [3] })).toBe("List the defense's important facts as text.")
    expect(await error({ plaintiff: Array(21).fill('A fact.'), defense: ['A fact.'] })).toBe(
      'List at most 20 important facts for the plaintiff.',
    )
    expect(await error({ plaintiff: ['x'.repeat(501)], defense: ['A fact.'] })).toBe(
      'Each important fact must be at most 500 characters.',
    )
    expect((await prof.get(baseUrl())).body.cases).toEqual([])
  })
})

describe('important facts', () => {
  it('can be changed when editing, and also have to be kept', async () => {
    const { id } = await createCase()
    const edit = (importantFacts: unknown) =>
      prof.patch(`${baseUrl()}/${id}`).send({ ...coaster, status: 'draft', importantFacts })

    const res = await edit({ plaintiff: ['The light was red.', 'Nobody checked the bar.'], defense: ['It passed inspection.'] })
    expect(res.body.case.importantFacts).toEqual({
      plaintiff: ['The light was red.', 'Nobody checked the bar.'],
      defense: ['It passed inspection.'],
    })
    expect((await edit({ plaintiff: ['The light was red.'] })).body.error).toBe(
      'List at least one important fact for the defense.',
    )
    expect((await prof.get(`${baseUrl()}/${id}`)).body.case.importantFacts.plaintiff).toHaveLength(2)
  })

  it('survive launch and are never shown to students', async () => {
    const { id } = await createCase()
    await prof.post(`/api/courses/${course.id}/roster`).send({ emails: ['ada@example.com', 'ben@example.com'] })
    // On the roster, so signing up enrolls them.
    const student = (await signedInAgent('student', 'ada@example.com')).agent
    const caseUrl = `${baseUrl()}/${id}`
    const t1 = (await prof.post(`${caseUrl}/teams`).send({ emails: ['ada@example.com'] })).body.teams[0].id
    const t2 = (await prof.post(`${caseUrl}/teams`).send({ emails: ['ben@example.com'] })).body.teams[1].id
    await prof.post(`${caseUrl}/matchups`).send({ plaintiffTeamId: t1, defenseTeamId: t2 })
    await pool.query(
      `INSERT INTO case_materials (case_id, filename, content_type, size_bytes, storage_key)
       VALUES ($1, 'Fact pattern.pdf', 'application/pdf', 1, 'k')`,
      [id],
    )

    const launched = await prof.post(`${caseUrl}/launch`)
    expect(launched.body.case).toMatchObject({ status: 'active', importantFacts: sampleFacts })

    const seen = [
      await student.get(`/api/courses/${course.id}/my-cases`),
      await student.get(`/api/courses/${course.id}/my-cases/${id}`),
      await student.get(`/api/courses/${course.id}/home`),
    ]
    for (const res of seen) {
      expect(res.status).toBe(200)
      const text = JSON.stringify(res.body)
      expect(text).not.toContain('importantFacts')
      expect(text).not.toContain(sampleFacts.plaintiff[0])
    }
  })
})

describe('editing and deleting', () => {
  it('updates the title, summary, and status', async () => {
    const { id } = await createCase()

    const res = await prof
      .patch(`${baseUrl()}/${id}`)
      .send({ importantFacts: sampleFacts, title: 'Rivera v. Thrill Park LLC', summary: 'Updated.', status: 'active' })

    expect(res.status).toBe(200)
    expect(res.body.case).toMatchObject({ title: 'Rivera v. Thrill Park LLC', summary: 'Updated.', status: 'active' })
    expect((await prof.get(`${baseUrl()}/${id}`)).body.case).toEqual(res.body.case)
  })

  it('requires the status on edits, so an active case is not reset to draft', async () => {
    const { id } = await createCase({ ...coaster, status: 'active' })

    const res = await prof.patch(`${baseUrl()}/${id}`).send({ title: 'Renamed' })

    expect(res.status).toBe(400)
    expect((await prof.get(`${baseUrl()}/${id}`)).body.case.status).toBe('active')
  })

  it('deletes a case', async () => {
    const { id } = await createCase()

    expect((await prof.delete(`${baseUrl()}/${id}`)).status).toBe(204)
    expect((await prof.get(`${baseUrl()}/${id}`)).status).toBe(404)
    expect((await prof.get(baseUrl())).body.cases).toEqual([])
  })

  it('returns 404 for unknown or malformed case ids', async () => {
    const missing = '00000000-0000-4000-8000-000000000000'

    expect((await prof.get(`${baseUrl()}/${missing}`)).status).toBe(404)
    expect((await prof.patch(`${baseUrl()}/not-a-uuid`).send({ ...coaster, status: 'draft' })).status).toBe(404)
    expect((await prof.delete(`${baseUrl()}/${missing}`)).body.error).toBe('Case not found.')
  })

  it('is removed with its course', async () => {
    await createCase()

    await prof.delete(`/api/courses/${course.id}`)

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM cases')
    expect(rows[0].n).toBe(0)
  })
})

describe('access', () => {
  it("hides one course's cases from another course's instructor", async () => {
    const { id } = await createCase()
    const other = (await signedInAgent('instructor', 'other@example.com')).agent
    const otherCourse = await createCourseAs(other)

    expect((await other.get(baseUrl())).status).toBe(404)
    expect((await other.get(`${baseUrl()}/${id}`)).status).toBe(404)
    // Nor can a case be reached through a course the instructor does teach.
    expect((await other.get(`/api/courses/${otherCourse.id}/cases/${id}`)).status).toBe(404)
    expect((await other.delete(`/api/courses/${otherCourse.id}/cases/${id}`)).status).toBe(404)
  })

  it('is closed to students, even enrolled ones', async () => {
    const { agent: student } = await signedInAgent('student', 'ada@example.com')
    await student.post('/api/courses/join').send({ entryCode: course.entryCode })

    expect((await student.get(baseUrl())).status).toBe(404)
    expect((await student.post(baseUrl()).send(coaster)).status).toBe(404)
  })
})
