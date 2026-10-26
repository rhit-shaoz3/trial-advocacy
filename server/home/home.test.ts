import type request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/pool.ts'
import { createCourseAs, resetDatabase, sampleFacts, signedInAgent, uploadCaseFile } from '../test/helpers.ts'

let prof: request.Agent
let course: { id: string }
let caseId: string
const email = (n: number) => `s${n}@example.com`
const caseUrl = () => `/api/courses/${course.id}/cases/${caseId}`

beforeEach(async () => {
  await resetDatabase()
  prof = (await signedInAgent('instructor', 'prof@example.com', 'Prof. Ruiz')).agent
  course = await createCourseAs(prof)
  await prof.post(`/api/courses/${course.id}/roster`).send({ emails: [1, 2, 3, 4].map(email) })
  caseId = (await prof.post(`/api/courses/${course.id}/cases`).send({ importantFacts: sampleFacts, summary: 'A test case.', title: 'Rivera v. Thrill Park' })).body.case.id
  const initial = (await uploadCaseFile(prof, caseUrl(), 'Fact pattern.pdf', { audience: 'all' })).body.material.id
  await prof.put(`${caseUrl()}/materials/initial`).send({ materialId: initial })
  await prof.post(`${caseUrl()}/teams`).send({ emails: [email(1), email(2)] })
  const { teams } = (await prof.post(`${caseUrl()}/teams`).send({ emails: [email(3), email(4)] })).body
  await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: teams[0].id, defenseTeamId: teams[1].id })
})

afterAll(async () => {
  await pool.end()
})

describe('the main dashboard', () => {
  it("shows the instructor their active cases, and that they're up to date", async () => {
    expect((await prof.get('/api/home')).body.activeCases).toEqual([])
    await prof.post(`${caseUrl()}/launch`)

    const home = (await prof.get('/api/home')).body
    expect(home.activeCases).toEqual([
      expect.objectContaining({
        id: caseId,
        title: 'Rivera v. Thrill Park',
        courseId: course.id,
        courseCode: 'LAW 540',
        phase: 'introduction',
        phases: ['introduction', 'investigate', 'deposition'],
        worldCount: 1,
        teamCount: 2,
      }),
    ])
    expect(home.todos).toEqual({ count: 0, latest: [] })
  })

  it("shows a student their cases and their team's open tasks, soonest due first", async () => {
    await prof.post(`${caseUrl()}/tasks`).send({ title: 'Later', dueAt: '2027-01-02T00:00:00.000Z' })
    const soon = (await prof.post(`${caseUrl()}/tasks`).send({ title: 'Read the fact pattern', dueAt: '2026-12-01T00:00:00.000Z' })).body.task
    await prof.post(`${caseUrl()}/launch`)
    const { agent: student } = await signedInAgent('student', email(1), 'Ada Lawyer')

    const home = (await student.get('/api/home')).body
    expect(home.activeCases).toEqual([
      expect.objectContaining({ id: caseId, courseCode: 'LAW 540', side: 'plaintiff', teamNumber: 1, phase: 'introduction' }),
    ])
    expect(home.todos.count).toBe(2)
    expect(home.todos.latest.map((t: { title: string }) => t.title)).toEqual(['Read the fact pattern', 'Later'])
    expect(home.todos.latest[0]).toMatchObject({ kind: 'task', caseId, courseId: course.id, detail: 'LAW 540 · Rivera v. Thrill Park' })

    // Done is done for the whole team.
    await student.put(`/api/courses/${course.id}/my-cases/${caseId}/tasks/${soon.id}`).send({ done: true })
    const { agent: teammate } = await signedInAgent('student', email(2), 'Ben Partner')
    expect((await teammate.get('/api/home')).body.todos.count).toBe(1)
  })

  it('is only for signed-in users', async () => {
    const request = (await import('supertest')).default
    const { app } = await import('../app.ts')
    expect((await request(app).get('/api/home')).status).toBe(401)
  })
})
