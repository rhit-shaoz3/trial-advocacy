import type request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ai } from '../ai/ai.ts'
import { transcriptionsSettled } from '../courses/materialText.ts'
import { pool } from '../db/pool.ts'
import { createCourseAs, resetDatabase, sampleFacts, signedInAgent, uploadCaseFile } from '../test/helpers.ts'
import { clientEmailsSettled, parseClientReply } from './emails.ts'
import { buildClientPrompt } from './prompt.ts'
import type { ClientReplyInput } from './reply.ts'

// A team's emails to its clients, with Claude faked (server/test/fakeAi.ts):
// who the clients are, what they know and have, the reply's review, and the
// world's files they hand over.

let prof: request.Agent
let ada: request.Agent
let bo: request.Agent
let cy: request.Agent
let dee: request.Agent
let course: { id: string }
let caseId: string
const files: Record<string, string> = {}
let paige: string
let dana: string

const email = (n: number) => `s${n}@example.com`
const caseUrl = () => `/api/courses/${course.id}/cases/${caseId}`
const myCaseUrl = () => `/api/courses/${course.id}/my-cases/${caseId}`

async function upload(filename: string, owner?: Record<string, unknown>, audience = 'instructor') {
  const res = await uploadCaseFile(prof, caseUrl(), filename, { audience, description: filename.replace(/\.\w+$/, '') }, Buffer.from(`Contents of ${filename}`))
  if (res.status !== 201) throw new Error(JSON.stringify(res.body))
  files[filename] = res.body.material.id
  if (owner) {
    const set = await prof.patch(`${caseUrl()}/materials/${res.body.material.id}`).send({ audience, description: res.body.material.description, owner })
    if (set.status !== 200) throw new Error(JSON.stringify(set.body))
  }
  return res.body.material.id as string
}

/** Every request the fake clients got. */
let asked: ClientReplyInput[]
let nextReply: string

const REPLY = (from = 'Paige Winston') => `EXISTING_DOCUMENT: Paige's receipts
EXISTING_DOCUMENT: Hospital chart
NEW_DOCUMENT: Texts with my sister

From: ${from}
To: the attorneys who wrote to you
Date: today
Subject: Re: Your records

Hi,

The receipts are attached, and I copied out my texts with my sister.

Paige

Attachments:
Paige's receipts
Texts with my sister

<record title="Texts with my sister">
Mon 9:02 PM  Paige: My back is killing me.
</record>

<review>
NEW FACTS
- Paige Winston says she texted her sister about her back that night.
</review>`

beforeEach(async () => {
  await resetDatabase()
  prof = (await signedInAgent('instructor', 'prof@example.com', 'Prof. Ruiz')).agent
  course = await createCourseAs(prof)
  await prof.post(`/api/courses/${course.id}/roster`).send({ emails: [1, 2, 3, 4, 5, 6, 7, 8].map(email) })
  ada = (await signedInAgent('student', email(1), 'Ada Lawyer')).agent
  bo = (await signedInAgent('student', email(2), 'Bo Partner')).agent
  cy = (await signedInAgent('student', email(3), 'Cy Counsel')).agent
  dee = (await signedInAgent('student', email(5), 'Dee Other')).agent
  caseId = (
    await prof.post(`/api/courses/${course.id}/cases`).send({ title: 'Winston v. Thrillville', summary: 'A rider was hurt.', importantFacts: sampleFacts })
  ).body.case.id
  // Two worlds: Ada and Bo (plaintiff) against Cy's team; Dee's team against the fourth.
  const teams: { id: string }[] = []
  for (const pair of [[1, 2], [3, 4], [5, 6], [7, 8]]) {
    teams.push((await prof.post(`${caseUrl()}/teams`).send({ emails: pair.map(email) })).body.teams.at(-1))
  }
  await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: teams[0].id, defenseTeamId: teams[1].id })
  await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: teams[2].id, defenseTeamId: teams[3].id })

  const complaint = await upload('Complaint.pdf', undefined, 'all')
  await prof.put(`${caseUrl()}/materials/initial`).send({ materialId: complaint })
  await upload('Paige deposition.pdf')
  paige = (
    await prof.post(`${caseUrl()}/witnesses`).send({
      name: 'Paige Winston',
      role: 'Plaintiff',
      alignedSide: 'plaintiff',
      depositionMaterialId: files['Paige deposition.pdf'],
      isClient: true,
      personaNotes: 'Anxious but organized.',
    })
  ).body.witness.id
  dana = (await prof.post(`${caseUrl()}/witnesses`).send({ name: 'Dana Winston', role: 'Sister', alignedSide: 'plaintiff', isClient: true })).body.witness.id
  await upload("Paige's receipts.pdf", { kind: 'witness', witnessId: paige })
  await upload('Family photos.pdf', { kind: 'plaintiff' })
  await upload('Hospital chart.pdf')
  await upload('Park memo.pdf', { kind: 'defense' })
  // Dana has seen the hospital chart, but it's the hospital's.
  await prof.put(`${caseUrl()}/witnesses/${dana}`).send({
    name: 'Dana Winston',
    role: 'Sister',
    alignedSide: 'plaintiff',
    isClient: true,
    knownMaterialIds: [files['Hospital chart.pdf']],
  })
  await transcriptionsSettled()
  const launched = await prof.post(`${caseUrl()}/launch`)
  if (launched.status !== 200) throw new Error(JSON.stringify(launched.body))

  asked = []
  nextReply = REPLY()
  ai.emailClient = async (input) => {
    asked.push(structuredClone(input))
    return nextReply
  }
})

