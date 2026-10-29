import type request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ai } from '../ai/ai.ts'
import { listMaterialTexts } from '../courses/caseContent.ts'
import { pool } from '../db/pool.ts'
import { createCourseAs, resetDatabase, sampleFacts, signedInAgent, uploadCaseFile } from '../test/helpers.ts'
import { questionWeight } from './exchange.ts'
import { buildSubpoenaMessage, buildSubpoenaPrompt, type SubpoenaContext } from './subpoenaPrompt.ts'
import { subpoenasSettled } from './subpoenas.ts'
import { buildMentorPrompt, type MentorContext, type MentorTag } from './mentorPrompt.ts'

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
    expect((await ada.get(`/api/courses/${course.id}/subpoenas`)).status).toBe(404)
    expect((await ada.get(`${caseUrl()}/exchange`)).status).toBe(404)
    expect((await ada.get(`${caseUrl()}/exchange/requests`)).status).toBe(404)
  })
})

describe('subpoenas', () => {
  const subpoenasUrl = () => `/api/courses/${course.id}/subpoenas`
  const serve = (agent: request.Agent, recipient: string, records = 'All records of the June 10 visit.', more: object = {}) =>
    agent
      .post(`${exchangeUrl()}/subpoenas`)
      .send({
        recipient,
        recipientDescription: 'The hospital that treated Ramirez.',
        requestType: 'documents',
        records,
        justification: 'Her treatment records go to damages, and only the hospital has them.',
        ...more,
      })
  const asked: SubpoenaContext[] = []
  const recipientWrites = (text: string) => {
    asked.length = 0
    ai.respondToSubpoena = async (context) => {
      asked.push(context)
      return text
    }
  }
  const RESPONSE = 'RESPONSE OF MERCY HOSPITAL TO SUBPOENA\nRamirez v. Thrillville\n\nProduced: MH-000001'

  beforeEach(async () => {
    await setUp()
    recipientWrites(RESPONSE)
  })

  it('opens in the information exchange phase, and keeps each team to its limit', async () => {
    expect((await serve(ada, 'Mercy Hospital')).status).toBe(409)
    await toExchange()

    expect((await serve(ada, ' ')).status).toBe(400)
    expect((await serve(ada, 'Mercy Hospital', 'x', { requestType: 'testimony' })).status).toBe(400)
    const served = await serve(ada, 'Mercy Hospital')
    expect(served.status).toBe(201)
    expect(served.body.exchange.subpoenas).toMatchObject({
      types: ['documents', 'esi', 'tangible_things', 'inspection'],
      limit: 3,
      days: 14,
      used: 1,
      remaining: 2,
    })
    const s = served.body.exchange.subpoenas.served[0]
    expect(s).toMatchObject({
      recipient: 'Mercy Hospital',
      recipientDescription: 'The hospital that treated Ramirez.',
      requestType: 'documents',
      sentBy: 'Ada Lawyer',
      outcome: null,
      response: null,
      documents: [],
    })
    expect(Math.round((new Date(s.dueAt).getTime() - new Date(s.sentAt).getTime()) / 86_400_000)).toBe(14)

    // Partners share the team's count.
    await serve(bo, 'Lincoln Ride Safety Board')
    await serve(bo, 'Atlas Coaster Co.')
    const out = await serve(ada, 'One more')
    expect(out.status).toBe(409)
    expect(out.body.error).toBe('Your team is out of subpoenas.')
  })

  it('allows only the kinds of request the instructor chose, and needs no choice when there is one', async () => {
    const save = (types: unknown) => prof.put(`${caseUrl()}/exchange`).send({ ...SETTINGS, subpoenas: { ...SETTINGS.subpoenas, types } })
    expect((await save([])).status).toBe(400)
    expect((await save(['video'])).status).toBe(400)
    expect((await save(['inspection', 'esi'])).body.settings.subpoenas.types).toEqual(['esi', 'inspection'])
    await toExchange()
    expect((await exchange(ada)).subpoenas.types).toEqual(['esi', 'inspection'])
    const refused = await serve(ada, 'Mercy Hospital')
    expect(refused.status).toBe(400)
    expect(refused.body.error).toBe("This case doesn't allow that kind of subpoena.")
    expect((await serve(ada, 'Mercy Hospital', 'x', { requestType: '' })).status).toBe(400)

    await save(['inspection'])
    const only = await serve(ada, 'Thrillville Parks', 'The Atlas platform.', { requestType: '' })
    expect(only.status).toBe(201)
    expect(only.body.exchange.subpoenas.served[0].requestType).toBe('inspection')
  })

  it('drafts the response from the whole case file, for the instructor to approve before the team sees it', async () => {
    // A defense file nobody disclosed.
    const gateLog = await upload('Gate log.pdf', 'defense')
    await toExchange()
    recipientWrites(`MODIFY\nEXISTING_DOCUMENT: Gate log.pdf\nEXISTING_DOCUMENT: Ride manual\n\n${RESPONSE}`)
    await serve(ada, 'Mercy Hospital')
    await subpoenasSettled()
    const s = (await exchange(ada)).subpoenas.served[0]

    // The recipient reads every file, and knows which ones the team has.
    expect(asked).toHaveLength(1)
    expect(asked[0]).toMatchObject({ recipient: 'Mercy Hospital', requestType: 'documents', side: 'plaintiff', createNew: false, instructions: '' })
    const access = Object.fromEntries(asked[0].documents.map((d) => [d.title, d.teamHasAccess]))
    expect(access).toMatchObject({ 'Harness photos.pdf': true, 'Gate log.pdf': false })
    const prompt = buildSubpoenaPrompt(asked[0])
    const message = buildSubpoenaMessage(asked[0])
    expect(message).toContain('Directed to: Mercy Hospital')
    expect(prompt).toContain('<document title="Gate log.pdf">')
    // The team has its own files, not the defense's gate log.
    expect(message).toContain('- Harness photos.pdf')
    expect(message).not.toContain('- Gate log.pdf')
    expect(prompt + message).not.toContain('{{')

    // Notice only for the other team, and nothing yet for the team that served it.
    expect((await exchange(cy)).subpoenas.notices).toEqual([
      expect.objectContaining({ teamNumber: 1, recipient: 'Mercy Hospital', requestType: 'documents', records: 'All records of the June 10 visit.' }),
    ])
    expect((await exchange(cy)).subpoenas.served).toEqual([])
    // The notice is new to the other team until they open the exchange.
    expect((await exchange(cy)).subpoenas.notices[0].seen).toBe(false)
    await cy.post(`${exchangeUrl()}/seen`)
    expect((await exchange(cy)).subpoenas.notices[0].seen).toBe(true)
    expect(s).toMatchObject({ outcome: null, response: null, documents: [] })
    expect(s).not.toHaveProperty('draft')

    const open = (await prof.get(subpoenasUrl())).body.subpoenas
    expect(open).toEqual([
      expect.objectContaining({
        id: s.id,
        caseTitle: 'Ramirez v. Thrillville',
        parties: { plaintiff: 'Ramirez', defendant: 'Thrillville' },
        firm: SETTINGS.firms.plaintiff,
        worldNumber: 1,
        teamNumber: 1,
        side: 'plaintiff',
        team: ['Ada Lawyer', 'Bo Brief'],
        status: 'open',
        flag: 'modify',
        draft: RESPONSE,
        existing: [{ materialId: gateLog, title: 'Gate log.pdf', producedToTeam: null }],
        basedOn: null,
        unknownTitles: ['Ride manual'],
      }),
    ])
    expect((await prof.get(`/api/courses/${course.id}/home`)).body.reviewCount).toBe(1)

    // Answered with the existing file: the team gets that file and nothing else.
    const before = (await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM case_materials WHERE case_id = $1', [caseId])).rows[0].n
    const approve = (id: string, response: string) => prof.post(`${subpoenasUrl()}/${id}/approve`).send({ response })
    const done = await approve(s.id, 'ignored')
    expect(done.status).toBe(200)
    expect(done.body.subpoena).toMatchObject({
      outcome: 'responded',
      status: 'answered',
      respondedBy: 'Prof. Ruiz',
      response: null,
      documents: [{ materialId: gateLog, title: 'Gate log.pdf' }],
    })
    expect((await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM case_materials WHERE case_id = $1', [caseId])).rows[0].n).toBe(before)
    expect((await approve(s.id, 'Again.')).status).toBe(409)
    expect((await prof.get(subpoenasUrl())).body.subpoenas).toEqual([])
    expect((await prof.get(`${subpoenasUrl()}?status=completed`)).body.subpoenas).toHaveLength(1)
    expect((await exchange(ada)).subpoenas.served[0]).toMatchObject({ outcome: 'responded', response: null, seen: false })
    expect((await ada.get(myCaseUrl())).body.workspace.materials.map((m: { filename: string }) => m.filename)).toContain('Gate log.pdf')

    // Nothing in the case answers this one, so the response becomes a subpoena response file.
    recipientWrites(RESPONSE)
    await serve(ada, 'Mercy Hospital', 'Billing records for June 10.')
    await subpoenasSettled()
    const billing = (await prof.get(subpoenasUrl())).body.subpoenas[0]
    expect((await approve(billing.id, ' ')).status).toBe(400)
    const sent = await approve(billing.id, `${RESPONSE}\nEdited.`)
    const responseFile = sent.body.subpoena.documents[0]
    expect(sent.body.subpoena).toMatchObject({
      response: `${RESPONSE}\nEdited.`,
      documents: [{ materialId: expect.any(String), title: 'Response of Mercy Hospital to subpoena (Team 1)' }],
    })
    const files = (await ada.get(myCaseUrl())).body.workspace.materials.map((m: { filename: string }) => m.filename)
    expect(files).toContain('Response of Mercy Hospital to subpoena (Team 1).txt')
    expect((await cy.get(myCaseUrl())).body.workspace.materials.map((m: { filename: string }) => m.filename)).not.toContain(
      'Response of Mercy Hospital to subpoena (Team 1).txt',
    )
    const text = await ada.get(`${myCaseUrl()}/materials/${responseFile.materialId}/text`)
    expect(text.body).toEqual({ status: 'ready', text: `${RESPONSE}\nEdited.` })
    const listed = (await prof.get(`${caseUrl()}/materials`)).body.materials as { id: string; source: string; worldNumber: number | null }[]
    expect(listed.find((m) => m.id === responseFile.materialId)).toMatchObject({ source: 'subpoena', worldNumber: 1 })
    expect(listed.find((m) => m.id === gateLog)).toMatchObject({ source: 'instructor', worldNumber: null })

    // The AI reads every instructor file, and this world's subpoena responses only.
    const world = (await pool.query<{ id: string }>('SELECT matchup_id AS id FROM subpoenas WHERE id = $1', [s.id])).rows[0].id
    expect((await listMaterialTexts(caseId, world)).map((m) => m.id)).toEqual(expect.arrayContaining([gateLog, responseFile.materialId]))
    expect((await listMaterialTexts(caseId)).map((m) => m.id)).not.toContain(responseFile.materialId)
    await serve(ada, 'Atlas Coaster Co.')
    await subpoenasSettled()
    expect(asked.at(-1)!.documents.map((d) => d.title)).toContain('Response of Mercy Hospital to subpoena (Team 1)')

    await ada.post(`${exchangeUrl()}/seen`)
    expect((await exchange(ada)).subpoenas.served[1].seen).toBe(true)
    expect((await exchange(bo)).subpoenas.served[1].seen).toBe(false)
    const overview = (await prof.get(`${caseUrl()}/exchange/overview`)).body.overview
    expect(overview.activity).toMatchObject({ subpoenasServed: 3, subpoenasWaiting: 1 })
  })

  it("redrafts with the instructor's notes, as a new file when asked, and retries a failed draft", async () => {
    await toExchange()
    ai.respondToSubpoena = async () => {
      throw new Error('Overloaded.')
    }
    await serve(cy, 'Mercy Hospital')
    await subpoenasSettled()
    const [failed] = (await prof.get(subpoenasUrl())).body.subpoenas
    expect(failed).toMatchObject({ status: 'failed', error: 'Overloaded.', draft: null })
    expect((await prof.post(`${subpoenasUrl()}/${failed.id}/approve`).send({ response: 'x' })).status).toBe(409)

    recipientWrites(`EXISTING_DOCUMENT: Harness photos.pdf\n\n${RESPONSE}`)
    const retried = await prof.post(`${subpoenasUrl()}/${failed.id}/redraft`).send({ instructions: '' })
    expect(retried.body.subpoena.status).toBe('drafting')
    await subpoenasSettled()
    expect((await prof.get(subpoenasUrl())).body.subpoenas[0]).toMatchObject({ status: 'open', existing: [{ materialId: photos }] })

    recipientWrites(`EXISTING_DOCUMENT: Harness photos.pdf\nQUASH\n\n${RESPONSE}`)
    await prof.post(`${subpoenasUrl()}/${failed.id}/redraft`).send({ instructions: 'Only June 2019.', createNew: true })
    await subpoenasSettled()
    expect(asked[0]).toMatchObject({ instructions: 'Only June 2019.', createNew: true })
    expect(buildSubpoenaMessage(asked[0])).toContain("Don't produce any existing case document")
    // Asked for a new file, so existing ones it names anyway aren't produced.
    expect((await prof.get(subpoenasUrl())).body.subpoenas[0]).toMatchObject({
      status: 'open',
      flag: 'quash',
      existing: [],
      unknownTitles: [],
      instructions: 'Only June 2019.',
      createNew: true,
    })
  })

  it('denies with an optional note, and produces nothing', async () => {
    await toExchange()
    recipientWrites(`EXISTING_DOCUMENT: Harness photos.pdf\n\n${RESPONSE}`)
    await serve(cy, 'Mercy Hospital', "All of Ramirez's medical records, ever.")
    await subpoenasSettled()
    const s = (await exchange(cy)).subpoenas.served[0]
    const res = await prof.post(`${subpoenasUrl()}/${s.id}/deny`).send({ note: 'Overbroad.' })
    expect(res.status).toBe(200)
    expect(res.body.subpoena).toMatchObject({ outcome: 'denied', status: 'answered', response: 'Overbroad.', documents: [] })
    expect((await exchange(cy)).subpoenas.served[0]).toMatchObject({ outcome: 'denied', response: 'Overbroad.' })
    expect((await cy.get(myCaseUrl())).body.workspace.materials.map((m: { filename: string }) => m.filename)).not.toContain(
      'Harness photos.pdf',
    )
    // It still counts toward the limit.
    expect((await exchange(cy)).subpoenas.used).toBe(1)
  })

  it('reuses responses: the same world recommends the earlier file, other worlds adapt it', async () => {
    // A second case world, World B.
    await prof.post(`/api/courses/${course.id}/roster`).send({ emails: [5, 6, 7, 8].map(email) })
    const di = (await signedInAgent('student', email(5), 'Di Docket')).agent
    await prof.post(`${caseUrl()}/teams`).send({ emails: [email(5), email(6)] })
    const worldB = (await prof.post(`${caseUrl()}/teams`).send({ emails: [email(7), email(8)] })).body.teams.slice(-2)
    expect((await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: worldB[0].id, defenseTeamId: worldB[1].id })).status).toBe(201)
    await toExchange()
    const title = 'Response of Mercy Hospital to subpoena (Team 1)'

    // World A, Team 1: answered and approved.
    await serve(ada, 'Mercy Hospital')
    await subpoenasSettled()
    expect(asked[0]).toMatchObject({ worldSubpoenas: [], otherWorldResponses: [] })
    const first = (await prof.get(subpoenasUrl())).body.subpoenas[0]
    const fileA = (await prof.post(`${subpoenasUrl()}/${first.id}/approve`).send({ response: RESPONSE })).body.subpoena.documents[0]
    // A denied one is never reused.
    await serve(ada, 'Atlas Coaster Co.')
    await subpoenasSettled()
    const denied = (await prof.get(subpoenasUrl())).body.subpoenas[0]
    await prof.post(`${subpoenasUrl()}/${denied.id}/deny`).send({ note: '' })

    // World A, Team 2 asks for the same: the drafter knows Team 1's response is in this world's file, and recommends it.
    recipientWrites(`EXISTING_DOCUMENT: ${title}\n\n${RESPONSE}`)
    await serve(cy, 'Mercy Hospital')
    await subpoenasSettled()
    expect(asked[0].worldSubpoenas).toEqual([
      { recipient: 'Mercy Hospital', requestType: 'documents', records: 'All records of the June 10 visit.', responseTitle: title },
    ])
    expect(asked[0].otherWorldResponses).toEqual([])
    expect(asked[0].documents.find((d) => d.title === title)).toMatchObject({ teamHasAccess: false })
    const second = (await prof.get(subpoenasUrl())).body.subpoenas[0]
    expect(second).toMatchObject({ existing: [{ materialId: fileA.materialId, title, producedToTeam: 1 }], basedOn: null })
    const sent = (await prof.post(`${subpoenasUrl()}/${second.id}/approve`).send({ response: second.draft })).body.subpoena
    expect(sent.documents.map((d: { materialId: string }) => d.materialId)).toContain(fileA.materialId)
    expect((await cy.get(myCaseUrl())).body.workspace.materials.map((m: { id: string }) => m.id)).toContain(fileA.materialId)

    // World B asks for it too: it reads World A's response (not as a case file), and adapts it.
    recipientWrites(`BASED_ON: R1\n\n${RESPONSE}\nAdapted.`)
    await serve(di, 'mercy hospital', 'ER records for June 10 to 12.')
    await subpoenasSettled()
    const context = asked[0]
    expect(context.worldSubpoenas).toEqual([])
    // Team 2's response repeated Team 1's word for word, so it's offered once, as the original.
    expect(context.otherWorldResponses).toEqual([
      { ref: 'R1', materialId: fileA.materialId, recipient: 'Mercy Hospital', requestType: 'documents', records: 'All records of the June 10 visit.', response: RESPONSE },
    ])
    expect(context.documents.map((d) => d.title)).not.toContain(title)
    const adapted = (await prof.get(subpoenasUrl())).body.subpoenas[0]
    expect(adapted).toMatchObject({ worldNumber: 2, existing: [], basedOn: { materialId: fileA.materialId, title, worldNumber: 1 } })
    const done = (await prof.post(`${subpoenasUrl()}/${adapted.id}/approve`).send({ response: adapted.draft })).body.subpoena
    expect(done.documents).toEqual([{ materialId: expect.any(String), title: 'Response of mercy hospital to subpoena (Team 3)' }])
    expect((await di.get(myCaseUrl())).body.workspace.materials.map((m: { id: string }) => m.id)).not.toContain(fileA.materialId)

    // A redraft starts fresh.
    await serve(di, 'Mercy Hospital', 'Bills.')
    await subpoenasSettled()
    const another = (await prof.get(subpoenasUrl())).body.subpoenas[0]
    expect(another.basedOn).not.toBeNull()
    recipientWrites(RESPONSE)
    await prof.post(`${subpoenasUrl()}/${another.id}/redraft`).send({ instructions: '' })
    await subpoenasSettled()
    expect((await prof.get(subpoenasUrl())).body.subpoenas[0].basedOn).toBeNull()
  })

  it("isn't offered when the case leaves subpoenas out", async () => {
    await prof.put(`${caseUrl()}/exchange`).send({ ...SETTINGS, subpoenas: { enabled: false, limit: 3, days: 14 } })
    await toExchange()
    expect((await exchange(ada)).subpoenas).toBeNull()
    expect((await serve(ada, 'Mercy Hospital')).status).toBe(409)
  })
})

describe('checking with AI', () => {
  const subpoena = {
    recipient: 'Mercy Hospital',
    recipientDescription: 'Where Ramirez was treated.',
    requestType: 'documents',
    records: 'ER records for June 10.',
    justification: 'They go to damages, and only the hospital has them.',
  }
  let seen: MentorContext[]
  let replies: { tag: MentorTag; feedback: string }[]

  beforeEach(async () => {
    await setUp()
    seen = []
    replies = []
    ai.reviewDiscovery = async (context) => {
      seen.push(structuredClone(context))
      return replies.shift() ?? { tag: 'LOOKS_GOOD', feedback: 'Nice.' }
    }
  })

  const check = (agent: request.Agent, body: object) => agent.post(`${exchangeUrl()}/check`).send(body)

  it('needs a justification for a subpoena', async () => {
    await toExchange()
    const res = await ada.post(`${exchangeUrl()}/subpoenas`).send({ ...subpoena, justification: ' ' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("Say how you'd justify this subpoena to the judge.")
  })

  it('reviews a subpoena with only what the team can see, and the recipient rules favorably on a Looks good', async () => {
    await toExchange()
    replies.push({ tag: 'NEEDS_IMPROVEMENT', feedback: 'Request 1: How far back do you need?' })
    const first = await check(ada, { kind: 'subpoena', mode: 'draft', draft: subpoena })
    expect(first.status).toBe(200)
    expect(first.body.check).toEqual({ id: expect.any(String), tag: 'NEEDS_IMPROVEMENT', feedback: 'Request 1: How far back do you need?' })

    const context = seen[0]
    expect(context).toMatchObject({
      kind: 'subpoena',
      mode: 'draft',
      side: 'plaintiff',
      subpoenaRecipient: 'Mercy Hospital (Where Ramirez was treated.)',
      subpoenaTypes: 'documents',
      draft: 'ER records for June 10.',
      goal: 'They go to damages, and only the hospital has them.',
    })
    // The plaintiff's own files and what was disclosed to it; the defense's undisclosed ones aren't in the case file it sees.
    const titles = context.documents.map((d) => d.title)
    expect(titles).toContain('Harness photos.pdf')
    expect(titles).toContain('Incident report.pdf')
    expect(buildMentorPrompt(context)).not.toContain(sampleFacts.defense[0])

    // Edited after the first check, checked again, and served as checked.
    const better = { ...subpoena, records: 'ER records for June 10 to 12.' }
    const second = await check(ada, { kind: 'subpoena', mode: 'draft', draft: better })
    let drafted: SubpoenaContext | undefined
    ai.respondToSubpoena = async (ctx) => {
      drafted = ctx
      return 'RESPONSE'
    }
    await ada.post(`${exchangeUrl()}/subpoenas`).send({ ...better, checkId: second.body.check.id })
    await subpoenasSettled()
    expect(drafted).toMatchObject({ justification: subpoena.justification, mentorApproved: true })
    expect(buildSubpoenaMessage(drafted!)).toContain("Don't tag it QUASH or MODIFY")
    expect(buildSubpoenaMessage(drafted!)).toContain(`<justification>\n${subpoena.justification}\n</justification>`)
    const [served] = (await prof.get(`/api/courses/${course.id}/subpoenas`)).body.subpoenas
    expect(served).toMatchObject({ justification: subpoena.justification, check: { tag: 'LOOKS_GOOD', feedback: 'Nice.', current: true } })
    // Students don't see the check.
    expect((await exchange(ada)).subpoenas.served[0].check).toBeUndefined()
  })

  it('records a check as edited after, and ignores another team’s check', async () => {
    await toExchange()
    const checked = await check(ada, { kind: 'subpoena', mode: 'draft', draft: subpoena })
    await ada.post(`${exchangeUrl()}/subpoenas`).send({ ...subpoena, records: 'Everything.', checkId: checked.body.check.id })
    const cyChecked = await check(cy, { kind: 'subpoena', mode: 'draft', draft: subpoena })
    const drafted: SubpoenaContext[] = []
    ai.respondToSubpoena = async (ctx) => {
      drafted.push(ctx)
      return 'RESPONSE'
    }
    await bo.post(`${exchangeUrl()}/subpoenas`).send({ ...subpoena, checkId: cyChecked.body.check.id })
    await subpoenasSettled()
    const list = (await prof.get(`/api/courses/${course.id}/subpoenas`)).body.subpoenas
    expect(list.map((s: { records: string; check: unknown }) => [s.records, s.check])).toEqual(
      expect.arrayContaining([
        ['Everything.', { tag: 'LOOKS_GOOD', feedback: 'Nice.', current: false }],
        ['ER records for June 10.', null],
      ]),
    )
    expect(drafted.every((d) => !d.mentorApproved)).toBe(true)
  })

  it('reviews interrogatories, and the answers to them, keeping each check for the instructor', async () => {
    await toExchange()
    replies.push({ tag: 'SMALL_EDITS', feedback: 'Interrogatory 1: Knowledge of what?' })
    const items = ['Identify all persons with knowledge.', 'When was the harness last inspected?']
    const sent = await check(ada, { kind: 'interrogatories', mode: 'draft', draft: { items } })
    expect(sent.body.check.tag).toBe('SMALL_EDITS')
    expect(seen[0]).toMatchObject({
      kind: 'interrogatories',
      mode: 'draft',
      draft: '1. Identify all persons with knowledge.\n2. When was the harness last inspected?',
      interrogatoryLimit: 5,
      interrogatoriesServed: 0,
    })
    await ada.post(`${exchangeUrl()}/requests`).send({ kind: 'interrogatories', items, checkId: sent.body.check.id })

    const set = (await exchange(cy)).interrogatories.requests[0]
    const responses = [
      { position: 1, answer: 'Tom Becker.', objection: false, admission: null, agreePart: '', disagreePart: '' },
      { position: 2, answer: 'Overbroad.', objection: true, admission: null, agreePart: '', disagreePart: '' },
    ]
    const answered = await check(cy, { kind: 'interrogatories', mode: 'answer', requestId: set.id, draft: { responses } })
    expect(seen[1]).toMatchObject({
      mode: 'answer',
      side: 'defense',
      servedRequests: '1. Identify all persons with knowledge.\n2. When was the harness last inspected?',
      draft: '1. Answer: Tom Becker.\n2. Objection: Overbroad.',
    })
    // The plaintiff's undisclosed photos stay out of the defense's review.
    expect(seen[1].documents.map((d) => d.title)).toContain('Incident report.pdf')
    expect(seen[1].documents.map((d) => d.title)).not.toContain('Harness photos.pdf')
    await cy.post(`${exchangeUrl()}/requests/${set.id}/responses`).send({ responses, checkId: answered.body.check.id })

    const [request] = (await prof.get(`${caseUrl()}/exchange/requests`)).body.requests
    expect(request).toMatchObject({
      check: { tag: 'SMALL_EDITS', feedback: 'Interrogatory 1: Knowledge of what?', current: true },
      responseCheck: { tag: 'LOOKS_GOOD', current: true },
    })
    // The other team never sees either team's checks.
    expect(JSON.stringify(await exchange(ada))).not.toContain('Knowledge of what?')
  })

  it('says so when the AI can’t check', async () => {
    await toExchange()
    ai.reviewDiscovery = async () => {
      throw new Error('overloaded')
    }
    const res = await check(ada, { kind: 'rfas', mode: 'draft', draft: { items: ['Admit the harness was red.'] } })
    expect(res.status).toBe(502)
    expect(res.body.error).toMatch(/couldn’t check your draft/)
  })
})
