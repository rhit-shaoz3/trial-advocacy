import type request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ai } from '../ai/ai.ts'
import { pool } from '../db/pool.ts'
import { storage } from '../storage/storage.ts'
import { createCourseAs, fallTrial, resetDatabase, sampleFacts, signedInAgent, uploadCaseFile } from '../test/helpers.ts'
import { transcriptionsSettled } from './materialText.ts'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('a witness')])

let prof: request.Agent
let course: { id: string }
let otherCourse: { id: string }
let caseId: string
let complaint: string
let deposition: string
let photos: string
let elena: string
const email = (n: number) => `s${n}@example.com`
const caseUrl = () => `/api/courses/${course.id}/cases/${caseId}`

const upload = async (filename: string, audience: string, text: string) =>
  (await uploadCaseFile(prof, caseUrl(), filename, { audience, description: filename.replace(/\.\w+$/, '') }, Buffer.from(text))).body
    .material.id as string

const keyOf = async (materialId: string) =>
  (await pool.query<{ key: string }>('SELECT storage_key AS key FROM case_materials WHERE id = $1', [materialId])).rows[0].key

beforeEach(async () => {
  await resetDatabase()
  prof = (await signedInAgent('instructor', 'prof@example.com', 'Prof. Ruiz')).agent
  course = await createCourseAs(prof)
  otherCourse = await createCourseAs(prof, { ...fallTrial, code: 'LAW 640', year: 2027 })
  await prof.post(`/api/courses/${course.id}/roster`).send({ emails: [1, 2].map(email) })
  caseId = (
    await prof.post(`/api/courses/${course.id}/cases`).send({
      title: 'Winston v. Thrillville',
      summary: 'A rider was hurt.',
      importantFacts: sampleFacts,
      plaintiffName: 'Paige Winston',
      defendantName: 'Thrillville Parks',
    })
  ).body.case.id
  complaint = await upload('Complaint.txt', 'all', 'The complaint.')
  await prof.put(`${caseUrl()}/materials/initial`).send({ materialId: complaint })
  deposition = await upload('Elena deposition.txt', 'instructor', 'Elena testified.')
  photos = await upload('Photos.txt', 'plaintiff', 'Three photos.')
  await transcriptionsSettled()
  elena = (
    await prof.post(`${caseUrl()}/witnesses`).send({
      name: 'Elena Torres',
      role: 'Ride operator',
      description: 'At the controls.',
      audience: 'defense',
      alignedSide: 'defense',
      depositionMaterialId: deposition,
      knownMaterialIds: [photos],
    })
  ).body.witness.id
  await prof.put(`${caseUrl()}/witnesses/${elena}/avatar`).set('Content-Type', 'image/png').send(PNG)
  await prof.post(`${caseUrl()}/tasks`).send({ title: 'Read the complaint', dueAt: '2026-09-01T12:00:00Z', audience: 'all' })
  await prof.put(`${caseUrl()}/investigator`).send({ enabled: true, name: 'Rita Vance', instructions: 'Be terse.' })
  await prof.put(`${caseUrl()}/exchange`).send({
    disclosures: { enabled: true },
    subpoenas: { enabled: true, limit: 2, days: 10, types: ['inspection'] },
    interrogatories: { enabled: true, limit: 5, days: 30, aiFeedback: { enabled: true, rounds: 4 } },
    rfas: { enabled: false, limit: 3, days: 14, aiFeedback: { enabled: false, rounds: null } },
    firms: { plaintiff: { firm: 'Hale LLP', partner: 'Margaret Hale' }, defense: { firm: 'Stone LLP', partner: 'Ray Stone' } },
  })
  await prof.put(`${caseUrl()}/exchange/disclosures`).send({ materialIds: [photos], witnessIds: [elena] })
  await prof.post(`${caseUrl()}/exchange/complete`)

  // Played: a team and a world, a file shared with the team, and a world's own subpoena response.
  const team = (await prof.post(`${caseUrl()}/teams`).send({ emails: [email(1)] })).body.teams[0]
  const other = (await prof.post(`${caseUrl()}/teams`).send({ emails: [email(2)] })).body.teams[1]
  const world = (await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: team.id, defenseTeamId: other.id })).body.matchups[0]
  await pool.query('INSERT INTO material_shares (material_id, team_id) VALUES ($1, $2)', [deposition, team.id])
  await pool.query(
    `INSERT INTO case_materials (case_id, audience, filename, description, content_type, size_bytes, matchup_id, text_status, text_content)
     VALUES ($1, 'instructor', 'Response.txt', 'Response of Mercy to subpoena (Team 1)', 'text/plain', 4, $2, 'ready', 'text')`,
    [caseId, world.id],
  )
  expect((await prof.post(`${caseUrl()}/launch`)).status).toBe(200)
  await prof.put(`${caseUrl()}/phase`).send({ phase: 'information_exchange' })
})

