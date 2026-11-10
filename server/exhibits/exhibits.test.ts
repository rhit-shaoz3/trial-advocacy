import type request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/pool.ts'
import { PDFDocument } from 'pdf-lib'
import { createCourseAs, resetDatabase, sampleFacts, signedInAgent, uploadCaseFile } from '../test/helpers.ts'
import { transcriptionsSettled } from '../courses/materialText.ts'

let prof: request.Agent
let ada: request.Agent // plaintiff, Team 1
let cy: request.Agent // defense, Team 2
let course: { id: string }
let caseId: string
let teams: { id: string }[]
let complaint: string
let medical: string
let incident: string
let deposition: string
let report: string

const email = (n: number) => `s${n}@example.com`
const caseUrl = () => `/api/courses/${course.id}/cases/${caseId}`
const exhibitsUrl = () => `/api/courses/${course.id}/my-cases/${caseId}/exhibits`
const reviewsUrl = () => `/api/courses/${course.id}/exhibit-reviews`

interface Exhibit {
  id: string
  offeredBy: string
  joint: boolean
  kind: string
  sourceId: string
  parts: number[] | null
  title: string
  excerpt: { n: number; text: string; question?: string }[] | null
  redacted: boolean
  status: string
  authenticated: boolean
  supersededBy: string | null
  label: string | null
}

/** Uploads a case file, once its background reading is done (so a test can set its text after). */
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
  cy = (await signedInAgent('student', email(3), 'Cy Counsel')).agent
  caseId = (
    await prof.post(`/api/courses/${course.id}/cases`).send({ title: 'Ramirez v. Thrillville', summary: 'A harness opened.', importantFacts: sampleFacts })
  ).body.case.id
  await prof.post(`${caseUrl()}/teams`).send({ emails: [email(1), email(2)] })
  teams = (await prof.post(`${caseUrl()}/teams`).send({ emails: [email(3), email(4)] })).body.teams
  await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: teams[0].id, defenseTeamId: teams[1].id })
  complaint = await upload('Amended complaint.pdf', 'all')
  await prof.put(`${caseUrl()}/materials/initial`).send({ materialId: complaint })
  medical = await upload('Medical records.pdf', 'plaintiff')
  incident = await upload('Incident report.pdf', 'defense')
  const launched = await prof.post(`${caseUrl()}/launch`)
  if (launched.status !== 200) throw new Error(JSON.stringify(launched.body))

  // The plaintiff deposed the defense's ride operator: three questions.
  const { rows: [tom] } = await pool.query<{ id: string }>(
    `INSERT INTO case_witnesses (case_id, name, aligned_side) VALUES ($1, 'Tom Becker', 'defense') RETURNING id`,
    [caseId],
  )
  const { rows: [interview] } = await pool.query<{ id: string }>(
    `INSERT INTO interviews (witness_id, team_id, side) VALUES ($1, $2, 'plaintiff') RETURNING id`,
    [tom.id, teams[0].id],
  )
  for (const [position, answer] of ['I ran the ride.', 'The light was red.', 'I sent it anyway.'].entries()) {
    await pool.query(
      `INSERT INTO interview_turns (interview_id, position, question, reply, answer, model) VALUES ($1, $2, 'And?', $3, $3, 'test')`,
      [interview.id, position, answer],
    )
  }
  deposition = interview.id
  // The defense's investigator report, in two paragraphs.
  const { rows: [r] } = await pool.query<{ id: string }>(
    `INSERT INTO interview_reviews (case_id, team_id, team_number, world_number, side, kind, status, final_report, completed_at)
     VALUES ($1, $2, 2, 1, 'defense', 'investigation', 'completed', $3, now()) RETURNING id`,
    [caseId, teams[1].id, 'The plaintiff skipped the safety video.\n\nShe signed the waiver at 2:04 PM.'],
  )
  report = r.id
})

afterAll(async () => {
  await pool.end()
})

const toFinalSteps = () => prof.put(`${caseUrl()}/phase`).send({ phase: 'final_steps' })
const mine = async (agent: request.Agent) => (await agent.get(exhibitsUrl())).body.exhibits
const submit = (agent: request.Agent, items: unknown[]) => agent.post(`${exhibitsUrl()}/list/submit`).send({ items })
const file = (id: string, parts: number[] | null = null) => ({ kind: 'material', id, parts })
const exhibitsOf = async (agent: request.Agent) => (await mine(agent)).exhibits as Exhibit[]
const find = (list: Exhibit[], test: (x: Exhibit) => boolean) => list.find(test)!
/** The instructor's worlds to rule on (or ruled on), and the exhibits of them waiting for a ruling. */
const reviewWorlds = async (status = 'open') => (await prof.get(`${reviewsUrl()}?status=${status}`)).body.worlds as { worldNumber: number; exhibits: Exhibit[] }[]
const waitingForRuling = async () =>
  (await reviewWorlds())
    .flatMap((w) => w.exhibits)
    .filter((x) => ['authenticity_review', 'admission_review'].includes(x.status)) as (Exhibit & { pairedWith: string; sourceTitle: string })[]

