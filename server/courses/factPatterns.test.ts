import type request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/pool.ts'
import { createCourseAs, resetDatabase, signedInAgent } from '../test/helpers.ts'

let prof: request.Agent
let course: { id: string; entryCode: string }

beforeEach(async () => {
  await resetDatabase()
  prof = (await signedInAgent('instructor', 'prof@example.com')).agent
  course = await createCourseAs(prof)
})

afterAll(async () => {
  await pool.end()
})

const baseUrl = () => `/api/courses/${course.id}/fact-patterns`
const pdfBytes = Buffer.from('%PDF-1.7\nfake pdf for tests\n')

function upload(agent: request.Agent, filename: string, data: Buffer = pdfBytes, type = 'application/pdf') {
  return agent
    .post(baseUrl())
    .set('Content-Type', type)
    .set('X-Filename', encodeURIComponent(filename))
    .send(data)
}

describe('uploading', () => {
  it('stores the file and lists it without the contents', async () => {
    const res = await upload(prof, 'State v. Hale – fact pattern.pdf')

    expect(res.status).toBe(201)
    expect(res.body.factPattern).toEqual({
      id: expect.any(String),
      filename: 'State v. Hale – fact pattern.pdf',
      sizeBytes: pdfBytes.length,
      uploadedAt: expect.any(String),
    })

    const list = await prof.get(baseUrl())
    expect(list.body.factPatterns).toEqual([res.body.factPattern])
  })

  it('accepts Word and text files whatever type the browser claims', async () => {
    expect((await upload(prof, 'brief.docx', Buffer.from('PK..'), 'application/octet-stream')).status).toBe(201)
    expect((await upload(prof, 'notes.TXT', Buffer.from('hello'), 'text/plain')).status).toBe(201)
  })

  it('rejects other file types', async () => {
    const res = await upload(prof, 'evil.html', Buffer.from('<script>alert(1)</script>'), 'text/html')

    expect(res.status).toBe(415)
    expect(res.body.error).toBe('Upload a PDF, Word document, or text file.')
  })

  it('drops any folder path from the name', async () => {
    const res = await upload(prof, 'C:\\Users\\prof\\Desktop\\case.pdf')

    expect(res.body.factPattern.filename).toBe('case.pdf')
  })

  it('rejects empty files and missing names', async () => {
    expect((await upload(prof, 'empty.pdf', Buffer.alloc(0))).body.error).toBe('The file is empty.')
    expect((await upload(prof, '')).body.error).toBe('The file needs a name.')
  })

  it('rejects files over 10 MB', async () => {
    const res = await upload(prof, 'huge.pdf', Buffer.alloc(10 * 1024 * 1024 + 1))

    expect(res.status).toBe(413)
    expect(res.body.error).toBe('That file is too large. The limit is 10 MB.')
  })
})

describe('downloading', () => {
  it('returns the original bytes as an attachment with a safe content type', async () => {
    const { id } = (await upload(prof, 'case.pdf', pdfBytes, 'text/html')).body.factPattern

    const res = await prof
      .get(`${baseUrl()}/${id}/file`)
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = []
        r.on('data', (c: Buffer) => chunks.push(c))
        r.on('end', () => done(null, Buffer.concat(chunks)))
      })

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/pdf')
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="case.pdf"/)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(Buffer.compare(res.body, pdfBytes)).toBe(0)
  })

  it('404s for unknown and malformed ids', async () => {
    expect((await prof.get(`${baseUrl()}/00000000-0000-0000-0000-000000000000/file`)).status).toBe(404)
    expect((await prof.get(`${baseUrl()}/nope/file`)).status).toBe(404)
  })
})

describe('deleting', () => {
  it('removes the file', async () => {
    const { id } = (await upload(prof, 'case.pdf')).body.factPattern

    expect((await prof.delete(`${baseUrl()}/${id}`)).status).toBe(204)
    expect((await prof.get(baseUrl())).body.factPatterns).toEqual([])
    expect((await prof.delete(`${baseUrl()}/${id}`)).status).toBe(404)
  })
})

describe('access', () => {
  it('is limited to the instructor who teaches the course', async () => {
    const { id } = (await upload(prof, 'case.pdf')).body.factPattern
    const { agent: other } = await signedInAgent('instructor', 'other@example.com')
    const { agent: student } = await signedInAgent('student', 'ada@example.com')
    await student.post('/api/courses/join').send({ entryCode: course.entryCode })

    for (const agent of [other, student]) {
      expect((await agent.get(baseUrl())).status).toBe(404)
      expect((await upload(agent, 'mine.pdf')).status).toBe(404)
      expect((await agent.get(`${baseUrl()}/${id}/file`)).status).toBe(404)
      expect((await agent.delete(`${baseUrl()}/${id}`)).status).toBe(404)
    }
    expect((await prof.get(baseUrl())).body.factPatterns).toHaveLength(1)
  })
})
