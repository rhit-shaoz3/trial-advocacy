import type request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/pool.ts'
import { createCourseAs, resetDatabase, sampleFacts, signedInAgent, uploadCaseFile } from '../test/helpers.ts'
import { questionWeight } from './exchange.ts'

let prof: request.Agent
let ada: request.Agent // plaintiff, Team 1
let bo: request.Agent // plaintiff, Team 1
let cy: request.Agent // defense, Team 2
let course: { id: string }
let caseId: string
let medical: string
let photos: string
let incident: string
let elena: string
let tom: string

const email = (n: number) => `s${n}@example.com`
const caseUrl = () => `/api/courses/${course.id}/cases/${caseId}`
const myCaseUrl = () => `/api/courses/${course.id}/my-cases/${caseId}`
const exchangeUrl = () => `${myCaseUrl()}/exchange`

const SETTINGS = {
  disclosures: { enabled: true },
  subpoenas: { enabled: true, limit: 3, days: 14 },
  interrogatories: { enabled: true, limit: 5, days: 30 },
  rfas: { enabled: true, limit: 3, days: 14 },
  firms: {
    plaintiff: { firm: 'Hale & Whitford LLP', partner: 'Margaret Hale' },
    defense: { firm: 'Brandt Kessler LLP', partner: 'Daniel Brandt' },
  },
}

const upload = async (filename: string, audience: string) =>
  (await uploadCaseFile(prof, caseUrl(), filename, { audience })).body.material.id as string

beforeEach(async () => {
  await resetDatabase()
  prof = (await signedInAgent('instructor', 'prof@example.com', 'Prof. Ruiz')).agent
  course = await createCourseAs(prof)
  await prof.post(`/api/courses/${course.id}/roster`).send({ emails: [1, 2, 3, 4].map(email) })
  ada = (await signedInAgent('student', email(1), 'Ada Lawyer')).agent
  bo = (await signedInAgent('student', email(2), 'Bo Brief')).agent
  cy = (await signedInAgent('student', email(3), 'Cy Counsel')).agent
  caseId = (
    await prof.post(`/api/courses/${course.id}/cases`).send({ title: 'Ramirez v. Thrillville', summary: 'A harness opened.', importantFacts: sampleFacts })
  ).body.case.id
  await prof.post(`${caseUrl()}/teams`).send({ emails: [email(1), email(2)] })
  const teams = (await prof.post(`${caseUrl()}/teams`).send({ emails: [email(3), email(4)] })).body.teams
  await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: teams[0].id, defenseTeamId: teams[1].id })
  const complaint = await upload('Amended complaint.pdf', 'all')
  await prof.put(`${caseUrl()}/materials/initial`).send({ materialId: complaint })
  medical = await upload('Medical records.pdf', 'plaintiff')
  photos = await upload('Harness photos.pdf', 'plaintiff')
  incident = await upload('Incident report.pdf', 'defense')
  elena = (await prof.post(`${caseUrl()}/witnesses`).send({ name: 'Elena Ramirez', role: 'Plaintiff', audience: 'plaintiff' })).body.witness.id
  tom = (await prof.post(`${caseUrl()}/witnesses`).send({ name: 'Tom Becker', role: 'Ride operator', audience: 'defense' })).body.witness.id
  const launched = await prof.post(`${caseUrl()}/launch`)
  if (launched.status !== 200) throw new Error(JSON.stringify(launched.body))
})

afterAll(async () => {
  await pool.end()
})

async function setUp(disclose = { materialIds: [medical, incident], witnessIds: [elena, tom] }) {
  expect((await prof.put(`${caseUrl()}/exchange`).send(SETTINGS)).status).toBe(200)
  expect((await prof.put(`${caseUrl()}/exchange/disclosures`).send(disclose)).status).toBe(200)
  const done = await prof.post(`${caseUrl()}/exchange/complete`)
  expect(done.status).toBe(200)
  return done.body
}

const toExchange = () => prof.put(`${caseUrl()}/phase`).send({ phase: 'information_exchange' })
const exchange = async (agent: request.Agent) => (await agent.get(exchangeUrl())).body.exchange

