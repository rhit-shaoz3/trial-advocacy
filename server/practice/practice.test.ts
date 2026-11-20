import type request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ai } from '../ai/ai.ts'
import { transcriptionsSettled } from '../courses/materialText.ts'
import { pool } from '../db/pool.ts'
import { claimsSettled } from '../witness/memory.ts'
import { createCourseAs, resetDatabase, sampleFacts, signedInAgent, uploadCaseFile } from '../test/helpers.ts'
import { parsePracticeReply, type PracticeReply } from './turn.ts'

// A student's practice sessions: their own, with a coach, opposing counsel
// and the judge, and none of it reaching the case.

let prof: request.Agent
let ada: request.Agent // plaintiff
let bo: request.Agent // Ada's partner
let cy: request.Agent // defense
let course: { id: string }
let caseId: string
let elena: string // a defense witness
let lin: string // a plaintiff witness
const files: Record<string, string> = {}

const email = (n: number) => `s${n}@example.com`
const caseUrl = () => `/api/courses/${course.id}/cases/${caseId}`
const practiceUrl = () => `/api/courses/${course.id}/my-cases/${caseId}/practice`

/** Every turn the fake got, and the replies it gives, in order. */
let asked: Parameters<typeof ai.practiceTurn>[0][]
let replies: string[]

async function upload(filename: string, text: string, audience = 'all') {
  const res = await uploadCaseFile(prof, caseUrl(), filename, { audience, description: filename.replace(/\.\w+$/, '') }, Buffer.from(text))
  files[filename] = res.body.material.id
}

async function witness(fields: Record<string, unknown>) {
  return (await prof.post(`${caseUrl()}/witnesses`).send({ role: 'Witness', ...fields })).body.witness.id as string
}

beforeEach(async () => {
  await resetDatabase()
  prof = (await signedInAgent('instructor', 'prof@example.com', 'Prof. Ruiz')).agent
  course = await createCourseAs(prof)
  await prof.post(`/api/courses/${course.id}/roster`).send({ emails: [1, 2, 3, 4].map(email) })
  ada = (await signedInAgent('student', email(1), 'Ada Lawyer')).agent
  bo = (await signedInAgent('student', email(2), 'Bo Partner')).agent
  cy = (await signedInAgent('student', email(3), 'Cy Counsel')).agent
  caseId = (await prof.post(`/api/courses/${course.id}/cases`).send({ importantFacts: sampleFacts, title: 'Rivera v. Thrill Park', summary: 'A rider fell.' })).body.case.id
  const { teams } = (await prof.post(`${caseUrl()}/teams`).send({ emails: [email(1), email(2)] })).body
  const defense = (await prof.post(`${caseUrl()}/teams`).send({ emails: [email(3), email(4)] })).body.teams[1]
  await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: teams[0].id, defenseTeamId: defense.id })
  await upload('Torres deposition.pdf', 'Q: Where were you? A: At the booth.', 'instructor')
  await upload('Lin deposition.pdf', 'Q: Did you see it? A: Yes.', 'instructor')
  await upload('Accident log.pdf', '6/10/19 | Atlas | Rider fell')
  await upload('Complaint.txt', 'Rivera alleges the operator left the booth.')
  await prof.put(`${caseUrl()}/materials/initial`).send({ materialId: files['Complaint.txt'] })
  await transcriptionsSettled()
  elena = await witness({ name: 'Elena Torres', alignedSide: 'defense', depositionMaterialId: files['Torres deposition.pdf'], defendingCounsel: 'Ms. Park' })
  lin = await witness({ name: 'Dr. Lin', alignedSide: 'plaintiff', depositionMaterialId: files['Lin deposition.pdf'] })
  expect((await prof.post(`${caseUrl()}/launch`)).status).toBe(200)

  asked = []
  replies = []
  ai.practiceTurn = async (options): Promise<PracticeReply> => {
    asked.push(structuredClone(options))
    const reply = replies.shift() ?? '<witness>I saw it.</witness>'
    return { reply, blocks: parsePracticeReply(reply, options.text), model: 'fake-model', usage: { input_tokens: 10, output_tokens: 5 } as never }
  }
})

afterAll(async () => {
  await pool.end()
})

const start = (agent: request.Agent, body: Record<string, unknown>) => agent.post(practiceUrl()).send({ goal: 'Get the timeline.', ...body })
const turn = (agent: request.Agent, id: string, body: Record<string, unknown>) => agent.post(`${practiceUrl()}/${id}/turns`).send(body)