afterAll(async () => {
  await pool.end()
})

async function send(agent: request.Agent, fields: Record<string, unknown> = {}) {
  const res = await agent.post(`${myCaseUrl()}/client/emails`).send({ subject: 'Your records', body: 'Can you send your receipts?', ...fields })
  await clientEmailsSettled()
  return res
}

const openReviews = async () => (await prof.get(`/api/courses/${course.id}/reviews`)).body.reviews

describe('setting up clients and who owns each file', () => {
  it('marks witnesses as clients, only with a side', async () => {
    const witness = (await prof.get(`${caseUrl()}/witnesses`)).body.witnesses.find((w: { id: string }) => w.id === paige)
    expect(witness).toMatchObject({ isClient: true, speaksForOrganization: false })
    const noSide = await prof.post(`${caseUrl()}/witnesses`).send({ name: 'Nobody', isClient: true })
    expect(noSide.status).toBe(400)
    expect(noSide.body.error).toBe('A client needs a side: choose whom they testify for.')
    // A non-client can't speak for an organization.
    const plain = await prof.post(`${caseUrl()}/witnesses`).send({ name: 'Plain', alignedSide: 'defense', speaksForOrganization: true })
    expect(plain.body.witness).toMatchObject({ isClient: false, speaksForOrganization: false })
  })

  it('records who owns a file, a third party unless chosen, and checks the witness', async () => {
    const { materials } = (await prof.get(`${caseUrl()}/materials`)).body
    const owners = Object.fromEntries(materials.map((m: { description: string; owner: unknown }) => [m.description, m.owner]))
    expect(owners).toMatchObject({
      'Hospital chart': { kind: 'third_party', witnessId: null },
      "Paige's receipts": { kind: 'witness', witnessId: paige },
      'Family photos': { kind: 'plaintiff', witnessId: null },
    })
    const patch = (owner: unknown) =>
      prof.patch(`${caseUrl()}/materials/${files['Hospital chart.pdf']}`).send({ audience: 'instructor', description: 'Hospital chart', owner })
    expect((await patch({ kind: 'witness', witnessId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400)
    expect((await patch({ kind: 'nobody' })).status).toBe(400)
    // Left out, the owner stays.
    const kept = await prof.patch(`${caseUrl()}/materials/${files['Family photos.pdf']}`).send({ audience: 'instructor', description: 'Family photos' })
    expect(kept.body.material.owner).toEqual({ kind: 'plaintiff', witnessId: null })
  })

  it('keeps owners, clients and the email limit in a copy', async () => {
    await prof.put(`${caseUrl()}/witness-settings`).send({ inWorldDate: '', disputedIssues: '', clientEmailLimit: { max: 5, per: 'student' } })
    const copy = (await prof.post(`${caseUrl()}/duplicate`).send({})).body.case
    expect(copy.clientEmailLimit).toEqual({ max: 5, per: 'student' })
    const copyUrl = `/api/courses/${course.id}/cases/${copy.id}`
    const witnesses = (await prof.get(`${copyUrl}/witnesses`)).body.witnesses
    const copiedPaige = witnesses.find((w: { name: string }) => w.name === 'Paige Winston')
    expect(copiedPaige).toMatchObject({ isClient: true })
    const receipts = (await prof.get(`${copyUrl}/materials`)).body.materials.find((m: { description: string }) => m.description === "Paige's receipts")
    expect(receipts.owner).toEqual({ kind: 'witness', witnessId: copiedPaige.id })
  })

  it('shows the team its own clients, not the other side\'s', async () => {
    expect((await ada.get(myCaseUrl())).body.workspace.witnesses.filter((w: { client: boolean }) => w.client).map((w: { name: string }) => w.name)).toEqual([
      'Paige Winston',
      'Dana Winston',
    ])
    expect((await cy.get(myCaseUrl())).body.workspace.witnesses.some((w: { client: boolean }) => w.client)).toBe(false)
  })
})

describe('emailing the clients', () => {
  it('gives the clients, together, what each knows and has', async () => {
    expect((await send(ada)).status).toBe(201)
    const { context, email: sent } = asked[0]
    expect(sent).toEqual({ to: ['Paige Winston', 'Dana Winston'], subject: 'Your records', body: 'Can you send your receipts?' })
    expect(context.contacts.map((c) => c.name)).toEqual(['Paige Winston', 'Dana Winston'])
    expect(context.attorneyNames).toEqual(['Ada Lawyer', 'Bo Partner'])
    const docs = Object.fromEntries(context.documents.map((d) => [d.title, [d.clientKnows, d.clientHas, d.teamHasAccess]]))
    expect(docs).toEqual({
      Complaint: [false, false, true],
      // Paige's own account.
      'Paige deposition': [true, false, false],
      // Hers, so she has it.
      "Paige's receipts": [true, true, false],
      // Their side's.
      'Family photos': [true, true, false],
      // Dana has seen it, but the hospital has it.
      'Hospital chart': [true, false, false],
      // The other side's.
      'Park memo': [false, false, false],
    })
    const prompt = buildClientPrompt(context)
    expect(prompt).toContain('writing as one of the people below')
    expect(prompt).toContain('- Paige Winston, Plaintiff. Background and demeanor: Anxious but organized.')
    expect(prompt).toContain('<document title="Paige\'s receipts" client_knows="yes" client_has="yes" team_has_access="no">')
    expect(prompt).not.toContain('DOCUMENT_REQUESTED')
  })

  it('writes to one client when asked', async () => {
    await send(ada, { to: [dana] })
    expect(asked[0].email.to).toEqual(['Dana Winston'])
    expect((await send(bo, { to: ['00000000-0000-4000-8000-000000000000'] })).status).toBe(400)
  })

  it('goes to the instructor: only files the clients have unlock, and what they write out is a world file', async () => {
    await send(ada)
    const [waiting] = (await ada.get(`${myCaseUrl()}/client`)).body.emails
    expect(waiting).toMatchObject({ status: 'working', reply: null, subject: 'Your records', from: 'Ada Lawyer', mine: true })

    const [review] = await openReviews()
    expect(review).toMatchObject({ kind: 'client_email', status: 'open', subject: 'Your records', to: ['Paige Winston', 'Dana Winston'] })
    expect(review.facts.map((f: { text: string }) => f.text)).toEqual(['Paige Winston says she texted her sister about her back that night.'])
    // The hospital chart isn't theirs to hand over, so it isn't offered.
    expect(review.documents.map((d: { title: string; made: boolean }) => [d.title, d.made])).toEqual([
      ["Paige's receipts", false],
      ['Texts with my sister', true],
    ])
    expect(review.report).not.toContain('EXISTING_DOCUMENT')
    expect(review.report).not.toContain('<record')
    const texts = review.documents[1].materialId
    // Only the instructor sees the new file until it's allowed.
    expect((await ada.get(myCaseUrl())).body.workspace.materials.some((m: { id: string }) => m.id === texts)).toBe(false)

    for (const d of review.documents) {
      await prof.put(`/api/courses/${course.id}/reviews/${review.id}/documents/${d.materialId}`).send({ decision: 'allow' })
    }
    await prof.put(`/api/courses/${course.id}/reviews/${review.id}/facts/${review.facts[0].id}`).send({ decision: 'accept_world' })
    await clientEmailsSettled()

    const [done] = (await bo.get(`${myCaseUrl()}/client`)).body.emails
    expect(done).toMatchObject({ status: 'completed', mine: false, seen: false })
    expect(done.reply).toContain('From: Paige Winston')
    expect(done.attachments.map((a: { title: string }) => a.title)).toEqual(["Paige's receipts", 'Texts with my sister'])
    const theirs = (await ada.get(myCaseUrl())).body.workspace.materials.map((m: { id: string }) => m.id)
    expect(theirs).toEqual(expect.arrayContaining([files["Paige's receipts.pdf"], texts]))
    // The file they wrote out is their side's, and the case's AI reads it from now on in this world.
    const made = (await prof.get(`${caseUrl()}/materials`)).body.materials.find((m: { id: string }) => m.id === texts)
    expect(made).toMatchObject({ source: 'client', worldNumber: 1, owner: { kind: 'plaintiff' } })

    await bo.post(`${myCaseUrl()}/client/seen`)
    expect((await bo.get(`${myCaseUrl()}/client`)).body.emails[0].seen).toBe(true)
  })

  it('comes straight back in review lite', async () => {
    await prof.put(`${caseUrl()}/review-mode`).send({ reviewMode: 'lite' })
    await send(ada)
    expect(await openReviews()).toEqual([])
    const [done] = (await ada.get(`${myCaseUrl()}/client`)).body.emails
    expect(done.status).toBe('completed')
    expect(done.attachments.map((a: { auto: boolean }) => a.auto)).toEqual([true, true])
  })

  it('sends one at a time, up to the limit, and remembers earlier emails', async () => {
    await prof.put(`${caseUrl()}/review-mode`).send({ reviewMode: 'lite' })
    // Hold the first reply back, to send a second while it's waiting.
    let release!: () => void
    ai.emailClient = async (input) => {
      asked.push(structuredClone(input))
      if (asked.length === 1) await new Promise<void>((resolve) => (release = resolve))
      return nextReply
    }
    const first = ada.post(`${myCaseUrl()}/client/emails`).send({ subject: 'Your records', body: 'Can you send your receipts?' })
    expect((await first).status).toBe(201)
    const second = await bo.post(`${myCaseUrl()}/client/emails`).send({ subject: 'More', body: 'Anything else?' })
    expect(second.status).toBe(409)
    expect(second.body.error).toBe('Your team is still waiting on a reply to its last email. It has to come back first.')
    release()
    await clientEmailsSettled()

    expect((await send(bo, { subject: 'More', body: 'Anything else?' })).status).toBe(201)
    // The clients remember the first email and their reply.
    expect(asked[1].context.priorEmails.map((e) => [e.subject, e.from])).toEqual([
      ['Your records', 'Ada Lawyer (your attorney)'],
      ['Re: Your records', 'Paige Winston, Dana Winston'],
    ])
    const third = await send(ada, { subject: 'Last', body: 'One more?' })
    expect(third.status).toBe(409)
    expect(third.body.error).toBe('Your team has used its 2 emails to your client.')

    // Per student, Ada and Bo have each sent one.
    await prof.put(`${caseUrl()}/witness-settings`).send({ inWorldDate: '', disputedIssues: '', clientEmailLimit: { max: 1, per: 'student' } })
    expect((await send(ada, { subject: 'Last', body: 'One more?' })).body.error).toBe("You've used your email to your client.")
    expect((await ada.get(myCaseUrl())).body.workspace.clientEmailLimit).toEqual({ max: 1, per: 'student' })
  })

  it('validates the email, and needs a client', async () => {
    expect((await send(ada, { subject: ' ' })).status).toBe(400)
    expect((await send(ada, { body: '' })).status).toBe(400)
    const none = await send(cy)
    expect(none.status).toBe(409)
    expect(none.body.error).toBe('Your side has no client to email in this case.')
    expect((await prof.put(`${caseUrl()}/witness-settings`).send({ inWorldDate: '', disputedIssues: '', clientEmailLimit: { max: 0, per: 'team' } })).status).toBe(400)
  })
})

describe('a world file in the initial disclosures', () => {
  it('reaches only its own world once the introduction ends, and goes back with it', async () => {
    const exchange = {
      disclosures: { enabled: true },
      subpoenas: { enabled: true, limit: 3, days: 14 },
      interrogatories: { enabled: true, limit: 5, days: 30 },
      rfas: { enabled: true, limit: 3, days: 14 },
      firms: { plaintiff: { firm: 'Hale LLP', partner: 'M. Hale' }, defense: { firm: 'Brandt LLP', partner: 'D. Brandt' } },
    }
    await prof.put(`${caseUrl()}/review-mode`).send({ reviewMode: 'lite' })
    await send(ada)
    const texts = (await ada.get(`${myCaseUrl()}/client`)).body.emails[0].attachments[1].id

    expect((await prof.put(`${caseUrl()}/exchange`).send(exchange)).status).toBe(200)
    const options = (await prof.get(`${caseUrl()}/exchange`)).body.options
    expect(options.find((o: { id: string }) => o.id === texts)).toMatchObject({ kind: 'material', side: 'plaintiff', worldNumber: 1 })
    expect((await prof.put(`${caseUrl()}/exchange/disclosures`).send({ materialIds: [texts], witnessIds: [] })).status).toBe(200)
    expect((await prof.post(`${caseUrl()}/exchange/complete`)).status).toBe(200)
    // Students practise with their own world's files too, but only the team that got them.
    const offered = async (agent: request.Agent) =>
      (await agent.get(`${myCaseUrl()}/exchange`)).body.exchange.disclosures.options.some((o: { id: string }) => o.id === texts)
    expect(await offered(ada)).toBe(true)
    expect(await offered(cy)).toBe(false)
    expect(await offered(dee)).toBe(false)
    const picks = [{ kind: 'material', id: texts, reason: 'It backs up her pain.' }]
    expect((await dee.post(`${myCaseUrl()}/exchange/disclosures`).send({ picks, heldBackReason: 'Nothing else helps.' })).status).toBe(400)
    expect((await ada.post(`${myCaseUrl()}/exchange/disclosures`).send({ picks, heldBackReason: 'Nothing else helps.' })).status).toBe(201)

    const sees = async (agent: request.Agent) => (await agent.get(myCaseUrl())).body.workspace.materials.some((m: { id: string }) => m.id === texts)
    expect(await sees(cy)).toBe(false)
    await prof.put(`${caseUrl()}/phase`).send({ phase: 'information_exchange' })
    expect(await sees(cy)).toBe(true)
    expect(await sees(dee)).toBe(false)
    const review = (await ada.get(`${myCaseUrl()}/exchange`)).body.exchange.disclosures.review
    expect(review.matched.map((i: { id: string }) => i.id)).toEqual([texts])
    await prof.put(`${caseUrl()}/phase`).send({ phase: 'introduction' })
    expect(await sees(cy)).toBe(false)
    expect(await sees(ada)).toBe(true)
  })
})

describe('reading the reply', () => {
  it('splits off the tag lines, records and review block', () => {
    const parsed = parseClientReply(REPLY('Dana Winston'))
    expect(parsed.existingTitles).toEqual(["Paige's receipts", 'Hospital chart'])
    expect(parsed.made).toEqual([{ kind: 'record', title: 'Texts with my sister', text: 'Mon 9:02 PM  Paige: My back is killing me.' }])
    expect(parsed.facts).toEqual(['Paige Winston says she texted her sister about her back that night.'])
    expect(parsed.from).toBe('Dana Winston')
    expect(parsed.body.startsWith('From: Dana Winston')).toBe(true)
    expect(parsed.hasReviewBlock).toBe(true)
  })
})
