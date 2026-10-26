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
  const res = await prof.post(baseUrl()).send({ importantFacts: sampleFacts, summary: coaster.summary, ...input })
  if (res.status !== 201) throw new Error(`Create case failed: ${JSON.stringify(res.body)}`)
  return res.body.case as { id: string; status: string }
}

describe('creating', () => {
  it('names the parties, which an edit keeps unless it renames them', async () => {
    const res = await prof.post(baseUrl()).send({
      title: 'Winston v. Thrillville',
      summary: 'A rider was hurt.',
      plaintiffName: ' Paige Winston ',
      defendantName: 'Thrillville Parks LLC',
    })
    expect(res.body.case.parties).toEqual({ plaintiff: 'Paige Winston', defendant: 'Thrillville Parks LLC' })
    const url = `${baseUrl()}/${res.body.case.id}`
    const edited = await prof.patch(url).send({ title: 'Winston v. Thrillville Parks', summary: 'x', status: 'draft' })
    expect(edited.body.case.parties).toEqual({ plaintiff: 'Paige Winston', defendant: 'Thrillville Parks LLC' })
    const missing = await prof.post(baseUrl()).send({ title: 'X', summary: 'y', plaintiffName: 'Ann', defendantName: ' ' })
    expect(missing.status).toBe(400)
    expect(missing.body.error).toBe('Name the defendant.')
  })

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
      phase: 'introduction',
      instructorNote: '',
      inWorldDate: null,
      disputedIssues: '',
      // Not named, so they come from the "X v. Y" title.
      parties: { plaintiff: 'Rivera', defendant: 'Thrill Park' },
      importantFacts: { plaintiff: ['The lap bar light was red.'], defense: ['It passed inspection.'] },
      // A new case starts the guided setup.
      setupStep: 'details',
      setupCompletedAt: null,
      investigator: { enabled: true, name: 'John Hastings', instructions: '' },
      exchangeReady: false,
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

  it('needs a description, though older cases can still be saved without one', async () => {
    const res = await prof.post(baseUrl()).send({ title: 'No summary yet', summary: '   ' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Add a short description of the case.')

    const { id } = await createCase()
    const edited = await prof.patch(`${baseUrl()}/${id}`).send({ title: 'Rivera', summary: '', status: 'draft' })
    expect(edited.body.case.summary).toBe('')
  })

  it('validates the fields', async () => {
    const error = async (body: Record<string, unknown>) =>
      (await prof.post(baseUrl()).send({ importantFacts: sampleFacts, summary: coaster.summary, ...body })).body.error

    expect(await error({ title: '   ' })).toBe('Case title is required.')
    expect(await error({ title: 'x'.repeat(121) })).toBe('Case title must be at most 120 characters.')
    expect(await error({ title: 'Ok', summary: 'x'.repeat(2001) })).toBe(
      'Summary must be at most 2000 characters.',
    )
    expect(await error({ title: 'Ok', status: 'archived' })).toBe('Choose a valid status.')
  })

  it('can start without important facts, for the guided setup to add later', async () => {
    const none = await prof.post(baseUrl()).send({ title: 'Ok', summary: coaster.summary })
    expect(none.status).toBe(201)
    expect(none.body.case.importantFacts).toEqual({ plaintiff: [], defense: [] })
    const blank = await prof.post(baseUrl()).send({ title: 'Ok', summary: coaster.summary, importantFacts: { plaintiff: ['  '], defense: [] } })
    expect(blank.body.case.importantFacts).toEqual({ plaintiff: [], defense: [] })
  })

  it('checks the important facts it is given', async () => {
    const error = async (importantFacts: unknown) =>
      (await prof.post(baseUrl()).send({ title: 'Ok', summary: coaster.summary, importantFacts })).body.error

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
  it('can be changed when editing, and are kept when an edit leaves them out', async () => {
    const { id } = await createCase()
    const edit = (importantFacts: unknown) =>
      prof.patch(`${baseUrl()}/${id}`).send({ ...coaster, status: 'draft', importantFacts })

    const res = await edit({ plaintiff: ['The light was red.', 'Nobody checked the bar.'], defense: ['It passed inspection.'] })
    expect(res.body.case.importantFacts).toEqual({
      plaintiff: ['The light was red.', 'Nobody checked the bar.'],
      defense: ['It passed inspection.'],
    })
    const without = await edit(undefined)
    expect(without.body.case.importantFacts.plaintiff).toHaveLength(2)
    expect((await edit({ plaintiff: ['The light was red.'] })).body.case.importantFacts).toEqual({
      plaintiff: ['The light was red.'],
      defense: [],
    })
  })

  it("can't all be removed from a launched case", async () => {
    const { id } = await createCase()
    const res = await prof.patch(`${baseUrl()}/${id}`).send({ ...coaster, status: 'active', importantFacts: { plaintiff: ['A fact.'], defense: [] } })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('List at least one important fact for the defense.')
  })

  it('are needed for both sides before launch', async () => {
    const { id } = await createCase({ title: 'No facts', importantFacts: undefined })
    const { checks } = (await prof.get(`${baseUrl()}/${id}/launch`)).body
    expect(checks[0]).toEqual({ key: 'importantFacts', ok: false, message: 'Add at least one important fact for each side.' })

    await prof.patch(`${baseUrl()}/${id}`).send({ ...coaster, status: 'draft', importantFacts: sampleFacts })
    const after = (await prof.get(`${baseUrl()}/${id}/launch`)).body.checks[0]
    expect(after).toEqual({ key: 'importantFacts', ok: true, message: 'Important facts: 1 for the plaintiff, 1 for the defense.' })
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
      `INSERT INTO case_materials (case_id, filename, content_type, size_bytes, storage_key, initial)
       VALUES ($1, 'Fact pattern.pdf', 'application/pdf', 1, 'k', true)`,
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

describe('the guided setup', () => {
  it('remembers the furthest step reached, never going back', async () => {
    const { id } = await createCase()
    const reach = (step: string) => prof.put(`${baseUrl()}/${id}/setup`).send({ step })

    expect((await reach('teams')).body.case.setupStep).toBe('teams')
    expect((await reach('facts')).body.case.setupStep).toBe('teams')
    expect((await reach('tasks')).body.case.setupStep).toBe('tasks')
    expect((await reach('launch')).status).toBe(400)
  })

  it('finishes once', async () => {
    const { id } = await createCase()

    const done = await prof.post(`${baseUrl()}/${id}/setup/complete`)
    expect(done.body.case.setupCompletedAt).toEqual(expect.any(String))
    const again = await prof.post(`${baseUrl()}/${id}/setup/complete`)
    expect(again.body.case.setupCompletedAt).toBe(done.body.case.setupCompletedAt)
  })

  it('is only for the case’s instructor', async () => {
    const { id } = await createCase()
    const other = (await signedInAgent('instructor', 'other@example.com')).agent

    expect((await other.put(`${baseUrl()}/${id}/setup`).send({ step: 'facts' })).status).toBe(404)
    expect((await other.post(`${baseUrl()}/${id}/setup/complete`)).status).toBe(404)
  })
})

