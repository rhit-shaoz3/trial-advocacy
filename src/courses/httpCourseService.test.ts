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

describe('checkDiscovery', () => {
  const input = { kind: 'interrogatories' as const, mode: 'draft' as const, draft: { items: ['Who inspected it?'] } }
  /** A streamed reply, its lines split across pieces the way the network might. */
  const streamed = (pieces: string[]) =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const p of pieces) controller.enqueue(new TextEncoder().encode(p))
          controller.close()
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } },
    )

  it('shows the feedback as it’s written, then gives the saved check', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      streamed([
        '{"type":"wait"}\n{"type":"tag","tag":"SMALL_EDITS"}\n{"type":"te',
        'xt","text":"Interrogatory 1: "}\n{"type":"text","text":"Who, exactly?"}\n',
        '{"type":"done","check":{"id":"chk1","tag":"SMALL_EDITS","feedback":"Interrogatory 1: Who, exactly?","round":1}}\n',
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const progress: unknown[] = []
    const check = await httpCourseService.checkDiscovery('c1', 'k1', input, (p) => progress.push(p))
    expect(check).toEqual({ id: 'chk1', tag: 'SMALL_EDITS', feedback: 'Interrogatory 1: Who, exactly?', round: 1 })
    expect(progress).toEqual([
      { tag: 'SMALL_EDITS', text: '' },
      { tag: 'SMALL_EDITS', text: 'Interrogatory 1: ' },
      { tag: 'SMALL_EDITS', text: 'Interrogatory 1: Who, exactly?' },
    ])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/courses/c1/my-cases/k1/exchange/check')
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ Accept: 'application/x-ndjson' })
  })

  it('reports a refusal, an error line, or a stream that stops short', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'AI feedback is turned off for this part of the case.' }, 409)))
    await expect(httpCourseService.checkDiscovery('c1', 'k1', input, () => {})).rejects.toThrow('AI feedback is turned off')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamed(['{"type":"error","error":"The AI couldn’t check your draft just now."}\n'])))
    await expect(httpCourseService.checkDiscovery('c1', 'k1', input, () => {})).rejects.toThrow('couldn’t check your draft')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamed(['{"type":"tag","tag":"SMALL_EDITS"}\n'])))
    await expect(httpCourseService.checkDiscovery('c1', 'k1', input, () => {})).rejects.toThrow('cut off')
  })
})
