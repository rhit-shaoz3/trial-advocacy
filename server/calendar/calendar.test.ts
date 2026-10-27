import type request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/pool.ts'
import { createCourseAs, resetDatabase, sampleFacts, signedInAgent, uploadCaseFile } from '../test/helpers.ts'

let prof: request.Agent
let ada: request.Agent
let ben: request.Agent
let cy: request.Agent
let course: { id: string }
let caseId: string
const email = (n: number) => `s${n}@example.com`
const caseUrl = () => `/api/courses/${course.id}/cases/${caseId}`
const calendarUrl = () => `/api/courses/${course.id}/calendar`
const titles = async (agent: request.Agent) =>
  ((await agent.get(calendarUrl())).body.items as { title: string }[]).map((i) => i.title)

beforeEach(async () => {
  await resetDatabase()
  prof = (await signedInAgent('instructor', 'prof@example.com', 'Prof. Ruiz')).agent
  course = await createCourseAs(prof)
  await prof.post(`/api/courses/${course.id}/roster`).send({ emails: [1, 2, 3, 4].map(email) })
  caseId = (await prof.post(`/api/courses/${course.id}/cases`).send({ importantFacts: sampleFacts, summary: 'A test case.', title: 'Rivera v. Thrill Park' })).body.case.id
  const initial = (await uploadCaseFile(prof, caseUrl(), 'Fact pattern.pdf', { audience: 'all' })).body.material.id
  await prof.put(`${caseUrl()}/materials/initial`).send({ materialId: initial })
  // Ada and Ben (plaintiff) v Cy and s4 (defense).
  await prof.post(`${caseUrl()}/teams`).send({ emails: [email(1), email(2)] })
  const { teams } = (await prof.post(`${caseUrl()}/teams`).send({ emails: [email(3), email(4)] })).body
  await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: teams[0].id, defenseTeamId: teams[1].id })
  await prof.post(`${caseUrl()}/tasks`).send({ title: 'Outline the deposition', dueAt: '2026-11-20T23:59:00.000Z' })
  await prof.post(`${caseUrl()}/tasks`).send({ title: 'Defense brief', dueAt: '2026-11-21T23:59:00.000Z', audience: 'defense' })
  await prof.post(`${caseUrl()}/launch`)
  ada = (await signedInAgent('student', email(1), 'Ada Lawyer')).agent
  ben = (await signedInAgent('student', email(2), 'Ben Partner')).agent
  cy = (await signedInAgent('student', email(3), 'Cy Counsel')).agent
})

afterAll(async () => {
  await pool.end()
})

describe('the course calendar', () => {
  it('puts tasks on their due dates, by side, with whether the team is done', async () => {
    const { items } = (await ada.get(calendarUrl())).body
    expect(items).toEqual([
      expect.objectContaining({ kind: 'task', title: 'Outline the deposition', date: '2026-11-20', caseTitle: 'Rivera v. Thrill Park', done: false, mine: false }),
    ])
    expect(await titles(cy)).toEqual(['Outline the deposition', 'Defense brief'])
    expect(await titles(prof)).toEqual(['Outline the deposition', 'Defense brief'])
  })

  it('shows case dates to the case, personal events to their maker, and team events to the team', async () => {
    expect((await prof.post(`${calendarUrl()}/events`).send({ kind: 'case', caseId, title: 'Depositions begin', date: '2026-12-01' })).status).toBe(201)
    await ada.post(`${calendarUrl()}/events`).send({ kind: 'personal', title: 'Read the depositions', date: '2026-11-25' })
    await ada.post(`${calendarUrl()}/events`).send({ kind: 'team', caseId, title: 'Team prep meeting', notes: 'Library room 2', date: '2026-11-26' })

    expect(await titles(ada)).toEqual(['Outline the deposition', 'Read the depositions', 'Team prep meeting', 'Depositions begin'])
    // Ben is on Ada's team: he sees the team event, not her personal one.
    expect(await titles(ben)).toEqual(['Outline the deposition', 'Team prep meeting', 'Depositions begin'])
    // The other team sees only the case date; the instructor doesn't see students' events.
    expect(await titles(cy)).toEqual(['Outline the deposition', 'Defense brief', 'Depositions begin'])
    expect(await titles(prof)).toEqual(['Outline the deposition', 'Defense brief', 'Depositions begin'])

    const team = (await ben.get(calendarUrl())).body.items.find((i: { title: string }) => i.title === 'Team prep meeting')
    expect(team).toMatchObject({ kind: 'team', teamNumber: 1, notes: 'Library room 2', mine: false })
  })

  it('lets only the maker change or delete an event, and checks who can make what', async () => {
    const mine = (await ada.post(`${calendarUrl()}/events`).send({ kind: 'team', caseId, title: 'Prep', date: '2026-11-26' })).body.items
    const id = mine.find((i: { title: string }) => i.title === 'Prep').id

    expect((await ben.put(`${calendarUrl()}/events/${id}`).send({ title: 'Mine now', date: '2026-11-27' })).status).toBe(404)
    expect((await ben.delete(`${calendarUrl()}/events/${id}`)).status).toBe(404)
    const moved = await ada.put(`${calendarUrl()}/events/${id}`).send({ title: 'Prep meeting', date: '2026-11-27' })
    expect(moved.body.items.find((i: { id: string }) => i.id === id)).toMatchObject({ title: 'Prep meeting', date: '2026-11-27', mine: true })
    expect((await ada.delete(`${calendarUrl()}/events/${id}`)).status).toBe(200)

    expect((await ada.post(`${calendarUrl()}/events`).send({ kind: 'case', caseId, title: 'Mine', date: '2026-11-26' })).status).toBe(403)
    expect((await ada.post(`${calendarUrl()}/events`).send({ kind: 'personal', title: '', date: '2026-11-26' })).status).toBe(400)
    expect((await ada.post(`${calendarUrl()}/events`).send({ kind: 'personal', title: 'X', date: 'soon' })).status).toBe(400)
    const stranger = (await signedInAgent('student', 'stranger@example.com', 'Stranger')).agent
    expect((await stranger.get(calendarUrl())).status).toBe(404)
  })
})
