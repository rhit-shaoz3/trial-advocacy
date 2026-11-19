import type request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ai } from '../ai/ai.ts'
import { pool } from '../db/pool.ts'
import { transcriptionsSettled } from '../courses/materialText.ts'
import { buildPlannerPrompt, type PlannerReviewContext } from './prompt.ts'
import { plannerReviewsSettled } from './review.ts'
import { witnessTasks } from '../courses/teamTasks.ts'
import { createCourseAs, resetDatabase, sampleFacts, signedInAgent, uploadCaseFile } from '../test/helpers.ts'

// A team's case planner: its cards (facts of consequence and sub-facts), the
// evidence and witnesses on each, its gaps, and the tools for each gap.

let prof: request.Agent
let ada: request.Agent // plaintiff, Team 1
let bo: request.Agent // Ada's partner
let cy: request.Agent // defense, Team 2
let course: { id: string }
let caseId: string
let teams: { id: string }[]
let medical: string
let incident: string
let notes: string
let deposition: string
let report: string
let tom: string
let hidden: string

const email = (n: number) => `s${n}@example.com`
const caseUrl = () => `/api/courses/${course.id}/cases/${caseId}`
const plannerUrl = () => `/api/courses/${course.id}/my-cases/${caseId}/planner`

async function upload(filename: string, audience: string) {
  const id = (await uploadCaseFile(prof, caseUrl(), filename, { audience })).body.material.id as string
  await transcriptionsSettled()
  return id
}

beforeEach(async () => {
  await resetDatabase()
  prof = (await signedInAgent('instructor', 'prof@example.com', 'Prof. Ruiz')).agent
  course = await createCourseAs(prof)
  await prof.post(`/api/courses/${course.id}/roster`).send({ emails: [1, 2, 3, 4].map(email) })
  ada = (await signedInAgent('student', email(1), 'Ada Lawyer')).agent
  bo = (await signedInAgent('student', email(2), 'Bo Partner')).agent
  cy = (await signedInAgent('student', email(3), 'Cy Counsel')).agent
  caseId = (
    await prof.post(`/api/courses/${course.id}/cases`).send({ title: 'Ramirez v. Thrillville', summary: 'A harness opened.', importantFacts: sampleFacts })
  ).body.case.id
  await prof.post(`${caseUrl()}/teams`).send({ emails: [email(1), email(2)] })
  teams = (await prof.post(`${caseUrl()}/teams`).send({ emails: [email(3), email(4)] })).body.teams
  await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: teams[0].id, defenseTeamId: teams[1].id })
  const complaint = await upload('Amended complaint.pdf', 'all')
  await prof.put(`${caseUrl()}/materials/initial`).send({ materialId: complaint })
  medical = await upload('Medical records.pdf', 'plaintiff')
  incident = await upload('Incident report.pdf', 'defense')
  notes = await upload('Witness notes.txt', 'plaintiff')
  await pool.query(`UPDATE case_materials SET text_status = 'ready', text_content = $2 WHERE id = $1`, [
    notes,
    'Rider was calm.\n\nOperator said the light was red.',
  ])
  const launched = await prof.post(`${caseUrl()}/launch`)
  if (launched.status !== 200) throw new Error(JSON.stringify(launched.body))

  // The plaintiff deposed the defense's ride operator; the defense got an investigator's report.
  tom = (
    await pool.query<{ id: string }>(`INSERT INTO case_witnesses (case_id, name, aligned_side) VALUES ($1, 'Tom Becker', 'defense') RETURNING id`, [
      caseId,
    ])
  ).rows[0].id
  hidden = (
    await pool.query<{ id: string }>(`INSERT INTO case_witnesses (case_id, name, hidden) VALUES ($1, 'Secret Sam', true) RETURNING id`, [caseId])
  ).rows[0].id
  deposition = (
    await pool.query<{ id: string }>(`INSERT INTO interviews (witness_id, team_id, side) VALUES ($1, $2, 'plaintiff') RETURNING id`, [
      tom,
      teams[0].id,
    ])
  ).rows[0].id
  for (const [position, answer] of ['I ran the ride.', 'The light was red.', 'I sent it anyway.'].entries()) {
    await pool.query(
      `INSERT INTO interview_turns (interview_id, position, question, reply, answer, model) VALUES ($1, $2, 'And?', $3, $3, 'test')`,
      [deposition, position, answer],
    )
  }
  report = (
    await pool.query<{ id: string }>(
      `INSERT INTO interview_reviews (case_id, team_id, team_number, world_number, side, kind, status, final_report, completed_at)
       VALUES ($1, $2, 2, 1, 'defense', 'investigation', 'completed', $3, now()) RETURNING id`,
      [caseId, teams[1].id, 'The plaintiff skipped the safety video.\n\nShe signed the waiver at 2:04 PM.'],
    )
  ).rows[0].id
})