afterAll(async () => {
  await pool.end()
})

describe('duplicating a case', () => {
  it('copies the case as written into another class, and leaves what was played behind', async () => {
    let read = 0
    ai.transcribe = async () => {
      read++
      return 'read again'
    }
    const res = await prof.post(`${caseUrl()}/duplicate`).send({ courseId: otherCourse.id, includeTasks: true })
    expect(res.status).toBe(201)
    const copy = res.body.case
    expect(copy).toMatchObject({
      title: 'Winston v. Thrillville',
      summary: 'A rider was hurt.',
      status: 'draft',
      phase: 'introduction',
      parties: { plaintiff: 'Paige Winston', defendant: 'Thrillville Parks' },
      importantFacts: sampleFacts,
      investigator: { enabled: true, name: 'Rita Vance', instructions: 'Be terse.' },
      setupCompletedAt: null,
      exchangeReady: false,
      copySetup: true,
      copiedFrom: { title: 'Winston v. Thrillville', owner: 'Prof. Ruiz' },
    })
    expect(copy.id).not.toBe(caseId)
    const copyUrl = `/api/courses/${otherCourse.id}/cases/${copy.id}`

    // Every case file but the world's own, instructors only except the starting file, with the text already read.
    const files = (await prof.get(`${copyUrl}/materials`)).body.materials as {
      id: string
      filename: string
      audience: string
      initial: boolean
      textStatus: string
      shares: { teamIds: string[] }
    }[]
    expect(files.map((f) => [f.filename, f.audience, f.initial, f.textStatus])).toEqual([
      ['Complaint.txt', 'all', true, 'ready'],
      ['Elena deposition.txt', 'instructor', false, 'ready'],
      ['Photos.txt', 'instructor', false, 'ready'],
    ])
    expect(files.every((f) => f.shares.teamIds.length === 0)).toBe(true)
    // Only the instructor's own files come along, still marked as theirs.
    expect((await pool.query<{ source: string }>('SELECT DISTINCT source FROM case_materials WHERE case_id = $1', [copy.id])).rows).toEqual([
      { source: 'instructor' },
    ])
    const byName = Object.fromEntries(files.map((f) => [f.filename, f.id]))
    expect((await prof.get(`${copyUrl}/materials/${byName['Elena deposition.txt']}/text`)).text).toBe('Elena testified.')
    await transcriptionsSettled()
    expect(read).toBe(0)
    // Its own stored copy, still there once the original is gone.
    const copiedKey = await keyOf(byName['Photos.txt'])
    expect(copiedKey).toBe(`cases/${copy.id}/${byName['Photos.txt']}`)
    expect((await prof.delete(caseUrl())).status).toBe(204)
    expect((await storage.read(copiedKey)).toString()).toBe('Three photos.')

    // The witness, pointing at the copy's files, with its own picture.
    const [witness] = (await prof.get(`${copyUrl}/witnesses`)).body.witnesses
    expect(witness).toMatchObject({
      name: 'Elena Torres',
      role: 'Ride operator',
      description: 'At the controls.',
      audience: 'defense',
      alignedSide: 'defense',
      depositionMaterialId: byName['Elena deposition.txt'],
      knownMaterialIds: [byName['Photos.txt']],
    })
    expect(witness.id).not.toBe(elena)
    const avatarKey = (await pool.query<{ key: string }>('SELECT avatar_key AS key FROM case_witnesses WHERE id = $1', [witness.id])).rows[0].key
    expect(avatarKey).toMatch(new RegExp(`^witnesses/${witness.id}/`))
    expect(await storage.read(avatarKey)).toEqual(PNG)

    // Tasks without last term's dates; the exchange setup to look over again.
    expect((await prof.get(`${copyUrl}/tasks`)).body.tasks).toEqual([expect.objectContaining({ title: 'Read the complaint', dueAt: null })])
    const exchange = (await prof.get(`${copyUrl}/exchange`)).body.settings
    expect(exchange).toMatchObject({
      setupCompletedAt: null,
      subpoenas: { enabled: true, limit: 2, days: 10, types: ['inspection'], aiFeedback: { enabled: true, rounds: 2 } },
      interrogatories: { aiFeedback: { enabled: true, rounds: 4 } },
      rfas: { enabled: false, aiFeedback: { enabled: false, rounds: null } },
      firms: { plaintiff: { firm: 'Hale LLP' } },
      disclosures: { materialIds: [byName['Photos.txt']], witnessIds: [witness.id] },
    })

    // No teams or worlds: the new class's students are paired in the copy's setup.
    expect((await prof.get(`${copyUrl}/teams`)).body).toMatchObject({ teams: [], matchups: [] })
    const done = await prof.post(`${copyUrl}/setup/complete`)
    expect(done.body.case).toMatchObject({ copySetup: false, setupCompletedAt: expect.any(String) })
  })

  it('can leave the tasks out, rename the copy, and stay in the same class', async () => {
    const res = await prof.post(`${caseUrl()}/duplicate`).send({ includeTasks: false, title: 'Winston v. Thrillville (2027)' })
    expect(res.status).toBe(201)
    expect(res.body.courseId).toBe(course.id)
    expect(res.body.case.title).toBe('Winston v. Thrillville (2027)')
    expect((await prof.get(`/api/courses/${course.id}/cases/${res.body.case.id}/tasks`)).body.tasks).toEqual([])
  })

  it("only goes to the instructor's own classes", async () => {
    const someone = (await signedInAgent('instructor', 'other@example.com', 'Prof. Other')).agent
    const theirs = await createCourseAs(someone)
    expect((await prof.post(`${caseUrl()}/duplicate`).send({ courseId: theirs.id })).status).toBe(404)
  })
})