describe('setting up information exchange', () => {
  it('starts with federal defaults, saves the settings, and finishes once', async () => {
    const start = (await prof.get(`${caseUrl()}/exchange`)).body
    expect(start.settings).toMatchObject({
      setupCompletedAt: null,
      interrogatories: { enabled: true, limit: 25, days: 30 },
      rfas: { enabled: true, limit: 25, days: 30 },
    })
    // Each side's own witnesses and one-side files, never the initial file.
    expect(start.options.map((o: { name: string; side: string }) => `${o.side}: ${o.name}`)).toEqual([
      'plaintiff: Elena Ramirez',
      'defense: Tom Becker',
      'plaintiff: Medical records.pdf',
      'plaintiff: Harness photos.pdf',
      'defense: Incident report.pdf',
    ])

    const body = await setUp()
    expect(body.case.exchangeReady).toBe(true)
    expect(body.settings).toMatchObject({
      setupCompletedAt: expect.any(String),
      firms: SETTINGS.firms,
      disclosures: { enabled: true, materialIds: expect.arrayContaining([medical, incident]), witnessIds: expect.arrayContaining([elena, tom]) },
    })
  })

  it('checks the limits and the disclosure choices', async () => {
    const bad = await prof.put(`${caseUrl()}/exchange`).send({ ...SETTINGS, interrogatories: { enabled: true, limit: 0, days: 30 } })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toBe('The limit for interrogatories must be a whole number from 1 to 100.')
    const complaint = (await prof.get(`${caseUrl()}/materials`)).body.materials.find((m: { initial: boolean }) => m.initial).id
    expect((await prof.put(`${caseUrl()}/exchange/disclosures`).send({ materialIds: [complaint] })).status).toBe(400)
  })

  it("is hidden from students until it's finished", async () => {
    await prof.put(`${caseUrl()}/exchange`).send(SETTINGS)
    expect(await exchange(ada)).toBeNull()
    expect((await ada.get(myCaseUrl())).body.workspace.exchangeReady).toBe(false)
    expect((await toExchange()).status).toBe(409)
    await prof.post(`${caseUrl()}/exchange/complete`)
    expect(await exchange(ada)).toMatchObject({ phase: 'introduction', side: 'plaintiff', teamNumber: 1, opponentNumber: 2, firm: SETTINGS.firms.plaintiff })
  })
})

