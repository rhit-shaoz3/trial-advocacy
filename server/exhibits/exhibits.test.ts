import type request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/pool.ts'
import { PDFDocument } from 'pdf-lib'
import { createCourseAs, resetDatabase, sampleFacts, signedInAgent, uploadCaseFile } from '../test/helpers.ts'

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

const upload = async (filename: string, audience: string) =>
  (await uploadCaseFile(prof, caseUrl(), filename, { audience })).body.material.id as string

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

describe('building an exhibit list', () => {
  it('opens in the final steps phase, with the files, reports and depositions the team can list', async () => {
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
    const theirs = await mine(cy)
    expect(theirs.options.map((o: { title: string }) => o.title)).toEqual([
      'Amended complaint.pdf',
      'Incident report.pdf',
      expect.stringMatching(/^John Hastings's report \(/),
    ])
    expect(theirs.options[2].parts.map((p: { text: string }) => p.text)).toEqual([
      'The plaintiff skipped the safety video.',
      'She signed the waiver at 2:04 PM.',
    ])
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
    await toFinalSteps()
    await submit(ada, [{ kind: 'deposition', id: deposition, parts: [1] }])
    await submit(cy, [{ kind: 'report', id: report, parts: [1] }])
    await pool.query('DELETE FROM interview_turns WHERE interview_id = $1', [deposition])
    const list = await exhibitsOf(cy)
    expect(list.map((x) => x.excerpt?.map((p) => p.text))).toEqual([['The light was red.'], ['She signed the waiver at 2:04 PM.']])
    expect(list[1].title).toMatch(/report \(.*\) — paragraph 2$/)
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

  it('sends a challenge to the instructor, even in review lite, who authenticates or rejects it', async () => {
    await prof.put(`${caseUrl()}/review-mode`).send({ reviewMode: 'lite' })
    const { medical: med, depo } = await exchanged()
    await move(cy, med.id, 'authenticity', { decision: 'challenge', note: 'No custodian can vouch for these.' }).expect(200)
    await move(cy, depo.id, 'authenticity', { decision: 'challenge', note: 'The transcript was never certified.' }).expect(200)

    const open = (await prof.get(reviewsUrl())).body.reviews
    expect(open.map((r: { title: string; status: string; authenticityNote: string }) => [r.status, r.authenticityNote])).toEqual([
      ['authenticity_review', 'No custodian can vouch for these.'],
      ['authenticity_review', 'The transcript was never certified.'],
    ])
    expect(open[0]).toMatchObject({ caseTitle: 'Ramirez v. Thrillville', worldNumber: 1, teams: { plaintiff: 1, defense: 2 } })
    expect((await prof.get(`/api/courses/${course.id}/home`)).body.reviewCount).toBe(2)

    expect((await prof.post(`${reviewsUrl()}/${med.id}/authenticity`).send({ decision: 'authenticate' })).status).toBe(200)
    await prof.post(`${reviewsUrl()}/${depo.id}/authenticity`).send({ decision: 'reject', note: 'Not certified.' }).expect(200)
    const list = await exhibitsOf(ada)
    expect(find(list, (x) => x.id === med.id)).toMatchObject({ status: 'awaiting_admission', authenticated: true })
    expect(find(list, (x) => x.id === depo.id).status).toBe('inauthentic')
    expect((await mine(ada)).notices.rulings).toBe(2)
    expect((await prof.get(`${reviewsUrl()}?status=completed`)).body.reviews).toHaveLength(2)
  })

  it('lets the offering side drop an exhibit objected to, or send it to the judge, who rules on it', async () => {
    const { medical: med, depo, incident: inc } = await exchanged()
    for (const x of [med, depo]) {
      await move(cy, x.id, 'authenticity', { decision: 'agree' }).expect(200)
      await move(cy, x.id, 'admission', { decision: 'challenge', objection: 'Hearsay in the doctor’s notes.' }).expect(200)
    }
    expect((await mine(ada)).notices.objections).toBe(2)
    expect((await move(cy, med.id, 'response', { decision: 'drop' })).status).toBe(409)
    expect((await move(ada, med.id, 'response', { decision: 'review' })).status).toBe(400)

    await move(ada, depo.id, 'response', { decision: 'drop' }).expect(200)
    await move(ada, med.id, 'response', { decision: 'review', response: 'Business records.', acceptsRedaction: 'Page 4.' }).expect(200)
    const [review] = (await prof.get(reviewsUrl())).body.reviews
    expect(review).toMatchObject({ status: 'admission_review', objection: 'Hearsay in the doctor’s notes.', response: 'Business records.', acceptsRedaction: 'Page 4.' })

    expect((await prof.post(`${reviewsUrl()}/${med.id}/admission`).send({ decision: 'partial' })).status).toBe(400)
    await prof.post(`${reviewsUrl()}/${med.id}/admission`).send({ decision: 'partial', redaction: 'Page 4' }).expect(200)

    // The defense's own exhibit is still open, so the list isn't final yet.
    let list = await exhibitsOf(ada)
    expect(find(list, (x) => x.id === med.id)).toMatchObject({ status: 'admitted', redaction: 'Page 4', ruling: 'partial' })
    expect(find(list, (x) => x.id === depo.id).status).toBe('dropped')
    expect(list.every((x) => x.label === null)).toBe(true)

    await move(ada, inc.id, 'authenticity', { decision: 'agree' }).expect(200)
    await move(ada, inc.id, 'admission', { decision: 'challenge', objection: 'Irrelevant.' }).expect(200)
    await move(cy, inc.id, 'response', { decision: 'review', response: 'It shows the harness was checked.' }).expect(200)
    await prof.post(`${reviewsUrl()}/${inc.id}/admission`).send({ decision: 'sustain' }).expect(200)

    list = await exhibitsOf(ada)
    expect(find(list, (x) => x.id === inc.id).status).toBe('excluded')
    expect(list.map((x) => x.label)).toEqual(['1', null, null])
    expect((await mine(cy)).notices.finalized).toBe(true)
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
  /** Takes an exhibit of the plaintiff's to the judge on an objection. */
  async function toJudge(id: string) {
    await move(cy, id, 'authenticity', { decision: 'agree' }).expect(200)
    await move(cy, id, 'admission', { decision: 'challenge', objection: 'Hearsay.' }).expect(200)
    await move(ada, id, 'response', { decision: 'review', response: 'Business records.' }).expect(200)
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

  it('blacks out a transcript’s text on the server, keeping only what’s marked admitted', async () => {
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