describe('building an exhibit list', () => {
  it('opens in the final steps phase, with the files and depositions the team can list (not investigator reports)', async () => {
    expect(await mine(ada)).toBeNull()
    expect((await ada.put(`${exhibitsUrl()}/list`).send({ items: [] })).status).toBe(409)
    expect((await toFinalSteps()).status).toBe(200)

    const ours = await mine(ada)
    expect(ours.side).toBe('plaintiff')
    expect(ours.options.map((o: { kind: string; title: string; group: string }) => `${o.group}: ${o.title}`)).toEqual([
      'case-file: Amended complaint.pdf',
      'case-file: Medical records.pdf',
      expect.stringMatching(/^depositions: Deposition of Tom Becker \(/),
    ])
    // A PDF can have parts redacted.
    expect(ours.options[0].markable).toBe('pdf')
    const theirs = await mine(cy)
    expect(theirs.options.map((o: { title: string }) => o.title)).toEqual(['Amended complaint.pdf', 'Incident report.pdf'])
    // Nor can an investigator report be listed.
    expect((await cy.put(`${exhibitsUrl()}/list`).send({ items: [{ kind: 'report', id: report, parts: null }] })).status).toBe(400)
  })

  it('lists a text file whole or by paragraph', async () => {
    const notes = await upload('Witness notes.txt', 'plaintiff')
    await pool.query(`UPDATE case_materials SET text_status = 'ready', text_content = $2 WHERE id = $1`, [
      notes,
      'Rider was calm.\n\nOperator said the light was red.',
    ])
    await toFinalSteps()
    const option = (await mine(ada)).options.find((o: { id: string }) => o.id === notes)
    expect(option.parts.map((p: { text: string }) => p.text)).toEqual(['Rider was calm.', 'Operator said the light was red.'])
    expect(option.markable).toBeUndefined()
    expect((await ada.put(`${exhibitsUrl()}/list`).send({ items: [file(notes, [5])] })).status).toBe(400)
    await ada.put(`${exhibitsUrl()}/list`).send({ items: [file(notes, [1])] }).expect(200)
    expect((await mine(ada)).mine.items[0].title).toBe('Witness notes.txt — paragraph 2')
  })

  it('saves a draft, then submits it for good', async () => {
    await toFinalSteps()
    const saved = await ada.put(`${exhibitsUrl()}/list`).send({ items: [file(medical), { kind: 'deposition', id: deposition, parts: [2, 0] }] })
    expect(saved.status).toBe(200)
    expect(saved.body.exhibits.mine.items.map((i: { title: string }) => i.title)).toEqual([
      'Medical records.pdf',
      expect.stringMatching(/Deposition of Tom Becker .* — Q&A 1, 3$/),
    ])
    expect(saved.body.exhibits.mine.submittedAt).toBeNull()

    // Every turn is the whole transcript.
    const sent = await submit(ada, [file(medical), { kind: 'deposition', id: deposition, parts: [0, 1, 2] }])
    expect(sent.status).toBe(200)
    expect(sent.body.exhibits.mine).toMatchObject({ submittedAt: expect.any(String), submittedBy: 'Ada Lawyer' })
    expect(sent.body.exhibits.mine.items[1].parts).toBeNull()
    expect((await ada.put(`${exhibitsUrl()}/list`).send({ items: [] })).status).toBe(409)
    expect((await submit(ada, [])).status).toBe(409)

    // The other side sees that it's in, but not what's on it.
    const theirs = await mine(cy)
    expect(theirs.theirs).toMatchObject({ submittedAt: expect.any(String), items: [] })
    expect(theirs.exhibits).toEqual([])
  })

  it("won't list what the team can't see, or parts that don't exist", async () => {
    await toFinalSteps()
    expect((await submit(ada, [file(incident)])).status).toBe(400)
    expect((await submit(ada, [{ kind: 'report', id: report, parts: null }])).status).toBe(400)
    expect((await submit(cy, [{ kind: 'report', id: report, parts: [5] }])).status).toBe(400)
    expect((await submit(cy, [file(complaint, [0])])).status).toBe(400)
    expect((await submit(cy, [file(complaint), file(complaint)])).status).toBe(400)
  })

  it('stays closed when the instructor turns it off', async () => {
    await toFinalSteps()
    expect((await prof.put(`${caseUrl()}/exhibit-list`).send({ enabled: false })).body.case.exhibitListEnabled).toBe(false)
    expect(await mine(ada)).toBeNull()
    expect((await submit(ada, [])).status).toBe(409)
  })
})

describe('exchanging the lists', () => {
  it('admits what both listed as the plaintiff’s, and sends the rest to the other side', async () => {
    await toFinalSteps()
    await submit(ada, [file(complaint), file(medical)])
    await submit(cy, [file(incident), file(complaint)])

    const list = await exhibitsOf(ada)
    expect(list.map((x) => `${x.offeredBy}${x.joint ? ' joint' : ''}: ${x.title} (${x.status})`)).toEqual([
      'plaintiff joint: Amended complaint.pdf (admitted)',
      'plaintiff: Medical records.pdf (awaiting_authenticity)',
      'defense: Incident report.pdf (awaiting_authenticity)',
    ])
    const ours = await mine(ada)
    expect(ours.notices).toMatchObject({ exchanged: true, objections: 0, rulings: 0, finalized: false })
    expect(ours.theirs.items.map((i: { title: string }) => i.title)).toEqual(['Incident report.pdf', 'Amended complaint.pdf'])
    await ada.post(`${exhibitsUrl()}/seen`).expect(204)
    expect((await mine(ada)).notices.exchanged).toBe(false)

    // Each side can now open the other's listed file, as an exhibit.
    const inc = find(list, (x) => x.sourceId === incident)
    expect((await ada.get(`${exhibitsUrl()}/${inc.id}/file`)).status).not.toBe(404)
    expect((await ada.get(`/api/courses/${course.id}/my-cases/${caseId}/materials/${incident}/file`)).status).toBe(404)
  })

  it('keeps the other side out of a file until the lists are exchanged', async () => {
    await toFinalSteps()
    await submit(cy, [file(incident)])
    expect((await ada.get(`/api/courses/${course.id}/my-cases/${caseId}/materials/${incident}/file`)).status).toBe(404)
  })

  it('admits the excerpt both chose when one side wants the whole file, and the whole file replaces it once admitted', async () => {
    await toFinalSteps()
    await submit(ada, [file(complaint)])
    await submit(cy, [file(complaint, [2, 3])])

    let list = await exhibitsOf(ada)
    expect(list.map((x) => `${x.offeredBy}${x.joint ? ' joint' : ''}: ${x.title} (${x.status}${x.authenticated ? ', authentic' : ''})`)).toEqual([
      'plaintiff joint: Amended complaint.pdf — pages 2–3 (admitted, authentic)',
      'plaintiff: Amended complaint.pdf (awaiting_admission, authentic)',
    ])
    const whole = find(list, (x) => !x.joint)
    expect((await cy.post(`${exhibitsUrl()}/${whole.id}/admission`).send({ decision: 'admit' })).status).toBe(200)

    list = await exhibitsOf(ada)
    expect(find(list, (x) => x.joint).supersededBy).toBe(whole.id)
    // Nothing is left open, so the list is final; the excerpt gets no number.
    expect(list.map((x) => x.label)).toEqual([null, '1'])
    expect((await mine(cy)).finalizedAt).toEqual(expect.any(String))
  })

  it('admits the overlap of two excerpts, and sends each excerpt on for admission; excerpts that miss each other just go on', async () => {
    await toFinalSteps()
    await submit(ada, [file(complaint, [1, 2, 3]), file(medical)])
    await submit(cy, [file(complaint, [3, 4])])
    expect((await exhibitsOf(ada)).filter((x) => x.sourceId === complaint).map((x) => `${x.offeredBy}${x.joint ? ' joint' : ''} ${x.parts} ${x.status}`)).toEqual([
      'plaintiff joint 3 admitted',
      'plaintiff 1,2,3 awaiting_admission',
      'defense 3,4 awaiting_admission',
    ])
  })

  it('sends excerpts that miss each other straight to admission, already authentic', async () => {
    await toFinalSteps()
    await submit(ada, [file(complaint, [1])])
    await submit(cy, [file(complaint, [5])])
    expect((await exhibitsOf(ada)).map((x) => `${x.offeredBy}${x.joint ? ' joint' : ''} ${x.parts} ${x.status} ${x.authenticated}`)).toEqual([
      'plaintiff 1 awaiting_admission true',
      'defense 5 awaiting_admission true',
    ])
  })

  it('keeps a snapshot of the chosen turns or paragraphs', async () => {
    const notes = await upload('Guest notes.txt', 'defense')
    const setText = (text: string) =>
      pool.query(`UPDATE case_materials SET text_status = 'ready', text_content = $2 WHERE id = $1`, [notes, text])
    await setText('The plaintiff skipped the safety video.\n\nShe signed the waiver at 2:04 PM.')
    await toFinalSteps()
    await submit(ada, [{ kind: 'deposition', id: deposition, parts: [1] }])
    await submit(cy, [file(notes, [1])])
    await pool.query('DELETE FROM interview_turns WHERE interview_id = $1', [deposition])
    await setText('Rewritten.')
    const list = await exhibitsOf(cy)
    expect(list.map((x) => x.excerpt?.map((p) => p.text))).toEqual([['The light was red.'], ['She signed the waiver at 2:04 PM.']])
    expect(list[1].title).toBe('Guest notes.txt — paragraph 2')
  })
})

describe('reviewing the other side’s exhibits', () => {
  async function exchanged() {
    await toFinalSteps()
    await submit(ada, [file(medical), { kind: 'deposition', id: deposition, parts: null }])
    await submit(cy, [file(incident)])
    const list = await exhibitsOf(ada)
    return {
      medical: find(list, (x) => x.sourceId === medical),
      depo: find(list, (x) => x.kind === 'deposition'),
      incident: find(list, (x) => x.sourceId === incident),
    }
  }
  const move = (agent: request.Agent, id: string, step: string, body: object) => agent.post(`${exhibitsUrl()}/${id}/${step}`).send(body)

  it('goes authenticity first, then admission, and only for the other side', async () => {
    const { medical: med, incident: inc } = await exchanged()
    expect((await move(ada, med.id, 'authenticity', { decision: 'agree' })).status).toBe(409)
    expect((await move(cy, med.id, 'admission', { decision: 'admit' })).status).toBe(409)
    expect((await move(cy, med.id, 'authenticity', { decision: 'challenge' })).status).toBe(400)

    expect((await move(cy, med.id, 'authenticity', { decision: 'agree' })).status).toBe(200)
    expect((await move(cy, med.id, 'admission', { decision: 'admit' })).status).toBe(200)
    expect(find(await exhibitsOf(ada), (x) => x.id === med.id)).toMatchObject({ status: 'admitted', authenticated: true })

    expect((await move(ada, inc.id, 'authenticity', { decision: 'agree' })).status).toBe(200)
    expect(find(await exhibitsOf(cy), (x) => x.id === inc.id).status).toBe('awaiting_admission')
  })

  it('sends an authenticity challenge to the offering side to answer, then back to the challenger to withdraw or keep', async () => {
    const { medical: med, depo } = await exchanged()
    await move(cy, med.id, 'authenticity', { decision: 'challenge', note: 'No custodian can vouch for these.' }).expect(200)
    expect(find(await exhibitsOf(ada), (x) => x.id === med.id).status).toBe('authenticity_response')
    expect((await mine(ada)).notices.objections).toBe(1)
    expect((await move(cy, med.id, 'authenticity-response', { decision: 'respond', note: 'Mine.' })).status).toBe(409)
    expect((await move(ada, med.id, 'authenticity-response', { decision: 'respond' })).status).toBe(400)
    await move(ada, med.id, 'authenticity-response', { decision: 'respond', note: 'The hospital certified them.' }).expect(200)
    expect((await mine(cy)).notices.objections).toBe(1)
    await move(cy, med.id, 'authenticity-reconsider', { decision: 'withdraw' }).expect(200)
    expect(find(await exhibitsOf(ada), (x) => x.id === med.id)).toMatchObject({
      status: 'awaiting_admission',
      authenticated: true,
      authenticityNote: 'No custodian can vouch for these.',
      authenticityResponse: 'The hospital certified them.',
    })

    // Or the offering side drops it.
    await move(cy, depo.id, 'authenticity', { decision: 'challenge', note: 'Never certified.' }).expect(200)
    await move(ada, depo.id, 'authenticity-response', { decision: 'drop' }).expect(200)
    expect(find(await exhibitsOf(ada), (x) => x.id === depo.id).status).toBe('dropped')
  })

  it('takes a kept authenticity challenge on to admission, and to the judge only once the whole world is settled, even in review lite', async () => {
    await prof.put(`${caseUrl()}/review-mode`).send({ reviewMode: 'lite' })
    const { medical: med, depo, incident: inc } = await exchanged()
    await move(cy, med.id, 'authenticity', { decision: 'challenge', note: 'No custodian can vouch for these.' }).expect(200)
    await move(ada, med.id, 'authenticity-response', { decision: 'respond', note: 'The hospital certified them.' }).expect(200)
    await move(cy, med.id, 'authenticity-reconsider', { decision: 'keep' }).expect(200)
    expect(find(await exhibitsOf(ada), (x) => x.id === med.id)).toMatchObject({
      status: 'awaiting_admission',
      authenticated: false,
      authenticityDisputed: true,
    })
    await move(cy, med.id, 'admission', { decision: 'admit' }).expect(200)
    expect(find(await exhibitsOf(ada), (x) => x.id === med.id).status).toBe('authenticity_review')

    // The other exhibits are still with the teams, so nothing reaches the judge yet.
    expect(await reviewWorlds()).toEqual([])
    expect((await prof.get(`/api/courses/${course.id}/home`)).body.reviewCount).toBe(0)
    expect((await prof.post(`${reviewsUrl()}/${med.id}/authenticity`).send({ decision: 'authenticate' })).status).toBe(409)

    await move(cy, depo.id, 'authenticity', { decision: 'agree' }).expect(200)
    await move(cy, depo.id, 'admission', { decision: 'admit' }).expect(200)
    await move(ada, inc.id, 'authenticity', { decision: 'agree' }).expect(200)
    await move(ada, inc.id, 'admission', { decision: 'admit' }).expect(200)

    // Now the whole world's list goes to the judge, with the one challenge to rule on.
    const [world] = await reviewWorlds()
    expect(world).toMatchObject({ caseTitle: 'Ramirez v. Thrillville', worldNumber: 1, teams: { plaintiff: 1, defense: 2 } })
    expect(world.exhibits.map((x) => x.status)).toEqual(['authenticity_review', 'admitted', 'admitted'])
    expect((await prof.get(`/api/courses/${course.id}/home`)).body.reviewCount).toBe(1)

    await prof.post(`${reviewsUrl()}/${med.id}/authenticity`).send({ decision: 'authenticate' }).expect(200)
    const list = await exhibitsOf(ada)
    expect(find(list, (x) => x.id === med.id)).toMatchObject({ status: 'admitted', authenticated: true })
    expect(list.map((x) => x.label)).toEqual(['1', '2', 'A'])
    expect((await mine(ada)).notices.rulings).toBe(1)
    expect(await reviewWorlds()).toEqual([])
    expect((await reviewWorlds('completed')).map((w) => w.worldNumber)).toEqual([1])
  })

  it('lets the offering side drop an exhibit objected to, or answer it with a proposed version the challenger can agree to', async () => {
    const { medical: med, depo, incident: inc } = await exchanged()
    for (const x of [med, depo]) {
      await move(cy, x.id, 'authenticity', { decision: 'agree' }).expect(200)
      await move(cy, x.id, 'admission', { decision: 'challenge', objection: 'Hearsay.' }).expect(200)
    }
    expect((await mine(ada)).notices.objections).toBe(2)
    expect((await move(cy, med.id, 'response', { decision: 'drop' })).status).toBe(409)
    expect((await move(ada, med.id, 'response', { decision: 'respond' })).status).toBe(400)

    // The transcript, with a proposed version that keeps only "The light" of the second answer.
    expect((await ada.get(`${exhibitsUrl()}/${depo.id}/marking`)).body.markable).toBe('text')
    expect((await cy.get(`${exhibitsUrl()}/${depo.id}/marking`)).status).toBe(409)
    const marks = { mode: 'admit', parts: [{ n: 1, ranges: [{ field: 'text', start: 0, end: 9 }] }] }
    await move(ada, depo.id, 'response', { decision: 'respond', response: 'Only the light.', marks }).expect(200)
    expect(find(await exhibitsOf(cy), (x) => x.id === depo.id)).toMatchObject({
      status: 'objection_reconsider',
      response: 'Only the light.',
      proposalMarked: true,
      proposalExcerpt: [{ n: 1, question: '████', objection: null, text: 'The light ████████' }],
    })
    await move(cy, depo.id, 'reconsider', { decision: 'proposal' }).expect(200)
    expect(find(await exhibitsOf(ada), (x) => x.id === depo.id)).toMatchObject({
      status: 'admitted',
      agreed: 'proposal',
      redacted: true,
      ruling: null,
      excerpt: [{ n: 1, question: '████', objection: null, text: 'The light ████████' }],
    })

    // The records, answered in words; with no marked version, the challenger keeps the objection.
    await move(ada, med.id, 'response', { decision: 'respond', response: 'Business records.', acceptsRedaction: 'Page 4.' }).expect(200)
    await move(cy, med.id, 'reconsider', { decision: 'keep' }).expect(200)
    expect(find(await exhibitsOf(ada), (x) => x.id === med.id)).toMatchObject({ status: 'admission_review', objectionKept: true })

    // The defense drops its own once objected to; then the world goes to the judge.
    await move(ada, inc.id, 'authenticity', { decision: 'agree' }).expect(200)
    await move(ada, inc.id, 'admission', { decision: 'challenge', objection: 'Irrelevant.' }).expect(200)
    expect((await move(ada, inc.id, 'reconsider', { decision: 'proposal' })).status).toBe(409)
    await move(cy, inc.id, 'response', { decision: 'respond', response: 'It shows the harness was checked.' }).expect(200)
    expect((await move(ada, inc.id, 'reconsider', { decision: 'proposal' })).status).toBe(400)
    await move(ada, inc.id, 'reconsider', { decision: 'original' }).expect(200)

    const [review] = await waitingForRuling()
    expect(review).toMatchObject({ id: med.id, objection: 'Hearsay.', response: 'Business records.', acceptsRedaction: 'Page 4.' })
    expect((await prof.post(`${reviewsUrl()}/${med.id}/admission`).send({ decision: 'partial' })).status).toBe(400)
    await prof.post(`${reviewsUrl()}/${med.id}/admission`).send({ decision: 'partial', redaction: 'Page 4' }).expect(200)

    const list = await exhibitsOf(ada)
    expect(find(list, (x) => x.id === med.id)).toMatchObject({ status: 'admitted', redaction: 'Page 4', ruling: 'partial' })
    expect(find(list, (x) => x.id === inc.id)).toMatchObject({ status: 'admitted', agreed: 'original' })
    expect(list.map((x) => x.label)).toEqual(['1', '2', 'A'])
    expect((await mine(cy)).notices.finalized).toBe(true)
  })

  it('serves a proposed redacted copy of a file to both sides, and admits it when the challenger agrees', async () => {
    const { medical: med, depo, incident: inc } = await exchanged()
    // The stored test file isn't a real PDF, so it stands in for a picture.
    await pool.query(`UPDATE case_materials SET content_type = 'image/png' WHERE id = $1`, [medical])
    await move(cy, med.id, 'authenticity', { decision: 'agree' }).expect(200)
    await move(cy, med.id, 'admission', { decision: 'challenge', objection: 'Hearsay.' }).expect(200)
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const { key, url, headers } = (await ada.post(`${exhibitsUrl()}/${med.id}/proposal-uploads`).send({ size: png.length }).expect(201)).body.upload
    await ada.put(url).set(headers).send(png).expect(200)
    const marks = { mode: 'redact', pages: [{ page: 1, removed: false, boxes: [{ x: 0.1, y: 0.1, w: 0.3, h: 0.1 }] }] }
    await move(ada, med.id, 'response', { decision: 'respond', response: 'Without the notes.', marks, uploadKey: key }).expect(200)
    for (const agent of [ada, cy]) expect((await agent.get(`${exhibitsUrl()}/${med.id}/file?version=proposal&stream=1`)).status).toBe(200)
    expect((await ada.get(`${exhibitsUrl()}/${inc.id}/file?version=proposal`)).status).toBe(404)

    await move(cy, med.id, 'reconsider', { decision: 'proposal' }).expect(200)
    expect(find(await exhibitsOf(cy), (x) => x.id === med.id)).toMatchObject({ status: 'admitted', redacted: true })
    const served = await cy.get(`${exhibitsUrl()}/${med.id}/file?stream=1`).buffer(true)
    expect(served.headers['content-type']).toBe('image/png')
    void depo
  })

  it('rules on authenticity first, then the objection the teams also kept', async () => {
    const { medical: med, depo, incident: inc } = await exchanged()
    await move(cy, med.id, 'authenticity', { decision: 'challenge', note: 'Unsigned.' }).expect(200)
    await move(ada, med.id, 'authenticity-response', { decision: 'respond', note: 'Signed on page 2.' }).expect(200)
    await move(cy, med.id, 'authenticity-reconsider', { decision: 'keep' }).expect(200)
    await move(cy, med.id, 'admission', { decision: 'challenge', objection: 'Hearsay.' }).expect(200)
    await move(ada, med.id, 'response', { decision: 'respond', response: 'Business records.' }).expect(200)
    await move(cy, med.id, 'reconsider', { decision: 'keep' }).expect(200)
    await move(cy, depo.id, 'authenticity', { decision: 'challenge', note: 'Never certified.' }).expect(200)
    await move(ada, depo.id, 'authenticity-response', { decision: 'respond', note: 'Certified today.' }).expect(200)
    await move(cy, depo.id, 'authenticity-reconsider', { decision: 'keep' }).expect(200)
    await move(cy, depo.id, 'admission', { decision: 'admit' }).expect(200)
    await move(ada, inc.id, 'authenticity', { decision: 'agree' }).expect(200)
    await move(ada, inc.id, 'admission', { decision: 'admit' }).expect(200)

    expect((await waitingForRuling()).map((x) => [x.id, x.status])).toEqual([
      [med.id, 'authenticity_review'],
      [depo.id, 'authenticity_review'],
    ])
    expect((await prof.post(`${reviewsUrl()}/${med.id}/admission`).send({ decision: 'overrule' })).status).toBe(409)
    await prof.post(`${reviewsUrl()}/${med.id}/authenticity`).send({ decision: 'authenticate' }).expect(200)
    await prof.post(`${reviewsUrl()}/${depo.id}/authenticity`).send({ decision: 'reject', note: 'Not certified.' }).expect(200)
    expect(find(await exhibitsOf(ada), (x) => x.id === med.id)).toMatchObject({ status: 'admission_review', authenticated: true })
    expect(find(await exhibitsOf(ada), (x) => x.id === depo.id).status).toBe('inauthentic')
    await prof.post(`${reviewsUrl()}/${med.id}/admission`).send({ decision: 'sustain' }).expect(200)
    const list = await exhibitsOf(ada)
    expect(find(list, (x) => x.id === med.id).status).toBe('excluded')
    expect(list.map((x) => x.label)).toEqual([null, null, 'A'])
  })

  it('without judicial review, puts what the teams kept on the final list as disputed, for the judge in person', async () => {
    expect((await prof.put(`${caseUrl()}/exhibit-judicial-review`).send({ enabled: false })).body.case.exhibitJudicialReview).toBe(false)
    const { medical: med, depo, incident: inc } = await exchanged()
    expect((await mine(ada)).judicialReview).toBe(false)
    // Fixed once the lists are exchanged.
    expect((await prof.put(`${caseUrl()}/exhibit-judicial-review`).send({ enabled: true })).status).toBe(409)

    await move(cy, med.id, 'authenticity', { decision: 'challenge', note: 'Unsigned.' }).expect(200)
    await move(ada, med.id, 'authenticity-response', { decision: 'respond', note: 'Signed on page 2.' }).expect(200)
    await move(cy, med.id, 'authenticity-reconsider', { decision: 'keep' }).expect(200)
    await move(cy, med.id, 'admission', { decision: 'admit' }).expect(200)
    await move(cy, depo.id, 'authenticity', { decision: 'agree' }).expect(200)
    await move(cy, depo.id, 'admission', { decision: 'challenge', objection: 'Hearsay.' }).expect(200)
    await move(ada, depo.id, 'response', { decision: 'respond', response: 'Party admission.' }).expect(200)
    await move(cy, depo.id, 'reconsider', { decision: 'keep' }).expect(200)
    await move(ada, inc.id, 'authenticity', { decision: 'agree' }).expect(200)
    await move(ada, inc.id, 'admission', { decision: 'admit' }).expect(200)

    const list = await exhibitsOf(ada)
    expect(list.map((x) => `${x.label} ${x.status}`)).toEqual(['1 disputed', '2 disputed', 'A admitted'])
    expect(find(list, (x) => x.id === depo.id)).toMatchObject({ objection: 'Hearsay.', response: 'Party admission.', objectionKept: true })
    expect((await mine(ada)).finalizedAt).toEqual(expect.any(String))
    expect(await reviewWorlds()).toEqual([])
  })

  it('numbers the plaintiff’s exhibits and letters the defense’s once nothing is open', async () => {
    await toFinalSteps()
    await submit(ada, [file(medical), file(complaint)])
    await submit(cy, [file(complaint), file(incident)])
    const list = await exhibitsOf(ada)
    for (const x of list.filter((x) => x.status !== 'admitted')) {
      const reviewer = x.offeredBy === 'plaintiff' ? cy : ada
      await move(reviewer, x.id, 'authenticity', { decision: 'agree' }).expect(200)
      await move(reviewer, x.id, 'admission', { decision: 'admit' }).expect(200)
    }
    expect((await exhibitsOf(ada)).map((x) => `${x.label} ${x.title}`)).toEqual([
      '1 Amended complaint.pdf',
      '2 Medical records.pdf',
      'A Incident report.pdf',
    ])
  })

  it("is read-only once the case is closed", async () => {
    const { medical: med } = await exchanged()
    await prof.patch(caseUrl()).send({ title: 'Ramirez v. Thrillville', summary: 'A harness opened.', status: 'closed' })
    expect((await move(cy, med.id, 'authenticity', { decision: 'agree' })).status).toBe(409)
  })
})

describe('the instructor’s view', () => {
  it('counts the teams that submitted and the worlds that finished, and shows every world', async () => {
    await toFinalSteps()
    await submit(ada, [file(complaint)])
    expect((await prof.get(`${caseUrl()}/exhibits/overview`)).body.overview).toEqual({
      teams: 2,
      teamsSubmitted: 1,
      worlds: 1,
      worldsFinalized: 0,
      reviewsWaiting: 0,
    })
    await submit(cy, [file(complaint)])
    expect((await prof.get(`${caseUrl()}/exhibits/overview`)).body.overview).toMatchObject({ teamsSubmitted: 2, worldsFinalized: 1 })

    const [world] = (await prof.get(`${caseUrl()}/exhibits`)).body.worlds
    expect(world).toMatchObject({ worldNumber: 1, teams: { plaintiff: 1, defense: 2 }, finalizedAt: expect.any(String) })
    expect(world.plaintiff.items.map((i: { title: string }) => i.title)).toEqual(['Amended complaint.pdf'])
    expect(world.exhibits.map((x: Exhibit) => `${x.label} ${x.title}`)).toEqual(['1 Amended complaint.pdf'])
  })
})

describe('redacting a partly admitted exhibit', () => {
  /** A PDF whose pages are 100, 200, … points wide, so each can be told apart. */
  async function pdf(pages: number) {
    const doc = await PDFDocument.create()
    for (let i = 1; i <= pages; i++) doc.addPage([i * 100, 500])
    return Buffer.from(await doc.save())
  }
  const widths = async (data: Buffer) => (await PDFDocument.load(data)).getPages().map((p) => p.getWidth())
  const binary = (r: request.Test) =>
    r.buffer(true).parse((res, done) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => done(null, Buffer.concat(chunks)))
    })
  /** Follows the storage redirect (local storage serves the file itself). */
  async function download(agent: request.Agent, url: string) {
    let res = await binary(agent.get(url))
    if (res.status === 302) res = await binary(agent.get(res.headers.location))
    expect(res.status).toBe(200)
    return res.body as Buffer
  }
  const move = (agent: request.Agent, id: string, step: string, body: object) => agent.post(`${exhibitsUrl()}/${id}/${step}`).send(body)
  /** Takes an exhibit of the plaintiff's to the judge on an objection the defense keeps. */
  async function toJudge(id: string) {
    await move(cy, id, 'authenticity', { decision: 'agree' }).expect(200)
    await move(cy, id, 'admission', { decision: 'challenge', objection: 'Hearsay.' }).expect(200)
    await move(ada, id, 'response', { decision: 'respond', response: 'Business records.' }).expect(200)
    await move(cy, id, 'reconsider', { decision: 'keep' }).expect(200)
  }

  it('shows the other side only the listed pages of a file', async () => {
    const records = (await uploadCaseFile(prof, caseUrl(), 'Shift log.pdf', { audience: 'plaintiff' }, await pdf(5))).body.material.id
    await toFinalSteps()
    await submit(ada, [file(records, [2, 4])])
    await submit(cy, [])
    const [x] = await exhibitsOf(cy)
    expect(await widths(await download(cy, `${exhibitsUrl()}/${x.id}/file`))).toEqual([200, 400])
    // The offering side still has the whole file in its case file.
    expect(await widths(await download(ada, `/api/courses/${course.id}/my-cases/${caseId}/materials/${records}/file`))).toHaveLength(5)
    // The instructor sees the same, in the peek.
    expect((await prof.get(`${caseUrl()}/exhibits/${x.id}/file`)).status).not.toBe(404)
  })

  it('stores the redacted copy of a PDF the instructor marked, and serves it to both sides', async () => {
    const records = (await uploadCaseFile(prof, caseUrl(), 'Shift log.pdf', { audience: 'plaintiff' }, await pdf(3))).body.material.id
    await toFinalSteps()
    await submit(ada, [file(records)])
    await submit(cy, [])
    const [x] = await exhibitsOf(ada)
    await toJudge(x.id)

    expect(await widths(await download(prof, `${reviewsUrl()}/${x.id}/file`))).toEqual([100, 200, 300])
    expect((await prof.get(`${reviewsUrl()}/${x.id}/marking`)).body).toEqual({ markable: 'pdf', parts: null })
    // Admitted: a box on page 2 only, so pages 1 and 3 are left out.
    const marks = { mode: 'admit', pages: [{ page: 2, removed: false, boxes: [{ x: 0.1, y: 0.1, w: 0.5, h: 0.2 }] }] }
    const rule = (body: object) => prof.post(`${reviewsUrl()}/${x.id}/admission`).send({ decision: 'partial', marks, ...body })
    expect((await rule({})).status).toBe(400)

    async function uploadRedacted(data: Buffer) {
      const { key, url, headers } = (await prof.post(`${reviewsUrl()}/${x.id}/uploads`).send({ size: data.length }).expect(201)).body.upload
      await prof.put(url).set(headers).send(data).expect(200)
      return key as string
    }
    // A copy with the wrong number of pages is refused.
    expect((await rule({ uploadKey: await uploadRedacted(await pdf(3)) })).status).toBe(400)
    await rule({ uploadKey: await uploadRedacted(await pdf(1)) }).expect(200)

    const [admitted] = await exhibitsOf(cy)
    expect(admitted).toMatchObject({ status: 'admitted', ruling: 'partial', redacted: true })
    for (const agent of [ada, cy]) expect(await widths(await download(agent, `${exhibitsUrl()}/${x.id}/file`))).toEqual([100])
  })

  it('redacts a transcript’s text on the server, keeping only what’s marked admitted', async () => {
    await toFinalSteps()
    await submit(ada, [{ kind: 'deposition', id: deposition, parts: null }])
    await submit(cy, [])
    const [x] = await exhibitsOf(ada)
    await toJudge(x.id)
    const marking = (await prof.get(`${reviewsUrl()}/${x.id}/marking`)).body
    expect(marking.markable).toBe('text')
    expect(marking.parts.map((p: { text: string }) => p.text)).toEqual(['I ran the ride.', 'The light was red.', 'I sent it anyway.'])

    const rule = (marks: object) => prof.post(`${reviewsUrl()}/${x.id}/admission`).send({ decision: 'partial', marks })
    expect((await rule({ mode: 'admit', parts: [{ n: 1, ranges: [{ field: 'text', start: 0, end: 99 }] }] })).status).toBe(400)
    expect((await rule({ mode: 'admit', parts: [] })).status).toBe(400)
    // "The light" and the whole question of turn 2 are admitted; turns 1 and 3 aren't.
    await rule({
      mode: 'admit',
      parts: [{ n: 1, ranges: [{ field: 'text', start: 0, end: 9 }, { field: 'question', start: 0, end: 4 }] }],
    }).expect(200)

    const [admitted] = await exhibitsOf(cy)
    expect(admitted.redacted).toBe(true)
    expect(admitted.excerpt).toEqual([{ n: 1, question: 'And?', objection: null, text: 'The light ████████' }])
  })

  it('redacts marked paragraphs of a text file, and drops the ones left out', async () => {
    const notes = (await uploadCaseFile(prof, caseUrl(), 'Notes.txt', { audience: 'plaintiff' }, Buffer.from('x'))).body.material.id
    await transcriptionsSettled()
    await pool.query(`UPDATE case_materials SET text_status = 'ready', text_content = $2 WHERE id = $1`, [
      notes,
      'Rider was calm.\n\nOperator said the light was red.\n\nWeather was clear.',
    ])
    await toFinalSteps()
    await submit(ada, [file(notes)])
    await submit(cy, [])
    const [x] = await exhibitsOf(ada)
    await toJudge(x.id)
    await prof
      .post(`${reviewsUrl()}/${x.id}/admission`)
      .send({
        decision: 'partial',
        marks: { mode: 'redact', parts: [{ n: 1, ranges: [{ field: 'text', start: 0, end: 13 }] }, { n: 2, removed: true }] },
      })
      .expect(200)
    const [admitted] = await exhibitsOf(cy)
    expect(admitted.excerpt).toEqual([
      { n: 0, text: 'Rider was calm.' },
      { n: 1, text: '█████████████ the light was red.' },
    ])
  })
})

