import type request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/pool.ts'
import { createCourseAs, resetDatabase, sampleFacts, signedInAgent, uploadCaseFile } from '../test/helpers.ts'

let prof: request.Agent
let ada: request.Agent
let course: { id: string; entryCode: string }
let caseId: string
let draftId: string

const DAY = 24 * 60 * 60 * 1000
const email = (n: number) => `s${n}@example.com`
const caseUrl = (id = caseId) => `/api/courses/${course.id}/cases/${id}`
const home = async (agent = prof) => (await agent.get(`/api/courses/${course.id}/home`)).body

beforeEach(async () => {
  await resetDatabase()
  prof = (await signedInAgent('instructor', 'prof@example.com', 'Prof. Ruiz')).agent
  course = await createCourseAs(prof)
  await prof.post(`/api/courses/${course.id}/roster`).send({ emails: [1, 2, 3, 4].map(email) })
  ada = (await signedInAgent('student', email(1), 'Ada Lawyer')).agent
  for (const n of [2, 3, 4]) await signedInAgent('student', email(n))

  // An active case: World A is Team 1 (plaintiff) v Team 2 (defense).
  caseId = (await prof.post(`/api/courses/${course.id}/cases`).send({ title: 'Rivera v. Thrill Park', importantFacts: sampleFacts, summary: 'A test case.' })).body.case.id
  const t1 = (await prof.post(`${caseUrl()}/teams`).send({ emails: [email(1), email(2)] })).body.teams[0].id
  const t2 = (await prof.post(`${caseUrl()}/teams`).send({ emails: [email(3), email(4)] })).body.teams[1].id
  await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: t1, defenseTeamId: t2 })
  const complaint = (await uploadCaseFile(prof, caseUrl(), 'Complaint.pdf')).body.material.id
  await prof.put(`${caseUrl()}/materials/initial`).send({ materialId: complaint })
  const log = (await uploadCaseFile(prof, caseUrl(), 'Accident log.pdf')).body.material.id
  const now = Date.now()
  const task = (title: string, dueIn: number, audience = 'all') =>
    prof.post(`${caseUrl()}/tasks`).send({ title, dueAt: new Date(now + dueIn).toISOString(), audience })
  const overdue = (await task('Read the complaint', -DAY)).body.task.id
  await task('Plaintiff memo', DAY, 'plaintiff')
  await task('Defense memo', 2 * DAY, 'defense')
  expect((await prof.post(`${caseUrl()}/launch`)).status).toBe(200)
  await ada.put(`/api/courses/${course.id}/my-cases/${caseId}/tasks/${overdue}`).send({ done: true })

  // The accident log couldn't be read for the AI witnesses.
  await pool.query(`UPDATE case_materials SET text_status = 'failed', text_error = 'x' WHERE id = $1`, [log])

  // Team 1 interviewed a witness; the instructor's own test run doesn't count.
  const witness = (await prof.post(`${caseUrl()}/witnesses`).send({ name: 'Elena Torres' })).body.witness.id
  for (const teamId of [t1, null]) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO interviews (witness_id, team_id, side, ended_at) VALUES ($1, $2, 'plaintiff', now()) RETURNING id`,
      [witness, teamId],
    )
    await pool.query(
      `INSERT INTO interview_turns (interview_id, position, question, reply, answer, model)
       VALUES ($1, 0, 'Where were you?', 'At the booth.', 'At the booth.', 'claude-haiku-5-5')`,
      [rows[0].id],
    )
  }

  // A draft nobody is paired for yet, and a student added after launch who hasn't signed up.
  draftId = (await prof.post(`/api/courses/${course.id}/cases`).send({ title: 'Practice case', importantFacts: sampleFacts, summary: 'A test case.' })).body.case.id
  await prof.post(`/api/courses/${course.id}/roster`).send({ emails: [email(5)] })
})

afterAll(async () => {
  await pool.end()
})

describe("the instructor's dashboard", () => {
  it('sums up the course: students signed up, cases, questions this week, reviews waiting', async () => {
    expect((await home()).instructor.stats).toEqual({
      studentsJoined: 4,
      studentsOnRoster: 5,
      activeCases: 1,
      draftCases: 1,
      questionsThisWeek: 1,
      reviewsWaiting: 0,
    })
  })

  it("monitors every case: a draft's launch checklist, an active case's phase and teams caught up", async () => {
    const { cases } = (await home()).instructor
    expect(cases).toEqual([
      {
        id: draftId,
        title: 'Practice case',
        status: 'draft',
        phase: 'introduction',
        investigatorEnabled: true,
        exchangeReady: false,
        worldCount: 0,
        launch: { ready: 1, total: 4, next: 'Pair students into teams.' },
        tasks: null,
      },
      {
        id: caseId,
        title: 'Rivera v. Thrill Park',
        status: 'active',
        phase: 'introduction',
        investigatorEnabled: true,
        exchangeReady: false,
        worldCount: 1,
        launch: null,
        // One task is due so far, and only Team 1 has done it; each team has two tasks in all.
        tasks: { due: 1, teamsDoneDue: 1, assigned: 2, teamsDoneAll: 0, teams: 2 },
      },
    ])
  })

  it("lists what's waiting on the instructor, each with where to fix it", async () => {
    const { attention } = (await home()).instructor
    expect(attention.map((a: { kind: string; text: string; target: unknown }) => [a.kind, a.text, a.target])).toEqual([
      [
        'transcription',
        "Rivera v. Thrill Park: 1 file couldn't be read for the AI witnesses.",
        { page: 'case', caseId, tab: 'materials' },
      ],
      ['roster', "1 student on your roster hasn't signed up yet.", { page: 'manage' }],
      ['launch', "Practice case isn't ready to launch: Pair students into teams.", { page: 'case', caseId: draftId }],
    ])
  })

  it('lists upcoming deadlines, soonest first, with how many of the teams they are for have finished', async () => {
    const { deadlines } = (await home()).instructor
    expect(deadlines.map((d: { title: string; teamsDone: number; teams: number }) => [d.title, d.teamsDone, d.teams])).toEqual([
      ['Plaintiff memo', 0, 1],
      ['Defense memo', 0, 1],
    ])
  })

  it("shows what teams and students did, newest first, without the instructor's test runs", async () => {
    const { activity } = (await home()).instructor
    const lines = activity.map((a: { actor: string | null; action: string }) => [a.actor, a.action].filter(Boolean).join(' '))
    expect(lines).toEqual(
      expect.arrayContaining([
        'Team 1 ended an interview with Elena Torres',
        'Team 1 started interviewing Elena Torres',
        'Ada Lawyer completed “Read the complaint” for Team 1',
        '4 students joined the course',
      ]),
    )
    expect(lines).toHaveLength(4)
    const times = activity.map((a: { at: string }) => a.at)
    expect([...times].sort().reverse()).toEqual(times)
  })

  it('is only for the instructor', async () => {
    expect(await home(ada)).not.toHaveProperty('instructor')
  })
})