describe('sharing a case', () => {
  let kim: request.Agent
  beforeEach(async () => {
    kim = (await signedInAgent('instructor', 'kim@example.com', 'Prof. Kim')).agent
    await signedInAgent('student', 'stu@example.com', 'Stu Dent')
  })
  const share = (to: string, includeTasks = true) => prof.post(`${caseUrl()}/share`).send({ email: to, includeTasks })

  it('needs an instructor who has an account', async () => {
    expect((await share('nobody@example.com')).body).toEqual({ error: 'No one has an account with that email.' })
    expect((await share('nobody@example.com')).status).toBe(404)
    const student = await share('STU@example.com')
    expect(student.status).toBe(400)
    expect(student.body.error).toBe('That email belongs to a student. Cases can only be shared with instructors.')
    expect((await share('prof@example.com')).body.error).toBe("That's you. Use Duplicate to copy a case into one of your classes.")
    const ok = await share('Kim@Example.com')
    expect(ok.status).toBe(201)
    expect(ok.body.share).toEqual({ toName: 'Prof. Kim', toEmail: 'kim@example.com' })
  })

  it('waits for the other instructor, who declines it or accepts it into a class', async () => {
    await share('kim@example.com', false)
    await share('kim@example.com', false) // once, however often it's shared
    const [waiting] = (await kim.get('/api/courses/shared-cases')).body.shares
    expect((await kim.get('/api/courses/shared-cases')).body.shares).toHaveLength(1)
    expect(waiting).toMatchObject({ caseTitle: 'Winston v. Thrillville', fromName: 'Prof. Ruiz', fromEmail: 'prof@example.com', includeTasks: false })
    // Nobody else can see or act on it.
    expect((await prof.get('/api/courses/shared-cases')).body.shares).toEqual([])
    expect((await prof.post(`/api/courses/shared-cases/${waiting.id}/decline`)).status).toBe(404)

    const kimsClass = await createCourseAs(kim)
    expect((await kim.post(`/api/courses/shared-cases/${waiting.id}/accept`).send({ courseId: course.id })).status).toBe(404)
    const accepted = await kim.post(`/api/courses/shared-cases/${waiting.id}/accept`).send({ courseId: kimsClass.id })
    expect(accepted.status).toBe(201)
    expect(accepted.body).toMatchObject({ courseId: kimsClass.id, case: { title: 'Winston v. Thrillville', status: 'draft', copySetup: true } })
    expect((await kim.get(`/api/courses/${kimsClass.id}/cases/${accepted.body.case.id}/tasks`)).body.tasks).toEqual([])
    expect((await kim.get('/api/courses/shared-cases')).body.shares).toEqual([])

    await share('kim@example.com')
    const [again] = (await kim.get('/api/courses/shared-cases')).body.shares
    expect((await kim.post(`/api/courses/shared-cases/${again.id}/decline`)).status).toBe(204)
    expect((await kim.get('/api/courses/shared-cases')).body.shares).toEqual([])
    expect((await kim.get(`/api/courses/${kimsClass.id}/cases`)).body.cases).toHaveLength(1)
  })

  it('goes away when the original case is deleted', async () => {
    await share('kim@example.com')
    await prof.delete(caseUrl())
    expect((await kim.get('/api/courses/shared-cases')).body.shares).toEqual([])
  })
})
