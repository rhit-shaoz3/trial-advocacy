import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ai } from '../ai/ai.ts'
import { app } from '../app.ts'
import { transcriptionsSettled } from '../courses/materialText.ts'
import { pool } from '../db/pool.ts'
import { createCourseAs, resetDatabase, sampleFacts, signedInAgent, uploadCaseFile } from '../test/helpers.ts'
import { setupDemo } from './demo.ts'
import { DEMO_SUBPOENA, DEPOSITION, LIVE_QUESTIONS } from './script.ts'

// The demo account (demo@demo.com) and its case world, built from a small
// Thrillville stand-in. Claude is faked (server/test/fakeAi.ts).

let witnessAsked: string[]

beforeEach(async () => {
  await resetDatabase()
  const prof = (await signedInAgent('instructor', 'prof@example.com')).agent
  const course = await createCourseAs(prof)
  const caseUrl = `/api/courses/${course.id}/cases/${(await prof.post(`/api/courses/${course.id}/cases`).send({ importantFacts: sampleFacts, title: 'Thrillville', summary: 'A rider fell.' })).body.case.id}`
  const upload = async (filename: string, audience: string) =>
    (await uploadCaseFile(prof, caseUrl, filename, { audience }, Buffer.from(filename))).body.material.id as string
  const complaint = await upload('Complaint.pdf', 'all')
  await upload('Internal investigation.pdf', 'defense')
  const statement = await upload('Winston statement.pdf', 'instructor')
  await prof.put(`${caseUrl}/materials/initial`).send({ materialId: complaint })
  await transcriptionsSettled()
  await prof.post(`${caseUrl}/witnesses`).send({
    name: 'Paige Winston',
    role: 'Rider',
    description: 'Was on the ride.',
    alignedSide: 'plaintiff',
    depositionMaterialId: statement,
    defendingCounsel: 'Ms. Park',
  })
  await setupDemo(caseUrl.split('/').at(-1)!)

  witnessAsked = []
  ai.askWitness = async (options) => {
    witnessAsked.push(options.question)
    return { reply: 'I am not sure.', objection: null, answer: 'I am not sure.', model: 'fake-model', usage: {} as never }
  }
})

afterAll(async () => {
  await pool.end()
})

async function demoAgent() {
  const agent = request.agent(app)
  const res = await agent.post('/api/auth/login').send({ email: 'demo@demo.com', password: 'password' })
  expect(res.status).toBe(200)
  return { agent, demo: res.body.user.demo as { as: string; courseId: string; caseId: string } }
}

describe('the demo account', () => {
  it('switches between the instructor and the student of one case', async () => {
    const { agent, demo } = await demoAgent()
    expect(demo).toMatchObject({ as: 'instructor', courseId: expect.any(String), caseId: expect.any(String) })

    const student = await agent.post('/api/demo/switch').send({ as: 'student' })
    expect(student.body.user).toMatchObject({ role: 'student', email: 'demo.student@demo.com', demo: { as: 'student', caseId: demo.caseId } })
    const workspace = (await agent.get(`/api/courses/${demo.courseId}/my-cases/${demo.caseId}`)).body.workspace
    expect(workspace).toMatchObject({ case: { phase: 'introduction', status: 'active' }, world: { side: 'defense' } })

    const back = await agent.post('/api/demo/switch').send({ as: 'instructor' })
    expect(back.body.user).toMatchObject({ role: 'instructor', demo: { as: 'instructor' } })
    expect((await agent.get('/api/auth/me')).body.user.role).toBe('instructor')
  })

  it("starts with the source case's files for each side, and its exchange set up", async () => {
    const { demo } = await demoAgent()
    const { rows } = await pool.query<{ filename: string; audience: string }>(
      'SELECT filename, audience FROM case_materials WHERE case_id = $1 ORDER BY filename',
      [demo.caseId],
    )
    expect(rows).toEqual([
      { filename: 'Complaint.pdf', audience: 'all' },
      { filename: 'Internal investigation.pdf', audience: 'defense' },
      { filename: 'Winston statement.pdf', audience: 'instructor' },
    ])
  })

  it('is only for a demo session', async () => {
    const { agent } = await signedInAgent('instructor', 'other@example.com')
    expect((await agent.get('/api/demo/script')).status).toBe(404)
    expect((await agent.post('/api/demo/switch').send({ as: 'student' })).status).toBe(404)
    expect((await agent.get('/api/auth/me')).body.user.demo).toBeNull()
    expect((await request(app).get('/api/demo/script')).status).toBe(401)
  })

  it('sends the subpoena example and the live questions', async () => {
    const { agent } = await demoAgent()
    expect((await agent.get('/api/demo/script')).body.script).toEqual({
      subpoena: DEMO_SUBPOENA,
      questions: DEPOSITION.slice(0, LIVE_QUESTIONS).map((t) => t.question),
    })
  })
})

describe('the demo deposition', () => {
  it('answers the scripted questions from the script, and sends the whole deposition for review', async () => {
    const { agent, demo } = await demoAgent()
    await agent.put(`/api/courses/${demo.courseId}/cases/${demo.caseId}/phase`).send({ phase: 'deposition' }).expect(200)
    await agent.post('/api/demo/switch').send({ as: 'student' })
    const { rows: [witness] } = await pool.query<{ id: string }>('SELECT id FROM case_witnesses WHERE case_id = $1', [demo.caseId])
    const url = `/api/courses/${demo.courseId}/my-cases/${demo.caseId}/witnesses/${witness.id}/interview`

    const objected = DEPOSITION.find((t) => t.objection)!
    let interview = (await agent.post(`${url}/questions`).send({ question: DEPOSITION[0].question })).body.interview
    interview = (await agent.post(`${url}/questions`).send({ question: objected.question })).body.interview
    interview = (await agent.post(`${url}/questions`).send({ question: 'What color was the raft?' })).body.interview
    expect(witnessAsked).toEqual(['What color was the raft?'])
    expect(interview.turns.map((t: { objection: string | null; answer: string }) => [t.objection, t.answer])).toEqual([
      [null, DEPOSITION[0].answer],
      [objected.objection, objected.answer],
      [null, 'I am not sure.'],
    ])

    expect((await agent.post(`${url}/end`)).body.sentForReview).toBe(true)
    const { rows: turns } = await pool.query<{ question: string }>(
      `SELECT t.question FROM interview_turns t JOIN interviews i ON i.id = t.interview_id
       WHERE i.witness_id = $1 ORDER BY t.position`,
      [witness.id],
    )
    // The two scripted questions it asked, the one of its own, then the rest of the script.
    expect(turns).toHaveLength(DEPOSITION.length + 1)
    expect(turns.slice(3).map((t) => t.question)).toEqual(
      DEPOSITION.filter((t) => t !== DEPOSITION[0] && t !== objected).map((t) => t.question),
    )
  })

  it('reset rebuilds the case world from the start', async () => {
    const { agent, demo } = await demoAgent()
    await agent.put(`/api/courses/${demo.courseId}/cases/${demo.caseId}/phase`).send({ phase: 'deposition' }).expect(200)
    const reset = (await agent.post('/api/demo/reset')).body.user.demo
    expect(reset.caseId).not.toBe(demo.caseId)
    const { rows } = await pool.query('SELECT phase, phase_entered_at, is_demo FROM cases WHERE course_id = $1', [demo.courseId])
    expect(rows).toEqual([{ phase: 'introduction', phase_entered_at: null, is_demo: true }])
  })
})