describe('initial disclosures', () => {
  beforeEach(async () => {
    await setUp()
  })

  it('lets each student submit their own picks once, with a reason for each', async () => {
    const mine = await exchange(ada)
    expect(mine.disclosures.options.map((o: { name: string }) => o.name)).toEqual(['Elena Ramirez', 'Medical records.pdf', 'Harness photos.pdf'])
    expect((await ada.get(myCaseUrl())).body.workspace.tasks).toContainEqual(
      expect.objectContaining({ id: 'exchange:disclosures', completedAt: null, auto: true }),
    )

    const noReason = await ada.post(`${exchangeUrl()}/disclosures`).send({ picks: [{ kind: 'witness', id: elena, reason: ' ' }], heldBackReason: 'x' })
    expect(noReason.status).toBe(400)
    const noHeldBack = await ada.post(`${exchangeUrl()}/disclosures`).send({ picks: [{ kind: 'witness', id: elena, reason: 'Our client.' }] })
    expect(noHeldBack.body.error).toBe("Say why you're holding back the rest.")
    const theirs = await ada.post(`${exchangeUrl()}/disclosures`).send({ picks: [{ kind: 'witness', id: tom, reason: 'Hmm.' }], heldBackReason: 'x' })
    expect(theirs.status).toBe(400)

    const picks = [
      { kind: 'witness', id: elena, reason: 'Our client.' },
      { kind: 'material', id: photos, reason: 'They show the strap.' },
    ]
    const res = await ada.post(`${exchangeUrl()}/disclosures`).send({ picks, heldBackReason: 'The records are private.' })
    expect(res.status).toBe(201)
    expect(res.body.exchange.disclosures.submission).toMatchObject({ heldBackReason: 'The records are private.' })
    expect(res.body.exchange.disclosures.review).toBeNull()
    expect((await ada.post(`${exchangeUrl()}/disclosures`).send({ picks, heldBackReason: 'x' })).status).toBe(409)
    // Just for Ada: her partner still has it to do.
    expect((await exchange(bo)).disclosures.submission).toBeNull()
    expect((await ada.get(myCaseUrl())).body.workspace.tasks).toContainEqual(
      expect.objectContaining({ id: 'exchange:disclosures', completedAt: expect.any(String) }),
    )
    const toggle = await ada.put(`${myCaseUrl()}/tasks/exchange:disclosures`).send({ done: false })
    expect(toggle.status).toBe(409)

    const overview = (await prof.get(`${caseUrl()}/exchange/overview`)).body.overview
    expect(overview.submissions).toEqual({ submitted: 1, total: 4, byWorld: [{ number: 1, submitted: 1, total: 4 }] })
  })

  it("shares the instructor's picks when the case moves on, and compares each student's", async () => {
    await ada.post(`${exchangeUrl()}/disclosures`).send({
      picks: [
        { kind: 'witness', id: elena, reason: 'Our client.' },
        { kind: 'material', id: photos, reason: 'They show the strap.' },
      ],
      heldBackReason: 'Private.',
    })
    const before = (await cy.get(myCaseUrl())).body.workspace
    expect(before.materials.map((m: { filename: string }) => m.filename)).not.toContain('Medical records.pdf')
    expect(before.witnesses.map((w: { name: string }) => w.name)).toEqual(['Tom Becker'])

    expect((await toExchange()).status).toBe(200)
    const after = (await cy.get(myCaseUrl())).body.workspace
    expect(after.materials.map((m: { filename: string }) => m.filename)).toContain('Medical records.pdf')
    expect(after.witnesses).toContainEqual(expect.objectContaining({ name: 'Elena Ramirez', disclosed: true, canInterview: false }))
    expect((await cy.get(`${myCaseUrl()}/witnesses/${elena}/interview`)).status).toBe(409)
    const files = (await prof.get(`${caseUrl()}/materials`)).body.materials
    expect(files.find((m: { id: string }) => m.id === medical).audience).toBe('all')
    // Photos weren't disclosed, so they stay the plaintiff's.
    expect(files.find((m: { id: string }) => m.id === photos).audience).toBe('plaintiff')

    const review = (await exchange(ada)).disclosures.review
    expect(review.matched.map((i: { name: string }) => i.name)).toEqual(['Elena Ramirez'])
    expect(review.extra.map((i: { name: string }) => i.name)).toEqual(['Harness photos.pdf'])
    expect(review.missing.map((i: { name: string }) => i.name)).toEqual(['Medical records.pdf'])
    expect((await ada.post(`${exchangeUrl()}/disclosures`).send({ picks: [], heldBackReason: 'x' })).status).toBe(409)

    // Back to introduction gives the files back to their side.
    await prof.put(`${caseUrl()}/phase`).send({ phase: 'introduction' })
    const back = (await prof.get(`${caseUrl()}/materials`)).body.materials
    expect(back.find((m: { id: string }) => m.id === medical).audience).toBe('plaintiff')
  })

  it('re-shares at once when the instructor changes the picks after the introduction', async () => {
    await toExchange()
    await prof.put(`${caseUrl()}/exchange/disclosures`).send({ materialIds: [photos], witnessIds: [] })
    const files = (await prof.get(`${caseUrl()}/materials`)).body.materials
    expect(files.find((m: { id: string }) => m.id === medical).audience).toBe('plaintiff')
    expect(files.find((m: { id: string }) => m.id === photos).audience).toBe('all')
  })
})