describe('a team redacting parts of a file it lists', () => {
  async function pdf(pages: number) {
    const doc = await PDFDocument.create()
    for (let i = 1; i <= pages; i++) doc.addPage([i * 100, 500])
    return Buffer.from(await doc.save())
  }
  const widths = async (data: Buffer) => (await PDFDocument.load(data)).getPages().map((p) => p.getWidth())
  async function download(agent: request.Agent, url: string) {
    const get = (u: string) =>
      agent
        .get(u)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = []
          res.on('data', (c: Buffer) => chunks.push(c))
          res.on('end', () => done(null, Buffer.concat(chunks)))
        })
    let res = await get(url)
    if (res.status === 302) res = await get(res.headers.location)
    expect(res.status).toBe(200)
    return res.body as Buffer
  }
  async function uploadCopy(agent: request.Agent, materialId: string, data: Buffer) {
    const start = await agent.post(`${exhibitsUrl()}/uploads`).send({ materialId, size: data.length })
    expect(start.status).toBe(201)
    const { key, url, headers } = start.body.upload
    await agent.put(url).set(headers).send(data).expect(200)
    return key as string
  }
  // Pages 2 and 4 of a five-page log, with a box on the first of them (so both stay).
  const marks = { mode: 'redact', pages: [{ page: 1, removed: false, boxes: [{ x: 0.1, y: 0.1, w: 0.3, h: 0.1 }] }] }

  it('keeps the redacted copy with the list, and shows the other side only that', async () => {
    const log = (await uploadCaseFile(prof, caseUrl(), 'Shift log.pdf', { audience: 'plaintiff' }, await pdf(5))).body.material.id
    await toFinalSteps()
    const item = (extra: object) => ({ ...file(log, [2, 4]), marks, ...extra })
    const save = (items: object[]) => ada.put(`${exhibitsUrl()}/list`).send({ items })

    // Marks need their copy, and the copy must have the pages the marks keep.
    expect((await save([item({})])).status).toBe(400)
    expect((await save([item({ uploadKey: await uploadCopy(ada, log, await pdf(3)) })])).status).toBe(400)
    // A text file can't be marked, and a team can only upload for a file it can list.
    expect((await cy.post(`${exhibitsUrl()}/uploads`).send({ materialId: log, size: 10 })).status).toBe(404)

    const copy = await pdf(2)
    await save([item({ uploadKey: await uploadCopy(ada, log, copy) })]).expect(200)
    let [saved] = (await mine(ada)).mine.items
    expect(saved).toMatchObject({ title: 'Shift log.pdf — pages 2, 4 (with redactions)', redactedKey: expect.any(String) })
    expect(saved.marks).toEqual(marks)
    // Saving again keeps the copy, as long as the marks and pages are the same.
    await save([item({ redactedKey: saved.redactedKey })]).expect(200)
    expect((await save([{ ...item({ redactedKey: saved.redactedKey }), parts: [2] }])).status).toBe(400)
    ;[saved] = (await mine(ada)).mine.items

    // The page may still send the upload's key after a save (it was moved then): the saved copy is used.
    const again = await uploadCopy(ada, log, copy)
    await save([item({ uploadKey: again })]).expect(200)
    const resaved = (await mine(ada)).mine.items[0].redactedKey
    await save([item({ uploadKey: again })]).expect(200)
    expect((await mine(ada)).mine.items[0].redactedKey).toBe(resaved)
    ;[saved] = (await mine(ada)).mine.items

    await submit(ada, [item({ redactedKey: saved.redactedKey })]).expect(200)
    await submit(cy, []).expect(200)
    const [x] = await exhibitsOf(cy)
    expect(x).toMatchObject({ status: 'awaiting_authenticity', title: 'Shift log.pdf — pages 2, 4 (with redactions)' })
    expect(await widths(await download(cy, `${exhibitsUrl()}/${x.id}/file`))).toEqual(await widths(copy))
  })

  it('sends the file for redacting from the API itself, never a redirect to storage', async () => {
    const log = (await uploadCaseFile(prof, caseUrl(), 'Shift log.pdf', { audience: 'plaintiff' }, await pdf(3))).body.material.id
    await toFinalSteps()
    const res = await ada.get(`${exhibitsUrl()}/sources/${log}`).buffer(true)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/pdf')
    // Only what the team can list and redact: not the other side's file.
    expect((await cy.get(`${exhibitsUrl()}/sources/${log}`)).status).toBe(404)

    // The instructor's marking window gets the exhibit's bytes the same way.
    await submit(ada, [file(log)])
    await submit(cy, [])
    const [x] = await exhibitsOf(ada)
    expect((await prof.get(`${reviewsUrl()}/${x.id}/file`)).status).toBe(302)
    expect(await widths(await download(prof, `${reviewsUrl()}/${x.id}/file?stream=1`))).toEqual([100, 200, 300])
    expect((await prof.get(`${reviewsUrl()}/${x.id}/file?stream=1`)).status).toBe(200)
  })

  it('counts a file both sides listed as authentic, but sends differently redacted versions on for admission', async () => {
    await toFinalSteps()
    // The complaint's stored test file isn't a real PDF, so it stands in for a picture (one page).
    const both = complaint
    await pool.query(`UPDATE case_materials SET content_type = 'image/png' WHERE id = $1`, [both])
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    await submit(ada, [{ ...file(both), marks, uploadKey: await uploadCopy(ada, both, png) }]).expect(200)
    await submit(cy, [file(both)]).expect(200)
    const list = await exhibitsOf(ada)
    expect(list.map((x) => `${x.offeredBy}${x.joint ? ' joint' : ''}: ${x.title} (${x.status}${x.authenticated ? ', authentic' : ''})`)).toEqual([
      'plaintiff: Amended complaint.pdf (with redactions) (awaiting_admission, authentic)',
      'defense: Amended complaint.pdf (awaiting_admission, authentic)',
    ])
  })
})

