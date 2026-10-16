import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpCourseService } from './httpCourseService'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('uploadMaterial', () => {
  const file = new File(['%PDF'], 'Section 1.pdf', { type: 'application/pdf' })
  const upload = {
    key: 'uploads/k1/u1',
    url: 'https://bucket.s3.amazonaws.com/uploads/k1/u1?X-Amz-Signature=abc',
    headers: { 'Content-Type': 'application/pdf' },
  }

  it('asks for an upload link, sends the file straight to storage, then confirms it', async () => {
    const material = { id: 'm1', filename: 'Section 1.pdf' }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ upload }, 201))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(json({ material }, 201))
    vi.stubGlobal('fetch', fetchMock)

    const result = await httpCourseService.uploadMaterial('c1', 'k1', file, { audience: 'plaintiff', description: 'Facts' })

    expect(result).toEqual(material)
    const [first, second, third] = fetchMock.mock.calls
    expect(first[0]).toBe('/api/courses/c1/cases/k1/materials/uploads')
    expect(JSON.parse(first[1].body)).toEqual({ filename: 'Section 1.pdf', size: 4 })
    expect(second[0]).toBe(upload.url)
    expect(second[1]).toMatchObject({ method: 'PUT', headers: upload.headers, body: file })
    expect(third[0]).toBe('/api/courses/c1/cases/k1/materials')
    expect(JSON.parse(third[1].body)).toEqual({
      uploadKey: 'uploads/k1/u1',
      filename: 'Section 1.pdf',
      audience: 'plaintiff',
      description: 'Facts',
    })
  })

  it("explains when storage can't be reached or refuses the file, without confirming", async () => {
    const unreachable = vi.fn().mockResolvedValueOnce(json({ upload }, 201)).mockRejectedValueOnce(new TypeError('CORS'))
    vi.stubGlobal('fetch', unreachable)
    await expect(httpCourseService.uploadMaterial('c1', 'k1', file, { audience: 'all', description: '' })).rejects.toThrow(
      'Could not reach file storage.',
    )

    const refused = vi
      .fn()
      .mockResolvedValueOnce(json({ upload }, 201))
      .mockResolvedValueOnce(new Response('denied', { status: 403 }))
    vi.stubGlobal('fetch', refused)
    await expect(httpCourseService.uploadMaterial('c1', 'k1', file, { audience: 'all', description: '' })).rejects.toThrow(
      'File storage refused the upload (403).',
    )
    expect(refused).toHaveBeenCalledTimes(2)
  })
})
