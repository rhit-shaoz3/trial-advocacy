import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../app.ts'
import { pool } from '../db/pool.ts'
import { storage } from '../storage/storage.ts'
import { createCourseAs, resetDatabase, sampleFacts, signedInAgent } from '../test/helpers.ts'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('a witness')])

let prof: request.Agent
let courseId: string
let caseUrl: string

beforeEach(async () => {
  await resetDatabase()
  prof = (await signedInAgent('instructor')).agent
  courseId = (await createCourseAs(prof)).id
  const created = await prof.post(`/api/courses/${courseId}/cases`).send({ title: 'Rivera v. Thrill Park', summary: 'A rider fell.', importantFacts: sampleFacts })
  caseUrl = `/api/courses/${courseId}/cases/${created.body.case.id}`
})

afterAll(async () => {
  await pool.end()
})

async function addWitness(fields: Record<string, unknown> = {}) {
  const res = await prof.post(`${caseUrl}/witnesses`).send({ name: 'Elena Torres', ...fields })
  return res.body.witness as { id: string; avatarPreset: number | null; avatarUrl: string | null }
}

const uploadPicture = (witnessId: string) =>
  prof.put(`${caseUrl}/witnesses/${witnessId}/avatar`).set('Content-Type', 'image/png').send(PNG)

async function storedKey(witnessId: string) {
  const { rows } = await pool.query<{ avatar_key: string | null }>('SELECT avatar_key FROM case_witnesses WHERE id = $1', [witnessId])
  return rows[0]?.avatar_key ?? null
}

describe('picture designs', () => {
  it('gives the witness one of the 12 designs', async () => {
    const witness = await addWitness({ avatarPreset: 3 })
    expect(witness).toMatchObject({ avatarPreset: 3, avatarUrl: '/witness-avatars/03.svg' })

    const edited = await prof.put(`${caseUrl}/witnesses/${witness.id}`).send({ name: 'Elena Torres', avatarPreset: 12 })
    expect(edited.body.witness.avatarUrl).toBe('/witness-avatars/12.svg')
  })

  it('has no picture unless one is chosen', async () => {
    expect(await addWitness()).toMatchObject({ avatarPreset: null, avatarUrl: null })
  })

  it('rejects anything but a design number', async () => {
    for (const avatarPreset of [0, 13, 2.5, '3']) {
      const res = await prof.post(`${caseUrl}/witnesses`).send({ name: 'Elena Torres', avatarPreset })
      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Choose one of the 12 pictures.')
    }
  })
})

describe('uploaded pictures', () => {
  it('replaces the design with the uploaded picture', async () => {
    const witness = await addWitness({ avatarPreset: 3 })

    const res = await uploadPicture(witness.id)

    expect(res.status).toBe(200)
    expect(res.body.witness.avatarPreset).toBeNull()
    expect(res.body.witness.avatarUrl).toMatch(new RegExp(`^/api/witnesses/${witness.id}/avatar\\?v=[0-9a-f-]{36}$`))
    expect(await storage.read((await storedKey(witness.id))!)).toEqual(PNG)
  })

  it('keeps the picture when the witness is saved without a design, and drops it for one', async () => {
    const witness = await addWitness()
    const { avatarUrl } = (await uploadPicture(witness.id)).body.witness
    const key = await storedKey(witness.id)

    const saved = await prof.put(`${caseUrl}/witnesses/${witness.id}`).send({ name: 'Elena Torres', role: 'Ride operator' })
    expect(saved.body.witness.avatarUrl).toBe(avatarUrl)

    const designed = await prof.put(`${caseUrl}/witnesses/${witness.id}`).send({ name: 'Elena Torres', avatarPreset: 5 })
    expect(designed.body.witness.avatarUrl).toBe('/witness-avatars/05.svg')
    expect(await storedKey(witness.id)).toBeNull()
    expect(await storage.size(key!)).toBeNull()
  })

  it('removes the uploaded picture', async () => {
    const witness = await addWitness()
    await uploadPicture(witness.id)
    const key = await storedKey(witness.id)

    const res = await prof.delete(`${caseUrl}/witnesses/${witness.id}/avatar`)

    expect(res.body.witness).toMatchObject({ avatarPreset: null, avatarUrl: null })
    expect(await storage.size(key!)).toBeNull()
  })

  it('accepts only PNG and JPEG, for a witness in this case', async () => {
    const witness = await addWitness()
    const svg = await prof
      .put(`${caseUrl}/witnesses/${witness.id}/avatar`)
      .set('Content-Type', 'image/png')
      .send(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))
    expect(svg.status).toBe(400)

    const unknown = await uploadPicture('00000000-0000-4000-8000-000000000000')
    expect(unknown.status).toBe(404)
  })

  it('deletes the stored picture with the witness, and with the case', async () => {
    const first = await addWitness()
    await uploadPicture(first.id)
    const firstKey = await storedKey(first.id)
    await prof.delete(`${caseUrl}/witnesses/${first.id}`)
    expect(await storage.size(firstKey!)).toBeNull()

    const second = await addWitness()
    await uploadPicture(second.id)
    const secondKey = await storedKey(second.id)
    await prof.delete(caseUrl)
    expect(await storage.size(secondKey!)).toBeNull()
  })
})

describe('GET /api/witnesses/:id/avatar', () => {
  it("shows the picture to the course's instructor and students, and no one else", async () => {
    const witness = await addWitness()
    const { avatarUrl } = (await uploadPicture(witness.id)).body.witness
    await prof.post(`/api/courses/${courseId}/roster`).send({ emails: ['ada@example.com'] })
    const { agent: student } = await signedInAgent('student', 'ada@example.com')
    const { agent: outsider } = await signedInAgent('student', 'eve@example.com')

    const seen = await student.get(avatarUrl).buffer(true)
    expect(seen.status).toBe(200)
    expect(seen.headers['content-type']).toBe('image/png')
    expect(Buffer.from(seen.body)).toEqual(PNG)
    expect((await prof.get(avatarUrl)).status).toBe(200)
    expect((await outsider.get(avatarUrl)).status).toBe(404)
    expect((await request(app).get(avatarUrl)).status).toBe(401)
  })
})

describe('pictures in interviews', () => {
  it("shows the witness's picture", async () => {
    const witness = await addWitness({ avatarPreset: 7 })

    const { interview } = (await prof.get(`${caseUrl}/witnesses/${witness.id}/interview?side=plaintiff`)).body

    expect(interview.witness).toMatchObject({ name: 'Elena Torres', avatarUrl: '/witness-avatars/07.svg' })
  })
})