describe('two versions of one document before the judge', () => {
  async function pdf(pages: number) {
    const doc = await PDFDocument.create()
    for (let i = 1; i <= pages; i++) doc.addPage([i * 100, 500])
    return Buffer.from(await doc.save())
  }
  const move = (agent: request.Agent, id: string, step: string, body: object) => agent.post(`${exhibitsUrl()}/${id}/${step}`).send(body)
  const versions = (body: object) => prof.post(`${reviewsUrl()}/versions`).send(body)

  /** Pages 1–2 (the plaintiff's) and 3–4 (the defense's) of one log, each objected to and kept for the judge. */
  async function bothInReview() {
    const log = (await uploadCaseFile(prof, caseUrl(), 'Shift log.pdf', { audience: 'all' }, await pdf(5))).body.material.id
    await toFinalSteps()
    await submit(ada, [file(log, [1, 2]), file(medical)])
    await submit(cy, [file(log, [3, 4])])
    const list = await exhibitsOf(ada)
    const p = find(list, (x) => x.sourceId === log && x.offeredBy === 'plaintiff')
    const d = find(list, (x) => x.sourceId === log && x.offeredBy === 'defense')
    const med = find(list, (x) => x.sourceId === medical)
    await move(cy, med.id, 'authenticity', { decision: 'agree' }).expect(200)
    await move(cy, med.id, 'admission', { decision: 'admit' }).expect(200)
    await move(cy, p.id, 'admission', { decision: 'challenge', objection: 'Pages 1–2 are hearsay.' }).expect(200)
    await move(ada, d.id, 'admission', { decision: 'challenge', objection: 'Pages 3–4 mislead without the rest.' }).expect(200)
    await move(ada, p.id, 'response', { decision: 'respond', response: 'Business records.' }).expect(200)
    await move(cy, p.id, 'reconsider', { decision: 'keep' }).expect(200)
    // Nothing reaches the judge while the other version is still with the teams.
    expect(await reviewWorlds()).toEqual([])
    await move(cy, d.id, 'response', { decision: 'respond', response: 'Rule of completeness.' }).expect(200)
    await move(ada, d.id, 'reconsider', { decision: 'keep' }).expect(200)
    return { log, p, d }
  }

  it('lists the two versions together, with the document’s own title', async () => {
    const { p, d } = await bothInReview()
    const reviews = await waitingForRuling()
    expect(reviews.map((r: { id: string; pairedWith: string; sourceTitle: string; title: string }) => [r.id, r.pairedWith, r.sourceTitle, r.title])).toEqual([
      [p.id, d.id, 'Shift log.pdf', 'Shift log.pdf — pages 1–2'],
      [d.id, p.id, 'Shift log.pdf', 'Shift log.pdf — pages 3–4'],
    ])
    // The whole original, for marking a partial ruling.
    expect((await prof.get(`${reviewsUrl()}/${p.id}/marking?whole=1`)).body).toEqual({ markable: 'pdf', parts: null })
    expect((await prof.get(`${reviewsUrl()}/${p.id}/original`)).status).toBe(200)
  })

  it('admits one side’s version as the joint exhibit, and the other gives way', async () => {
    const { p, d } = await bothInReview()
    // Only two versions both before the judge are ruled on together.
    const med = find(await exhibitsOf(ada), (x) => x.sourceId === medical)
    expect((await versions({ ids: [p.id, med.id], decision: 'defense' })).status).toBe(409)
    expect((await versions({ ids: [p.id, p.id], decision: 'defense' })).status).toBe(400)
    await versions({ ids: [p.id, d.id], decision: 'defense', note: 'Completeness wins.' }).expect(200)
    const list = await exhibitsOf(cy)
    expect(find(list, (x) => x.id === d.id)).toMatchObject({ status: 'admitted', joint: true, offeredBy: 'plaintiff', rulingNote: 'Completeness wins.' })
    expect(find(list, (x) => x.id === p.id)).toMatchObject({ status: 'excluded', supersededBy: d.id })
    expect((await versions({ ids: [p.id, d.id], decision: 'plaintiff' })).status).toBe(409)
  })

  it('admits the whole document as the joint exhibit', async () => {
    const { p, d } = await bothInReview()
    await versions({ ids: [p.id, d.id], decision: 'whole' }).expect(200)
    const list = await exhibitsOf(ada)
    expect(find(list, (x) => x.id === p.id)).toMatchObject({ status: 'admitted', joint: true, parts: null, title: 'Shift log.pdf' })
    expect(find(list, (x) => x.id === d.id)).toMatchObject({ status: 'excluded', supersededBy: p.id })
  })

  it('admits a part the judge marks on the whole original', async () => {
    const { p, d } = await bothInReview()
    // Pages 1 and 5 of the original, marked admitted: a two-page copy.
    const marks = {
      mode: 'admit',
      pages: [
        { page: 1, removed: false, boxes: [{ x: 0, y: 0, w: 1, h: 1 }] },
        { page: 5, removed: false, boxes: [{ x: 0, y: 0, w: 1, h: 1 }] },
      ],
    }
    const copy = await pdf(2)
    const { key, url, headers } = (await prof.post(`${reviewsUrl()}/${p.id}/uploads`).send({ size: copy.length }).expect(201)).body.upload
    await prof.put(url).set(headers).send(copy).expect(200)
    // A copy that doesn't match the marks on the whole original (two pages kept) is refused.
    const wrong = await pdf(1)
    const bad = (await prof.post(`${reviewsUrl()}/${p.id}/uploads`).send({ size: wrong.length }).expect(201)).body.upload
    await prof.put(bad.url).set(bad.headers).send(wrong).expect(200)
    expect((await versions({ ids: [p.id, d.id], decision: 'partial', marks, uploadKey: bad.key })).status).toBe(400)

    await versions({ ids: [p.id, d.id], decision: 'partial', marks, uploadKey: key }).expect(200)
    const list = await exhibitsOf(cy)
    expect(find(list, (x) => x.id === p.id)).toMatchObject({ status: 'admitted', ruling: 'partial', redacted: true, title: 'Shift log.pdf' })
    expect(find(list, (x) => x.id === d.id).status).toBe('excluded')
  })

  it('keeps both versions out', async () => {
    const { p, d } = await bothInReview()
    await versions({ ids: [p.id, d.id], decision: 'exclude' }).expect(200)
    const list = await exhibitsOf(ada)
    expect([p.id, d.id].map((id) => find(list, (x) => x.id === id).status)).toEqual(['excluded', 'excluded'])
  })
})