afterAll(async () => {
  await pool.end()
})

interface Chart {
  cards: { id: string; parentId: string | null; title: string; notes: string; evidence: { title: string; parts: number[] | null; excerpt: string }[]; witnessIds: string[]; updatedBy: string }[]
  gaps: { id: string; cardId: string | null; description: string; tools: { tool: string; priority: number; reason: string; witnessId: string | null }[] }[]
}

const chart = async (agent: request.Agent) => (await agent.get(plannerUrl())).body.planner as Chart
const addCard = async (agent: request.Agent, body: Record<string, unknown>) => {
  const res = await agent.post(`${plannerUrl()}/cards`).send(body)
  if (res.status !== 201) throw new Error(JSON.stringify(res.body))
  return res.body.id as string
}

describe('the case planner', () => {
  it('is shared by the team, and only the team', async () => {
    const element = await addCard(ada, { title: 'The operator sent the ride with the light red.' })
    await addCard(bo, { title: 'The light was red.', parentId: element })
    const ours = await chart(bo)
    expect(ours.cards.map((c) => [c.title, c.parentId])).toEqual([
      ['The operator sent the ride with the light red.', null],
      ['The light was red.', element],
    ])
    expect(ours.cards[1].updatedBy).toBe('Bo Partner')
    // The other side has its own, and can't touch ours.
    expect((await chart(cy)).cards).toEqual([])
    expect((await cy.patch(`${plannerUrl()}/cards/${element}`).send({ title: 'Mine now' })).status).toBe(404)
    expect((await cy.post(`${plannerUrl()}/cards`).send({ title: 'Sub', parentId: element })).status).toBe(404)
  })

  it('edits, orders and deletes cards; a card’s gaps outlive it', async () => {
    const a = await addCard(ada, { title: 'A' })
    const b = await addCard(ada, { title: 'B' })
    const sub = await addCard(ada, { title: 'B.1', parentId: b })
    expect((await ada.patch(`${plannerUrl()}/cards/${a}`).send({ notes: 'Duty first.' })).status).toBe(200)
    expect((await ada.patch(`${plannerUrl()}/cards/${b}`).send({ move: 'up' })).status).toBe(200)
    expect((await chart(ada)).cards.filter((c) => !c.parentId).map((c) => c.title)).toEqual(['B', 'A'])
    const gap = (await ada.post(`${plannerUrl()}/gaps`).send({ cardId: sub, description: 'Who saw the light?' })).body.id
    expect((await ada.delete(`${plannerUrl()}/cards/${b}`)).status).toBe(200)
    const after = await chart(ada)
    expect(after.cards.map((c) => [c.title, c.notes])).toEqual([['A', 'Duty first.']])
    expect(after.gaps).toMatchObject([{ id: gap, cardId: null, description: 'Who saw the light?' }])
    expect((await ada.patch(`${plannerUrl()}/cards/${a}`).send({ title: 'x'.repeat(301) })).status).toBe(400)
  })

  it('moves a card anywhere in the tree, as it’s dragged, but never under itself', async () => {
    const a = await addCard(ada, { title: 'A' })
    const b = await addCard(ada, { title: 'B' })
    const a1 = await addCard(ada, { title: 'A.1', parentId: a })
    const a2 = await addCard(ada, { title: 'A.2', parentId: a })
    const move = (id: string, parentId: string | null, index: number) => ada.patch(`${plannerUrl()}/cards/${id}`).send({ move: { parentId, index } })
    /** Each card, down the tree in order, as "title<parent's title". */
    const tree = async () => {
      const { cards } = await chart(ada)
      const walk = (parentId: string | null): string[] =>
        cards
          .filter((c) => c.parentId === parentId)
          .flatMap((c) => [`${c.title}<${cards.find((p) => p.id === parentId)?.title ?? '-'}`, ...walk(c.id)])
      return walk(null)
    }

    // A.2 into B; then B in front of A.
    expect((await move(a2, b, 0)).status).toBe(200)
    expect((await move(b, null, 0)).status).toBe(200)
    expect(await tree()).toEqual(['B<-', 'A.2<B', 'A<-', 'A.1<A'])
    // A.1 out to be a fact of consequence, between B and A.
    await move(a1, null, 1)
    expect(await tree()).toEqual(['B<-', 'A.2<B', 'A.1<-', 'A<-'])
    // B can't go under itself or its own sub-fact.
    expect((await move(b, b, 0)).status).toBe(400)
    expect((await move(b, a2, 0)).status).toBe(400)
  })

  it('cites only what the team can see, whole or in part', async () => {
    const card = await addCard(ada, { title: 'The light was red.' })
    const sources = (await ada.get(`${plannerUrl()}/sources`)).body.sources as { kind: string; id: string; title: string; paged?: boolean; parts?: unknown[] }[]
    expect(sources.map((s) => s.title)).toEqual([
      'Amended complaint.pdf',
      'Medical records.pdf',
      'Witness notes.txt',
      expect.stringMatching(/^Deposition of Tom Becker \(/),
    ])
    expect(sources[1].paged).toBe(true)
    expect(sources[2].parts).toHaveLength(2)

    const cite = (body: Record<string, unknown>) => ada.post(`${plannerUrl()}/cards/${card}/evidence`).send(body)
    expect((await cite({ kind: 'material', id: medical, parts: [5, 3, 4] })).status).toBe(201)
    expect((await cite({ kind: 'material', id: notes, parts: [1], excerpt: 'the light was red' })).status).toBe(201)
    expect((await cite({ kind: 'interview', id: deposition, parts: [1, 2] })).status).toBe(201)
    // The other side's file, their report, or a part that isn't there.
    expect((await cite({ kind: 'material', id: incident })).status).toBe(400)
    expect((await cite({ kind: 'report', id: report })).status).toBe(400)
    expect((await cite({ kind: 'interview', id: deposition, parts: [7] })).status).toBe(400)
    expect((await cite({ kind: 'material', id: medical, parts: [0] })).status).toBe(400)

    const [evidence] = (await chart(ada)).cards
    expect(evidence.evidence.map((e) => e.title)).toEqual([
      'Medical records.pdf — pages 3–5',
      'Witness notes.txt — paragraph 2',
      expect.stringMatching(/^Deposition of Tom Becker \(.*\) — Q&A 2–3$/),
    ])
    expect(evidence.evidence[1].excerpt).toBe('the light was red')
    // The defense cites its own report.
    const theirs = await addCard(cy, { title: 'She skipped the video.' })
    expect((await cy.post(`${plannerUrl()}/cards/${theirs}/evidence`).send({ kind: 'report', id: report, parts: [0] })).status).toBe(201)
    expect((await chart(cy)).cards[0].evidence[0].title).toMatch(/report \(.*\) — paragraph 1$/)
  })

  it('tags witnesses the team can see, and ranks the tools for each gap', async () => {
    const card = await addCard(ada, { title: 'The light was red.' })
    expect((await ada.put(`${plannerUrl()}/cards/${card}/witnesses`).send({ witnessIds: [tom] })).status).toBe(200)
    expect((await ada.put(`${plannerUrl()}/cards/${card}/witnesses`).send({ witnessIds: [hidden] })).status).toBe(400)
    expect((await chart(ada)).cards[0].witnessIds).toEqual([tom])

    const gap = (await ada.post(`${plannerUrl()}/gaps`).send({ cardId: card, description: 'Was the light working?' })).body.id
    const tools = [
      { tool: 'investigator', reason: 'Cheap and quiet.', specifics: 'Find the maintenance tech.' },
      { tool: 'deposition', reason: 'Lock it in.', specifics: 'Ask about the light.', witnessId: tom },
    ]
    expect((await ada.put(`${plannerUrl()}/gaps/${gap}/tools`).send({ tools })).status).toBe(200)
    expect((await chart(ada)).gaps[0].tools.map((t) => [t.tool, t.priority, t.witnessId])).toEqual([
      ['investigator', 1, null],
      ['deposition', 2, tom],
    ])
    expect((await ada.put(`${plannerUrl()}/gaps/${gap}/tools`).send({ tools: [{ tool: 'magic' }] })).status).toBe(400)
    expect((await ada.put(`${plannerUrl()}/gaps/${gap}/tools`).send({ tools: [tools[0], tools[0]] })).status).toBe(400)
    expect((await cy.put(`${plannerUrl()}/gaps/${gap}/tools`).send({ tools })).status).toBe(404)
  })

  it('is off when the instructor turns it off, and read-only once the case closes', async () => {
    expect((await prof.put(`${caseUrl()}/planner`).send({ enabled: true, reviewLimit: { max: 0, per: 'team' } })).status).toBe(400)
    const set = await prof.put(`${caseUrl()}/planner`).send({ enabled: false, reviewLimit: { max: 5, per: 'team' } })
    expect(set.body.case.planner).toEqual({ enabled: false, reviewLimit: { max: 5, per: 'team' }, feedbackLevel: 'balanced' })
    expect((await prof.put(`${caseUrl()}/planner`).send({ enabled: false, feedbackLevel: 'harsh' })).status).toBe(400)
    expect((await prof.put(`${caseUrl()}/planner`).send({ enabled: false, feedbackLevel: 'gentle' })).body.case.planner.feedbackLevel).toBe('gentle')
    expect(await chart(ada)).toBeNull()
    expect((await ada.post(`${plannerUrl()}/cards`).send({ title: 'A' })).status).toBe(409)
    await prof.put(`${caseUrl()}/planner`).send({ enabled: true })
    expect((await ada.get(`/api/courses/${course.id}/my-cases/${caseId}`)).body.workspace.planner).toEqual({
      enabled: true,
      reviewLimit: { max: 5, per: 'team' },
      feedbackLevel: 'gentle',
    })
    await addCard(ada, { title: 'A' })
    await prof.patch(caseUrl()).send({ title: 'Ramirez v. Thrillville', summary: 'A harness opened.', status: 'closed' })
    expect((await chart(ada)).cards).toHaveLength(1)
    expect((await ada.post(`${plannerUrl()}/cards`).send({ title: 'B' })).status).toBe(409)
  })

  it('shows the instructor each team’s planner', async () => {
    await addCard(ada, { title: 'A' })
    const teamsSeen = (await prof.get(`${caseUrl()}/planners`)).body.teams
    expect(teamsSeen.map((t: { side: string; cards: number }) => [t.side, t.cards])).toEqual([
      ['plaintiff', 1],
      ['defense', 0],
    ])
    expect((await prof.get(`${caseUrl()}/planners/${teams[0].id}`)).body.planner.cards[0].title).toBe('A')
    expect((await ada.get(`${caseUrl()}/planners`)).status).toBe(404)
  })
})

describe('feedback on the planner', () => {
  let asked: PlannerReviewContext[]
  let reply: (ctx: PlannerReviewContext) => string | Promise<string>
  beforeEach(() => {
    asked = []
    reply = () => 'SMALL_EDITS\n\n<overview>\nGood start. g1 needs a tool.\n</overview>\n\n<card id="c1">\nWhat would a juror need to see?\n</card>\n\n<gap id="g1">\nWhat cheaper tool might tell you first?\n</gap>\n\n<card id="c9">\nA card that isn’t there.\n</card>\n\n<big_picture>\nWhat is the other side’s story?\n</big_picture>'
    ai.reviewPlanner = async (ctx) => {
      asked.push(structuredClone(ctx))
      return reply(ctx)
    }
  })

  const ask = async (agent: request.Agent) => {
    const res = await agent.post(`${plannerUrl()}/reviews`)
    await plannerReviewsSettled()
    return res
  }
  const feedback = async (agent: request.Agent) => (await agent.get(plannerUrl())).body.feedback

  it('reads the whole case, marked with what the team can see, and pins its questions to the chart', async () => {
    expect((await ask(ada)).status).toBe(400)
    const fact = await addCard(ada, { title: 'Tom sent the ride with the light red.' })
    await ada.put(`${plannerUrl()}/cards/${fact}/witnesses`).send({ witnessIds: [tom] })
    const gap = (await ada.post(`${plannerUrl()}/gaps`).send({ cardId: fact, description: 'Was the light working?' })).body.id
    expect((await ask(ada)).status).toBe(201)

    const ctx = asked[0]
    expect(ctx.labels).toEqual({ c1: { kind: 'card', id: fact }, g1: { kind: 'gap', id: gap } })
    expect(ctx.documents.find((d) => d.title === 'Incident report.pdf')?.teamHasAccess).toBe(false)
    expect(ctx.documents.find((d) => d.title === 'Medical records.pdf')?.teamHasAccess).toBe(true)
    expect(ctx.facts).toEqual(expect.arrayContaining([{ fact: sampleFacts.defense[0], teamCanSee: false }]))
    expect(ctx.witnesses.map((w) => w.name)).toEqual(['Tom Becker'])
    const prompt = buildPlannerPrompt(ctx)
    expect(prompt).toContain('"id": "c1"')
    expect(prompt).toContain('"witnesses": [\n        "Tom Becker"')
    expect(prompt).toContain('<document title="Incident report.pdf" team_has_access="no">')
    expect(prompt).toContain('This is round 1 of an asynchronous review.')
    // Balanced by default; the instructor can make it gentler.
    expect(prompt).toContain('Be balanced')
    expect(prompt).not.toContain('Be gentle')
    expect(buildPlannerPrompt({ ...ctx, level: 'gentle' })).toContain('Write at most three <card> and <gap> blocks in all')

    const [round] = (await feedback(ada)).reviews
    expect(round).toMatchObject({ round: 1, status: 'ready', tag: 'SMALL_EDITS', bigPicture: 'What is the other side’s story?', mine: true })
    // The note on a card the chart doesn't have isn't lost.
    // The reviewer's ids for cards and gaps read as their own words.
    expect(round.overview).toBe('Good start. “Was the light working?” needs a tool.\n\nA card that isn’t there.')
    expect(round.notes).toEqual([
      { targetKind: 'card', targetId: fact, text: 'What would a juror need to see?' },
      { targetKind: 'gap', targetId: gap, text: 'What cheaper tool might tell you first?' },
    ])
    // Bo sees it too, as his partner's.
    expect((await feedback(bo)).reviews[0].mine).toBe(false)
  })

  it('reads the team’s replies, and keeps each card’s id, in the next round', async () => {
    const fact = await addCard(ada, { title: 'A' })
    await ask(ada)
    const [round] = (await feedback(ada)).reviews
    expect((await bo.put(`${plannerUrl()}/reviews/${round.id}/replies/card/${fact}`).send({ text: 'The ride log shows it.' })).status).toBe(200)
    expect((await bo.put(`${plannerUrl()}/reviews/${round.id}/replies/card/${tom}`).send({ text: 'No such question.' })).status).toBe(404)
    expect((await feedback(ada)).reviews[0].replies).toMatchObject([{ targetId: fact, text: 'The ride log shows it.', updatedBy: 'Bo Partner' }])

    const first = await addCard(ada, { title: 'Before A' })
    await ada.patch(`${plannerUrl()}/cards/${first}`).send({ move: 'up' })
    await ask(bo)
    const ctx = asked[1]
    expect(ctx.round).toBe(2)
    expect(ctx.labels).toEqual({ c1: { kind: 'card', id: fact }, c2: { kind: 'card', id: first } })
    expect(ctx.previousFeedback).toContain('<overview>')
    expect(ctx.teamReplies).toEqual([{ label: 'c1', text: 'The ride log shows it.' }])
    expect(buildPlannerPrompt(ctx)).toContain('[c1] The ride log shows it.')
  })

  it('counts rounds per student or per team, one at a time; a failed round doesn’t count', async () => {
    await addCard(ada, { title: 'A' })
    await prof.put(`${caseUrl()}/planner`).send({ enabled: true, reviewLimit: { max: 1, per: 'student' } })
    reply = () => {
      throw new Error('down')
    }
    await ask(ada)
    let ours = await feedback(ada)
    expect(ours.reviews[0]).toMatchObject({ status: 'failed', error: 'The feedback couldn’t be written. Try again.' })
    expect(ours.used).toBe(0)
    reply = () => 'LOOKS_GOOD\n\n<overview>\nReady.\n</overview>'
    expect((await ada.post(`${plannerUrl()}/reviews/${ours.reviews[0].id}/retry`)).status).toBe(200)
    await plannerReviewsSettled()
    ours = await feedback(ada)
    expect(ours).toMatchObject({ used: 1, limit: { max: 1, per: 'student' }, reviews: [{ status: 'ready', tag: 'LOOKS_GOOD', overview: 'Ready.' }] })
    const again = await ask(ada)
    expect(again.status).toBe(409)
    expect(again.body.error).toBe("You've used your 1 round of feedback.")
    expect((await feedback(bo)).used).toBe(0)

    // While Bo's round is on its way, Ada can't ask; per team, the two rounds used are the team's.
    let release!: () => void
    reply = () => new Promise((resolve) => (release = () => resolve('SMALL_EDITS\n<overview>Hm.</overview>')))
    await prof.put(`${caseUrl()}/planner`).send({ enabled: true, reviewLimit: { max: 3, per: 'student' } })
    expect((await bo.post(`${plannerUrl()}/reviews`)).status).toBe(201)
    const waiting = await ada.post(`${plannerUrl()}/reviews`)
    expect(waiting.status).toBe(409)
    expect(waiting.body.error).toBe('Your team is already waiting on feedback. It has to come back first.')
    await new Promise((r) => setTimeout(r, 50))
    release()
    await plannerReviewsSettled()
    await prof.put(`${caseUrl()}/planner`).send({ enabled: true, reviewLimit: { max: 2, per: 'team' } })
    expect((await ask(ada)).body.error).toBe('Your team has used its 2 rounds of feedback.')
    expect((await prof.get(`${caseUrl()}/planners/${teams[0].id}`)).body.feedback.reviews.map((r: { round: number }) => r.round)).toEqual([1, 2])
  })
})

describe('acting on the planner', () => {
  const myCase = () => `/api/courses/${course.id}/my-cases/${caseId}`
  type Task = { id: string; title: string; completedAt: string | null; team?: { witnessId: string | null; createdBy: string } }
  const teamTasks = async (agent: request.Agent) =>
    ((await agent.get(myCase())).body.workspace.tasks as Task[]).filter((t) => t.team)

  it('adds team tasks for a witness, which either partner can tick off or delete', async () => {
    const card = await addCard(ada, { title: 'The light was red.' })
    const gap = (await ada.post(`${plannerUrl()}/gaps`).send({ cardId: card, description: 'Who saw it?' })).body.id
    const made = await ada.post(`${myCase()}/tasks`).send({ title: 'Ask Tom who else saw the light', witnessId: tom, gapId: gap })
    expect(made.status).toBe(201)
    const [task] = await teamTasks(bo)
    expect(task).toMatchObject({ title: 'Ask Tom who else saw the light', completedAt: null, team: { witnessId: tom, createdBy: 'Ada Lawyer' } })
    expect(await teamTasks(cy)).toEqual([])
    expect((await witnessTasks(teams[0].id, tom)).map((t) => t.title)).toEqual(['Ask Tom who else saw the light'])

    expect((await bo.put(`${myCase()}/tasks/${task.id}`).send({ done: true })).status).toBe(200)
    expect((await teamTasks(ada))[0]).toMatchObject({ completedBy: 'Bo Partner' })
    expect((await cy.delete(`${myCase()}/tasks/${task.id}`)).status).toBe(404)
    expect((await ada.delete(`${myCase()}/tasks/${task.id}`)).status).toBe(200)
    expect(await teamTasks(ada)).toEqual([])
    expect((await ada.post(`${myCase()}/tasks`).send({ title: ' ' })).status).toBe(400)
    expect((await ada.post(`${myCase()}/tasks`).send({ title: 'Ask', witnessId: hidden })).status).toBe(400)
  })

  it('keeps team drafts of investigator and client emails until one is sent', async () => {
    const drafts = async (agent: request.Agent) => (await agent.get(`${myCase()}/message-drafts`)).body.drafts
    const made = await ada.post(`${myCase()}/message-drafts`).send({ kind: 'investigator', content: { assignment: 'Find the tech.' } })
    expect(made.status).toBe(201)
    const id = made.body.draft.id
    expect((await bo.put(`${myCase()}/message-drafts/${id}`).send({ content: { assignment: 'Find the maintenance tech.' } })).status).toBe(200)
    expect(await drafts(ada)).toMatchObject([{ id, kind: 'investigator', content: { assignment: 'Find the maintenance tech.' }, updatedBy: 'Bo Partner' }])
    expect(await drafts(cy)).toEqual([])
    expect((await cy.put(`${myCase()}/message-drafts/${id}`).send({ content: { assignment: 'x' } })).status).toBe(404)
    expect((await ada.post(`${myCase()}/message-drafts`).send({ kind: 'letter', content: {} })).status).toBe(400)
    const email = await ada.post(`${myCase()}/message-drafts`).send({ kind: 'client_email', content: { to: [tom, 'nope'], subject: 'Hi', body: 'x'.repeat(4001) } })
    expect(email.status).toBe(400)

    // Sending it deletes it.
    await prof.put(`${caseUrl()}/phase`).send({ phase: 'investigate' })
    ai.investigate = async () => 'Nothing found.'
    const sent = await ada.post(`${myCase()}/investigator/requests`).send({ assignment: 'Find the maintenance tech.', draftId: id })
    expect(sent.status).toBe(201)
    expect(await drafts(ada)).toEqual([])
  })
})
