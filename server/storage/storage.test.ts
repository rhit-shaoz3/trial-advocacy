import type request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/pool.ts'
import { createCourseAs, resetDatabase, signedInAgent, uploadCaseFile } from '../test/helpers.ts'
import { attachmentHeader } from './shared.ts'
import { storage } from './storage.ts'

let prof: request.Agent
let caseUrl: string
let caseId: string

beforeEach(async () => {
  await resetDatabase()
  prof = (await signedInAgent('instructor', 'prof@example.com')).agent
  const course = await createCourseAs(prof)
  caseId = (await prof.post(`/api/courses/${course.id}/cases`).send({ title: 'Rivera' })).body.case.id
  caseUrl = `/api/courses/${course.id}/cases/${caseId}`
})

afterAll(async () => {
  await pool.end()
})

const storageKeyOf = async (materialId: string) =>
  (await pool.query('SELECT storage_key AS key, data FROM case_materials WHERE id = $1', [materialId])).rows[0]

describe('uploading case files', () => {
  it('stores the file outside the database, under a key the app chose', async () => {
    const res = await uploadCaseFile(prof, caseUrl, 'Section 1 - Facts.pdf', {}, Buffer.from('%PDF facts'))

    expect(res.status).toBe(201)
    const { key, data } = await storageKeyOf(res.body.material.id)
    expect(key).toBe(`cases/${caseId}/${res.body.material.id}`)
    expect(data).toBeNull()
    expect(await storage.size(key)).toBe(10)
  })

  it('hands out upload links that only accept the approved file', async () => {
    const start = await prof.post(`${caseUrl}/materials/uploads`).send({ filename: 'a.pdf', size: 5 })
    const { url, headers } = start.body.upload

    expect((await prof.put(url).set(headers).send(Buffer.from('too long'))).status).toBe(403)
    expect((await prof.put(url).set('Content-Type', 'text/html').send(Buffer.from('12345'))).status).toBe(403)
    expect((await prof.put(url.replace('size=5', 'size=6')).set(headers).send(Buffer.from('123456'))).status).toBe(403)
    expect((await prof.put(url).set(headers).send(Buffer.from('12345'))).status).toBe(200)
  })

  it("won't add an upload that never finished, or one started for another case", async () => {
    const start = await prof.post(`${caseUrl}/materials/uploads`).send({ filename: 'a.pdf', size: 5 })
    const unfinished = await prof.post(`${caseUrl}/materials`).send({ uploadKey: start.body.upload.key, filename: 'a.pdf' })
    expect(unfinished.status).toBe(400)
    expect(unfinished.body.error).toBe('The upload did not finish. Try again.')

    const otherCase = (await prof.post(caseUrl.replace(/\/cases\/.*/, '/cases')).send({ title: 'Other' })).body.case.id
    const foreign = await prof
      .post(`${caseUrl}/materials`)
      .send({ uploadKey: `uploads/${otherCase}/00000000-0000-4000-8000-000000000000`, filename: 'a.pdf' })
    expect(foreign.status).toBe(400)
    expect(foreign.body.error).toBe('That upload is not for this case.')
    expect((await prof.post(`${caseUrl}/materials`).send({ uploadKey: '../../etc/passwd', filename: 'a.pdf' })).status).toBe(400)
  })

  it('refuses forged or tampered download links', async () => {
    const res = await uploadCaseFile(prof, caseUrl, 'a.pdf')
    const link = (await prof.get(`${caseUrl}/materials/${res.body.material.id}/file`)).headers.location as string

    expect((await prof.get(link.replace(/sig=[^&]+/, 'sig=forged'))).status).toBe(403)
    expect((await prof.get(link.replace('op=get', 'op=put'))).status).toBe(403)
    expect((await prof.get(link)).status).toBe(200)
  })
})

describe('removing case files', () => {
  it('deletes the stored file with its material, and all of them with the case', async () => {
    const one = (await uploadCaseFile(prof, caseUrl, 'one.pdf')).body.material.id
    const two = (await uploadCaseFile(prof, caseUrl, 'two.pdf')).body.material.id
    const keyOne = (await storageKeyOf(one)).key
    const keyTwo = (await storageKeyOf(two)).key

    await prof.delete(`${caseUrl}/materials/${one}`)
    expect(await storage.size(keyOne)).toBeNull()
    expect(await storage.size(keyTwo)).not.toBeNull()

    await prof.delete(caseUrl)
    expect(await storage.size(keyTwo)).toBeNull()
  })
})

describe('files from before object storage', () => {
  it('still downloads a file kept in the database', async () => {
    const { rows } = await pool.query(
      `INSERT INTO case_materials (case_id, filename, content_type, size_bytes, data)
       VALUES ($1, 'old.txt', 'text/plain; charset=utf-8', 3, $2) RETURNING id`,
      [caseId, Buffer.from('old')],
    )

    const res = await prof.get(`${caseUrl}/materials/${rows[0].id}/file`)
    expect(res.status).toBe(200)
    expect(res.text).toBe('old')
    expect(res.headers['content-disposition']).toContain('attachment')
  })
})

describe('attachmentHeader', () => {
  it('keeps the real name and gives old browsers a safe fallback', () => {
    expect(attachmentHeader('Exhibit "A" – café.pdf')).toBe(
      `attachment; filename="Exhibit _A_ _ caf_.pdf"; filename*=UTF-8''Exhibit%20%22A%22%20%E2%80%93%20caf%C3%A9.pdf`,
    )
  })
})
