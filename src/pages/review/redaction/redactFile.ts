import type { PageRedactionMarks, RedactionBox, RedactionMode, TextRedactionMarks, ExhibitPart } from '../../../courses/types'

// Making the redacted copy of a partly admitted exhibit, in the instructor's
// browser. A page with marks is drawn to a canvas, blacked out there, and
// saved as a picture of the page, so nothing under the black can be copied
// out; a page with nothing redacted is copied as it is, and a page left out
// is dropped. The server checks the copy and keeps it (see
// server/exhibits/exhibitFiles.ts).

export type PagePlan = 'copy' | 'black' | 'drop'

/**
 * What becomes of each page (from 1). Marking what's redacted: a page left
 * out is dropped and one with boxes is blacked out. Marking what's admitted:
 * a page with no box is dropped, and the rest blacked out around the boxes.
 */
export function planPages(marks: PageRedactionMarks, pageCount: number): PagePlan[] {
  const byPage = new Map(marks.pages.map((p) => [p.page, p]))
  return Array.from({ length: pageCount }, (_, i) => {
    const m = byPage.get(i + 1)
    if (m?.removed) return 'drop'
    const boxes = m?.boxes.length ?? 0
    if (marks.mode === 'admit') return boxes > 0 ? 'black' : 'drop'
    return boxes > 0 ? 'black' : 'copy'
  })
}

/** Paints the redaction over a page already drawn on `ctx`: the boxes, or everything but them. */
export function paintRedaction(ctx: CanvasRenderingContext2D, width: number, height: number, boxes: RedactionBox[], mode: RedactionMode) {
  const rect = (b: RedactionBox) => [b.x * width, b.y * height, b.w * width, b.h * height] as const
  ctx.save()
  ctx.fillStyle = '#000'
  if (mode === 'redact') {
    for (const b of boxes) ctx.fillRect(...rect(b))
  } else {
    // Black everywhere, then the page shows through the boxes: draw the black on its own layer with the boxes cut out.
    const layer = document.createElement('canvas')
    layer.width = width
    layer.height = height
    const l = layer.getContext('2d')!
    l.fillStyle = '#000'
    l.fillRect(0, 0, width, height)
    l.globalCompositeOperation = 'destination-out'
    for (const b of boxes) l.fillRect(...rect(b))
    ctx.drawImage(layer, 0, 0)
  }
  ctx.restore()
}

const toPng = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't draw the page."))), 'image/png'))

/** pdf.js, loaded the first time a PDF is shown, with its worker. */
export async function loadPdfJs() {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  return pdfjs
}

/** Fetches an exhibit's file as bytes (the session cookie goes along). */
export async function fetchBytes(url: string) {
  const res = await fetch(url, { credentials: 'same-origin' })
  if (!res.ok) throw new Error("Couldn't load the exhibit.")
  return new Uint8Array(await res.arrayBuffer())
}

/** The most pixels a flattened page gets, so a big page doesn't make a huge picture. */
const MAX_PIXELS = 2400 * 3200

/** The redacted copy of a PDF exhibit, as marked. */
export async function buildRedactedPdf(data: Uint8Array, marks: PageRedactionMarks): Promise<Blob> {
  const [pdfjs, { PDFDocument }] = await Promise.all([loadPdfJs(), import('pdf-lib')])
  // pdf.js takes over the buffer it's given, so it gets its own copy.
  const task = pdfjs.getDocument({ data: data.slice() })
  const doc = await task.promise
  const source = await PDFDocument.load(data, { ignoreEncryption: true })
  const out = await PDFDocument.create()
  const plan = planPages(marks, doc.numPages)
  for (const [i, what] of plan.entries()) {
    if (what === 'drop') continue
    if (what === 'copy') {
      const [page] = await out.copyPages(source, [i])
      out.addPage(page)
      continue
    }
    const page = await doc.getPage(i + 1)
    const size = page.getViewport({ scale: 1 })
    const scale = Math.min(2, Math.sqrt(MAX_PIXELS / (size.width * size.height)))
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const ctx = canvas.getContext('2d')!
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    const boxes = marks.pages.find((p) => p.page === i + 1)?.boxes ?? []
    paintRedaction(ctx, canvas.width, canvas.height, boxes, marks.mode)
    const png = await out.embedPng(await (await toPng(canvas)).arrayBuffer())
    out.addPage([size.width, size.height]).drawImage(png, { x: 0, y: 0, width: size.width, height: size.height })
  }
  await task.destroy()
  return new Blob([(await out.save()) as BlobPart], {
    type: 'application/pdf',
  })
}

/** The redacted copy of a picture exhibit, as a PNG. */
export async function buildRedactedImage(url: string, marks: PageRedactionMarks): Promise<Blob> {
  const blob = new Blob([(await fetchBytes(url)) as BlobPart])
  const image = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(image, 0, 0)
  paintRedaction(ctx, canvas.width, canvas.height, marks.pages.find((p) => p.page === 1)?.boxes ?? [], marks.mode)
  return toPng(canvas)
}

// Text, for the preview (the server does the real redacting the same way) ------

function bar(run: string) {
  const [, before, inside, after] = /^(\s*)([\s\S]*?)(\s*)$/.exec(run)!
  return inside ? before + '█'.repeat(Math.min(Math.max(inside.length, 3), 40)) + after : run
}

/** `text` with the marked ranges (redact) or everything but them (admit) blacked out. */
export function redactField(text: string, ranges: { start: number; end: number }[], mode: RedactionMode) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged: { start: number; end: number }[] = []
  for (const r of sorted) {
    const last = merged[merged.length - 1]
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end)
    else merged.push({ ...r })
  }
  let out = ''
  let at = 0
  for (const r of merged) {
    const between = text.slice(at, r.start)
    const inside = text.slice(r.start, r.end)
    out += mode === 'redact' ? between + bar(inside) : bar(between) + inside
    at = r.end
  }
  const rest = text.slice(at)
  return out + (mode === 'redact' ? rest : bar(rest))
}

/** The admitted turns or paragraphs, as the server will make them. */
export function redactParts(parts: ExhibitPart[], marks: TextRedactionMarks): ExhibitPart[] {
  const byN = new Map(marks.parts.map((p) => [p.n, p]))
  const out: ExhibitPart[] = []
  for (const part of parts) {
    const m = byN.get(part.n)
    if (m?.removed) continue
    const ranges = m?.ranges ?? []
    if (marks.mode === 'admit' && ranges.length === 0) continue
    const of = (field: 'question' | 'text') => ranges.filter((r) => r.field === field)
    const redact = (field: 'question' | 'text', text: string) =>
      of(field).length || marks.mode === 'admit' ? redactField(text, of(field), marks.mode) : text
    out.push({
      ...part,
      text: redact('text', part.text),
      ...(part.question !== undefined && {
        question: redact('question', part.question),
      }),
    })
  }
  return out
}