describe('practice sessions', () => {
  it('offers each witness the settings that fit it, and needs a goal', async () => {
    // Dr. Lin is the plaintiff's own witness: interviewed, or examined on direct and redirect.
    expect((await start(ada, { witnessId: lin, type: 'cross' })).status).toBe(400)
    expect((await start(ada, { witnessId: lin, type: 'direct', goal: '  ' })).status).toBe(400)
    expect((await start(ada, { witnessId: lin, type: 'direct', cooperation: 'grumpy' })).status).toBe(400)
    const direct = await start(ada, { witnessId: lin, type: 'direct', cooperation: 'hostile', toneNotes: 'Nervous.', priorTestimony: 'Ignored on direct.' })
    expect(direct.status).toBe(201)
    expect(direct.body.session).toMatchObject({
      type: 'direct',
      goal: 'Get the timeline.',
      cooperation: 'hostile',
      toneNotes: 'Nervous.',
      priorTestimony: '',
      opposingCounsel: 'Opposing counsel',
      pending: null,
      canAsk: true,
      limit: { max: 5, used: 0 },
    })
    // The other side's witness is crossed or deposed, from the deposition phase on.
    expect((await start(ada, { witnessId: elena, type: 'cross' })).status).toBe(409)
    await prof.put(`${caseUrl()}/phase`).send({ phase: 'deposition' })
    expect((await start(ada, { witnessId: elena, type: 'direct' })).status).toBe(400)
    const cross = await start(ada, { witnessId: elena, type: 'cross', priorTestimony: 'She said she stayed in the booth.' })
    expect(cross.body.session).toMatchObject({ type: 'cross', priorTestimony: 'She said she stayed in the booth.' })
  })

  it('holds a leading question, then objects and rules, with the supplement’s labels', async () => {
    const id = (await start(ada, { witnessId: lin, type: 'direct' })).body.session.id
    replies = ['<coach kind="leading" quote="didn’t you">That suggests the answer.</coach>\n<hold/>']
    const held = await turn(ada, id, { kind: 'question', text: 'You saw the bar open, didn’t you?' })
    expect(held.body.session).toMatchObject({ pending: 'hold' })
    expect(held.body.session.turns[0].blocks).toMatchObject({ hold: true, witness: null, coach: [{ kind: 'leading', quote: 'didn’t you' }] })
    // A held question is edited or asked as written; nothing else.
    expect((await turn(ada, id, { kind: 'question', text: 'Something else?' })).status).toBe(409)

    replies = ['<objection by="Opposing counsel">Objection, leading.</objection>\n<await_response/>']
    const objected = await turn(ada, id, { kind: 'as_written', text: 'ignored' })
    expect(asked[1].kind).toBe('as_written')
    expect(asked[1].text).toBe('You saw the bar open, didn’t you?')
    expect(objected.body.session.pending).toBe('objection')

    replies = ['<ruling result="sustained">Sustained.</ruling>\n<coach kind="evidence" quote="preliminary">It isn’t preliminary; it’s the key fact.</coach>']
    const ruled = await turn(ada, id, { kind: 'objection_response', text: 'It’s preliminary, Your Honor.' })
    expect(ruled.body.session.pending).toBeNull()
    expect(ruled.body.session.turns[2]).toMatchObject({
      kind: 'objection_response',
      blocks: { ruling: { result: 'sustained', text: 'Sustained.' }, witness: null, coach: [{ kind: 'evidence', quote: 'preliminary' }] },
    })
    // The model gets the whole session so far, and the setting.
    expect(asked[2].transcript.map((t) => t.kind)).toEqual(['question', 'as_written'])
    expect(asked[2].practice).toMatchObject({ type: 'direct', goal: 'Get the timeline.', opposingCounselName: 'Opposing counsel' })
    expect(asked[2].profile.name).toBe('Dr. Lin')

    // A deposition keeps the witness's own lawyer; at trial, it's opposing counsel who objects.
    await prof.put(`${caseUrl()}/phase`).send({ phase: 'deposition' })
    for (const type of ['deposition', 'cross']) {
      const other = (await start(ada, { witnessId: elena, type })).body.session.id
      await turn(ada, other, { kind: 'question', text: 'Where were you?', exhibitIds: [files['Accident log.pdf']] })
    }
    expect(asked[3].settings.defendingCounselName).toBe('Ms. Park')
    expect(asked[4].settings.defendingCounselName).toBeUndefined()
    expect(asked[4].text).toBe('[Exhibit: "Accident log"] Where were you?')
  })

  it('never counts as an interview, and nothing said reaches the case', async () => {
    await prof.put(`${caseUrl()}/witness-settings`).send({ interviewLimit: { max: 1, per: 'team' } })
    const id = (await start(ada, { witnessId: lin, type: 'interview' })).body.session.id
    await turn(ada, id, { kind: 'question', text: 'What did you see?' })
    await turn(ada, id, { kind: 'question', text: 'And then?' })
    await claimsSettled()
    const counts = await pool.query(
      `SELECT (SELECT count(*)::int FROM interviews) AS interviews, (SELECT count(*)::int FROM interview_turns) AS turns,
              (SELECT count(*)::int FROM testimony_claims) AS claims, (SELECT count(*)::int FROM interview_reviews) AS reviews`,
    )
    expect(counts.rows[0]).toEqual({ interviews: 0, turns: 0, claims: 0, reviews: 0 })
    // The real interview still has its one, and the planner can't cite practice.
    const interview = (await ada.get(`/api/courses/${course.id}/my-cases/${caseId}/witnesses/${lin}/interview`)).body.interview
    expect(interview.limit).toEqual({ max: 1, per: 'team', used: 0 })
    const sources = (await ada.get(`/api/courses/${course.id}/my-cases/${caseId}/planner/sources`)).body.sources
    expect(sources.filter((s: { kind: string }) => s.kind === 'interview')).toEqual([])
    // Ending it keeps it for the student, and closes it.
    const ended = await ada.post(`${practiceUrl()}/${id}/end`)
    expect(ended.body.session).toMatchObject({ canAsk: false, endedAt: expect.any(String) })
    expect((await turn(ada, id, { kind: 'question', text: 'One more?' })).status).toBe(409)
  })

  it('is each student’s own, up to the instructor’s cap, and only while it’s on', async () => {
    expect((await prof.put(`${caseUrl()}/practice`).send({ enabled: true, limit: 0 })).status).toBe(400)
    const set = await prof.put(`${caseUrl()}/practice`).send({ enabled: true, limit: 1 })
    expect(set.body.case.practice).toEqual({ enabled: true, limit: 1 })
    // An empty session doesn't count; one with a turn does.
    await start(ada, { witnessId: lin, type: 'interview' })
    const id = (await start(ada, { witnessId: lin, type: 'direct' })).body.session.id
    await turn(ada, id, { kind: 'question', text: 'What did you see?' })
    const full = await start(ada, { witnessId: lin, type: 'redirect' })
    expect(full.status).toBe(409)
    expect(full.body.error).toBe('You’ve used your practice session in this case.')
    const overview = (await ada.get(practiceUrl())).body
    expect(overview.limit).toEqual({ max: 1, used: 1 })
    expect(overview.sessions.map((s: { type: string; turns: number }) => [s.type, s.turns])).toEqual([
      ['direct', 1],
      ['interview', 0],
    ])
    // The partner has their own, and can't open Ada's; nor can the other side.
    expect((await bo.get(`${practiceUrl()}/${id}`)).status).toBe(404)
    expect((await cy.get(`${practiceUrl()}/${id}`)).status).toBe(404)
    expect((await bo.get(practiceUrl())).body.sessions).toEqual([])
    expect((await start(bo, { witnessId: lin, type: 'interview' })).status).toBe(201)

    await prof.put(`${caseUrl()}/practice`).send({ enabled: false })
    expect((await ada.get(practiceUrl())).status).toBe(409)
    expect((await ada.get(`/api/courses/${course.id}/my-cases/${caseId}`)).body.workspace.practice).toEqual({ enabled: false, limit: 1 })
  })

  it('ends an hour after its first turn', async () => {
    const id = (await start(ada, { witnessId: lin, type: 'interview' })).body.session.id
    await turn(ada, id, { kind: 'question', text: 'What did you see?' })
    await pool.query(`UPDATE practice_turns SET created_at = now() - interval '61 minutes' WHERE session_id = $1`, [id])
    const shown = (await ada.get(`${practiceUrl()}/${id}`)).body.session
    expect(shown).toMatchObject({ canAsk: false, endedAt: expect.any(String) })
  })
})