describe('interrogatories and requests for admission', () => {
  beforeEach(async () => {
    await setUp()
  })

  it('counts each subpart as a question', () => {
    expect(questionWeight('Who inspected the harness?')).toBe(1)
    expect(questionWeight('Was it replaced, and if so, (a) when and (b) by whom?')).toBe(2)
  })

  it('opens in the information exchange phase, and keeps each team to its limit', async () => {
    const early = await ada.post(`${exchangeUrl()}/requests`).send({ kind: 'interrogatories', items: ['Who?'] })
    expect(early.status).toBe(409)
    await toExchange()

    const sent = await ada
      .post(`${exchangeUrl()}/requests`)
      .send({ kind: 'interrogatories', items: ['Who inspected the harness?', 'Was it replaced, (a) when and (b) by whom?', ' '] })
    expect(sent.status).toBe(201)
    expect(sent.body.exchange.interrogatories).toMatchObject({ limit: 5, used: 3, remaining: 2 })
    // Both partners share the team's count.
    expect((await exchange(bo)).interrogatories.remaining).toBe(2)

    const over = await bo.post(`${exchangeUrl()}/requests`).send({ kind: 'interrogatories', items: ['One?', 'Two?', 'Three?'] })
    expect(over.status).toBe(409)
    expect(over.body.error).toBe('Your team has only 2 interrogatories left.')
    await bo.post(`${exchangeUrl()}/requests`).send({ kind: 'interrogatories', items: ['One?', 'Two?'] })
    const out = await bo.post(`${exchangeUrl()}/requests`).send({ kind: 'interrogatories', items: ['More?'] })
    expect(out.body.error).toBe('Your team is out of interrogatories.')
  })

  it('gives the other team a task due in the set number of days, and returns the answers to both', async () => {
    await toExchange()
    await ada.post(`${exchangeUrl()}/requests`).send({ kind: 'interrogatories', items: ['Who inspected the harness?', 'When?'] })

    const received = (await exchange(cy)).interrogatories.requests[0]
    expect(received).toMatchObject({ direction: 'received', fromTeam: { number: 1, side: 'plaintiff' }, respondedAt: null })
    const days = (new Date(received.dueAt).getTime() - new Date(received.sentAt).getTime()) / 86_400_000
    expect(Math.round(days)).toBe(30)
    const task = (await cy.get(myCaseUrl())).body.workspace.tasks.find((t: { id: string }) => t.id === `exchange:${received.id}`)
    expect(task).toMatchObject({ title: 'Respond to interrogatories from Team 1', completedAt: null, auto: true })

    const respond = (responses: unknown) => cy.post(`${exchangeUrl()}/requests/${received.id}/responses`).send({ responses })
    expect((await respond([{ position: 1, answer: 'Greg Halvorsen.' }])).status).toBe(400)
    // The sending team can't answer its own set.
    expect((await ada.post(`${exchangeUrl()}/requests/${received.id}/responses`).send({ responses: [] })).status).toBe(404)
    const done = await respond([
      { position: 1, answer: 'Greg Halvorsen.' },
      { position: 2, answer: 'Too vague.', objection: true },
    ])
    expect(done.status).toBe(200)
    expect((await respond([])).status).toBe(409)

    const back = (await exchange(ada)).interrogatories.requests[0]
    expect(back).toMatchObject({ direction: 'sent', seen: false, respondedBy: 'Cy Counsel' })
    expect(back.items).toEqual([
      expect.objectContaining({ position: 1, answer: 'Greg Halvorsen.', objection: false }),
      expect.objectContaining({ position: 2, answer: 'Too vague.', objection: true }),
    ])
    await ada.post(`${exchangeUrl()}/seen`)
    expect((await exchange(ada)).interrogatories.requests[0].seen).toBe(true)
    expect((await exchange(bo)).interrogatories.requests[0].seen).toBe(false)
  })

  it('takes agree, disagree, or partial for requests for admission', async () => {
    await toExchange()
    await cy.post(`${exchangeUrl()}/requests`).send({ kind: 'rfas', items: ['Admit she drank two beers.', 'Admit the harness was latched.'] })
    const set = (await exchange(ada)).rfas.requests[0]
    const respond = (responses: unknown) => ada.post(`${exchangeUrl()}/requests/${set.id}/responses`).send({ responses })

    const halfPartial = await respond([
      { position: 1, admission: 'agree' },
      { position: 2, admission: 'partial', agreePart: 'It was closed.' },
    ])
    expect(halfPartial.status).toBe(400)
    const ok = await respond([
      { position: 1, admission: 'agree' },
      { position: 2, admission: 'partial', agreePart: 'It was closed.', disagreePart: 'It never latched.' },
    ])
    expect(ok.status).toBe(200)
    expect((await exchange(cy)).rfas.requests[0].items[1]).toMatchObject({
      admission: 'partial',
      agreePart: 'It was closed.',
      disagreePart: 'It never latched.',
    })

    const overview = (await prof.get(`${caseUrl()}/exchange/overview`)).body.overview
    expect(overview.activity).toMatchObject({ rfasSent: 2, teams: 2, teamsSentRfas: 1, waiting: 0 })
    const all = (await prof.get(`${caseUrl()}/exchange/requests`)).body.requests
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ kind: 'rfas', worldNumber: 1, fromTeam: { number: 2 }, toTeam: { number: 1 } })
  })

  it("is the instructor's only, and students can't use the instructor's routes", async () => {
    expect((await ada.get(`${caseUrl()}/exchange`)).status).toBe(404)
    expect((await ada.get(`${caseUrl()}/exchange/requests`)).status).toBe(404)
  })
})
