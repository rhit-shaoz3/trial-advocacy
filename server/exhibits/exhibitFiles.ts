import { randomUUID } from 'node:crypto'
import type { Response } from 'express'
import type { PoolClient } from 'pg'
import { PDFDocument } from 'pdf-lib'
import { pool } from '../db/pool.ts'
import { HttpError } from '../httpError.ts'
import { findMaterialFile, findMaterialText } from '../courses/caseContent.ts'
import { sendMaterialFile, sendMaterialText } from '../courses/caseContentRoutes.ts'
import { storage } from '../storage/storage.ts'
import { KEY_PATTERN, MAX_UPLOAD_BYTES, dispositionHeader } from '../storage/shared.ts'

// An exhibit as the sides see it: only the pages, turns or paragraphs it
// lists, and, once the instructor admits it with a redaction, the redacted
// version. Redacting removes what's covered rather than hiding it: a marked
// page of a file is flattened to a picture in the instructor's browser before
// it's uploaded, and redacted text is replaced by black bars here.

type Db = Pick<PoolClient, 'query'>

/** A turn of a transcript or a paragraph of a report or text file (see `Part` in exhibits.ts). */
export interface TextPart {
  n: number
  text: string
  question?: string
  objection?: string | null
}

/** A box on a page, as fractions (0 to 1) of the page's width and height from its top left. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export type MarkMode = 'redact' | 'admit'

export interface PageMarks {
  mode: MarkMode
  pages: { page: number; removed: boolean; boxes: Box[] }[]
}

export interface TextMarks {
  mode: MarkMode
  parts: {
    n: number
    removed: boolean
    ranges: { field: 'question' | 'text'; start: number; end: number }[]
  }[]
}

/** How an exhibit can be marked for a redaction: boxes on a PDF's pages or a picture, or ranges of text. */
export type Markable = 'pdf' | 'image' | 'text'

const IMAGE = /^image\/(png|jpeg|gif|webp)/i
const MAX_BOXES = 100
const MAX_RANGES = 200

/** Splits a report or text file into paragraphs, as the exhibit list does. */
export const splitParagraphs = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)

/** The source of one exhibit, with what's needed to serve or redact it. */
export interface ExhibitSource {
  id: string
  caseId: string
  matchupId: string
  materialId: string | null
  parts: number[] | null
  snapshot: TextPart[] | null
  contentType: string | null
  textContent: string | null
  admittedKey: string | null
  admittedContentType: string | null
  admittedExcerpt: TextPart[] | null
  /** The copy the offering team blacked parts out of, if it did. */
  offeredKey: string | null
}

/** One exhibit, found by the world it's in (a student's) or the course it's in (the instructor's). */
export async function findExhibitSource(exhibitId: string, scope: { matchupId: string } | { courseId: string }, db: Db = pool) {
  const { rows } = await db.query<ExhibitSource>(
    `SELECT x.id, x.case_id AS "caseId", x.matchup_id AS "matchupId", x.material_id AS "materialId", x.parts, x.snapshot,
            m.content_type AS "contentType", CASE WHEN m.text_status = 'ready' THEN m.text_content END AS "textContent",
            x.admitted_key AS "admittedKey", x.admitted_content_type AS "admittedContentType",
            x.admitted_excerpt AS "admittedExcerpt", x.offered_key AS "offeredKey"
     FROM exhibits x
     JOIN cases c ON c.id = x.case_id
     LEFT JOIN case_materials m ON m.id = x.material_id
     WHERE x.id = $1 AND ${'matchupId' in scope ? 'x.matchup_id' : 'c.course_id'} = $2`,
    [exhibitId, 'matchupId' in scope ? scope.matchupId : scope.courseId],
  )
  if (!rows[0]) throw new HttpError(404, 'Exhibit not found.')
  return rows[0]
}

/** How the exhibit can be marked, or null (audio or video) for a written description only. */
export function markable(x: Pick<ExhibitSource, 'materialId' | 'contentType' | 'textContent'>): Markable | null {
  if (!x.materialId) return 'text'
  const type = x.contentType ?? ''
  if (type.startsWith('application/pdf')) return 'pdf'
  if (IMAGE.test(type)) return 'image'
  if (/^(audio|video)\//i.test(type)) return null
  return x.textContent ? 'text' : null
}

/** The turns or paragraphs of a text exhibit, as listed. */
export function textParts(x: ExhibitSource): TextPart[] {
  if (x.snapshot) return x.snapshot
  return splitParagraphs(x.textContent ?? '').map((text, n) => ({ n, text }))
}

/** A copy of a PDF with only the given pages (from 1), in order; pages past the end are skipped. */
export async function cutPdf(data: Uint8Array, pages: number[]) {
  const source = await PDFDocument.load(data, { ignoreEncryption: true })
  const wanted = pages.map((p) => p - 1).filter((i) => i >= 0 && i < source.getPageCount())
  const out = await PDFDocument.create()
  for (const page of await out.copyPages(source, wanted)) out.addPage(page)
  return out.save()
}

async function materialBytes(file: NonNullable<Awaited<ReturnType<typeof findMaterialFile>>>) {
  return file.storageKey ? storage.read(file.storageKey) : file.data!
}

/** A case file's PDF, cut down to `pages` if given. */
export async function materialPdf(caseId: string, materialId: string, pages: number[] | null) {
  const file = await findMaterialFile(caseId, materialId)
  if (!file) throw new HttpError(404, 'File not found.')
  const data = await materialBytes(file)
  try {
    return pages ? await cutPdf(data, pages) : new Uint8Array(data)
  } catch {
    throw new HttpError(422, "This PDF couldn't be read to cut out its pages.")
  }
}

/** The exhibit's PDF as served: the offering team's blacked-out copy, or the file cut down to its pages. */
export async function exhibitPdf(x: ExhibitSource) {
  if (x.offeredKey) return new Uint8Array(await storage.read(x.offeredKey))
  if (!x.materialId) throw new HttpError(404, 'File not found.')
  return materialPdf(x.caseId, x.materialId, x.parts)
}

/** How many pages a PDF has. */
export async function pageCount(data: Uint8Array) {
  try {
    return (await PDFDocument.load(data, { ignoreEncryption: true })).getPageCount()
  } catch {
    throw new HttpError(422, "This PDF couldn't be read.")
  }
}

/** How many pages the exhibit has as served. */
export const exhibitPageCount = async (x: ExhibitSource) => pageCount(await exhibitPdf(x))

/**
 * Sends an exhibit's file: the redacted copy once admitted with one, the copy
 * the offering team blacked parts out of, a PDF cut down to its pages, or else
 * the case file itself. Stored files are a redirect to storage, unless
 * `stream` (for the marking window; see `sendBytes`).
 */
export async function sendExhibitFile(res: Response, x: ExhibitSource, view: boolean, stream = false) {
  if (!x.materialId) throw new HttpError(404, 'This exhibit has no file.')
  const file = await findMaterialFile(x.caseId, x.materialId)
  if (!file) throw new HttpError(404, 'File not found.')
  const stored = async (key: string, type: string) =>
    stream
      ? sendBytes(res, await storage.read(key), type, redactedName(file.filename, type))
      : res.redirect(302, await storage.downloadUrl(key, redactedName(file.filename, type), type, view))
  if (x.admittedKey) return stored(x.admittedKey, x.admittedContentType ?? file.contentType)
  const kind = markable(x)
  if (x.offeredKey && (kind === 'pdf' || kind === 'image')) return stored(x.offeredKey, redactedType(kind))
  if (x.parts && file.contentType.startsWith('application/pdf')) {
    const data = await exhibitPdf(x)
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': dispositionHeader(file.filename, 'application/pdf', view),
      'X-Content-Type-Options': 'nosniff',
    })
    res.send(Buffer.from(data))
    return
  }
  if (stream) return sendBytes(res, await materialBytes(file), file.contentType, file.filename)
  await sendMaterialFile(res, file, view)
}

/**
 * Sends a file's bytes from the API itself rather than redirecting to
 * storage: the marking window reads the file with fetch, and S3 only lets the
 * app's pages upload (its CORS rule), not read.
 */
function sendBytes(res: Response, data: Uint8Array, type: string, filename: string) {
  res.set({ 'Content-Type': type, 'Content-Disposition': dispositionHeader(filename, type, false), 'X-Content-Type-Options': 'nosniff' })
  res.send(Buffer.from(data))
}

/** A case file's bytes, from the API itself, for a team blacking out parts of it (see `sendBytes`). */
export async function sendMaterialBytes(res: Response, caseId: string, materialId: string) {
  const file = await findMaterialFile(caseId, materialId)
  if (!file) throw new HttpError(404, 'File not found.')
  sendBytes(res, await materialBytes(file), file.contentType, file.filename)
}

/** The exhibit's text version (a Word file's), for the viewer. */
export async function sendExhibitText(res: Response, x: ExhibitSource) {
  if (!x.materialId) throw new HttpError(404, 'This exhibit has no file.')
  await sendMaterialText(res, await findMaterialText(x.caseId, x.materialId))
}

function redactedName(filename: string, type: string) {
  const base = filename.replace(/\.[^.]+$/, '')
  return `${base} (redacted).${type.startsWith('image/') ? 'png' : 'pdf'}`
}

/** What a redacted file is stored as. */
export const redactedType = (kind: 'pdf' | 'image') => (kind === 'pdf' ? 'application/pdf' : 'image/png')

/**
 * Where a browser uploads the redacted copy of a PDF or picture (`kind`, from
 * `markable`): the instructor's for a partial admission, or a team's for a
 * case file it lists with parts blacked out.
 */
export async function startRedactedUpload(caseId: string, kind: Markable | null, body: unknown) {
  if (kind !== 'pdf' && kind !== 'image') throw new HttpError(409, 'Only a PDF or a picture is redacted as a file.')
  const size = (body as Record<string, unknown> | undefined)?.size
  if (!Number.isInteger(size) || (size as number) <= 0 || (size as number) > MAX_UPLOAD_BYTES) {
    throw new HttpError(400, 'The redacted file is too large.')
  }
  const key = `uploads/${caseId}/${randomUUID()}`
  const { url, headers } = await storage.uploadTarget(key, redactedType(kind), size as number)
  return { key, url, headers }
}

// Reading the marks -------------------------------------------------------------

const isFraction = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1

function readMode(raw: Record<string, unknown>): MarkMode {
  if (raw.mode !== 'redact' && raw.mode !== 'admit')
    throw new HttpError(400, 'Say whether you marked what is redacted or what is admitted.')
  return raw.mode
}

/**
 * Reads box marks for an exhibit of `pageCount` pages (a picture has one).
 * Pages count from 1 through the exhibit as it's served, so a PDF listed as
 * pages 3–5 has pages 1 to 3.
 */
export function readPageMarks(
  body: unknown,
  pageCount: number,
  nothingLeft = 'Nothing is left to admit. To keep the whole exhibit out, sustain the objection.',
): PageMarks {
  const raw = body as Record<string, unknown> | null
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.pages)) throw new HttpError(400, 'Mark the redaction on the exhibit.')
  const mode = readMode(raw)
  const seen = new Set<number>()
  const pages = raw.pages.map((entry) => {
    const e = entry as Record<string, unknown> | null
    const page = e?.page
    const ok = Number.isInteger(page) && (page as number) >= 1 && (page as number) <= pageCount
    if (!ok || seen.has(page as number)) throw new HttpError(400, "Those marks aren't on the exhibit's pages.")
    seen.add(page as number)
    const boxes = Array.isArray(e!.boxes) ? e!.boxes : []
    if (boxes.length > MAX_BOXES) throw new HttpError(400, `A page can have at most ${MAX_BOXES} boxes.`)
    return {
      page: page as number,
      removed: e!.removed === true,
      boxes: boxes.map((b) => {
        const box = b as Record<string, unknown> | null
        if (!box || ![box.x, box.y, box.w, box.h].every(isFraction) || (box.w as number) <= 0 || (box.h as number) <= 0) {
          throw new HttpError(400, 'Each box needs a place and a size on the page.')
        }
        return {
          x: box.x as number,
          y: box.y as number,
          w: box.w as number,
          h: box.h as number,
        }
      }),
    }
  })
  const marks = { mode, pages }
  if (keptPages(marks, pageCount).length === 0) throw new HttpError(400, nothingLeft)
  if (!marks.pages.some((p) => p.removed || p.boxes.length > 0)) throw new HttpError(400, 'Mark what is redacted or what is admitted.')
  return marks
}

/** The pages left in once marked: in admit mode, those with a box; in redact mode, those not left out. */
export function keptPages(marks: PageMarks, pageCount: number) {
  const byPage = new Map(marks.pages.map((p) => [p.page, p]))
  return Array.from({ length: pageCount }, (_, i) => i + 1).filter((page) => {
    const m = byPage.get(page)
    if (m?.removed) return false
    return marks.mode === 'redact' || (m?.boxes.length ?? 0) > 0
  })
}

/** Reads text marks against the exhibit's turns or paragraphs. */
export function readTextMarks(body: unknown, parts: TextPart[]): TextMarks {
  const raw = body as Record<string, unknown> | null
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.parts)) throw new HttpError(400, 'Mark the redaction on the exhibit.')
  const mode = readMode(raw)
  const byN = new Map(parts.map((p) => [p.n, p]))
  const seen = new Set<number>()
  const marked = raw.parts.map((entry) => {
    const e = entry as Record<string, unknown> | null
    const part = byN.get(e?.n as number)
    if (!part || seen.has(part.n)) throw new HttpError(400, "Those marks aren't on the exhibit's text.")
    seen.add(part.n)
    const ranges = Array.isArray(e!.ranges) ? e!.ranges : []
    if (ranges.length > MAX_RANGES) throw new HttpError(400, `A part can have at most ${MAX_RANGES} marks.`)
    return {
      n: part.n,
      removed: e!.removed === true,
      ranges: ranges.map((r) => {
        const range = r as Record<string, unknown> | null
        const field = range?.field
        const text = field === 'question' ? part.question : field === 'text' ? part.text : undefined
        const { start, end } = range ?? {}
        if (
          text === undefined ||
          !Number.isInteger(start) ||
          !Number.isInteger(end) ||
          (start as number) < 0 ||
          (end as number) <= (start as number) ||
          (end as number) > text.length
        ) {
          throw new HttpError(400, "Those marks aren't on the exhibit's text.")
        }
        return {
          field: field as 'question' | 'text',
          start: start as number,
          end: end as number,
        }
      }),
    }
  })
  const marks = { mode, parts: marked }
  const kept = redactText(parts, marks)
  if (kept.length === 0) throw new HttpError(400, 'Nothing is left to admit. To keep the whole exhibit out, sustain the objection.')
  if (!marked.some((p) => p.removed || p.ranges.length > 0)) throw new HttpError(400, 'Mark what is redacted or what is admitted.')
  return marks
}

// Redacting text --------------------------------------------------------------

/** A black bar for a run of redacted text, about as long as what it covers (up to a limit), keeping the spaces around it. */
function bar(run: string) {
  const [, before, inside, after] = /^(\s*)([\s\S]*?)(\s*)$/.exec(run)!
  return inside ? before + '█'.repeat(Math.min(Math.max(inside.length, 3), 40)) + after : run
}

/** Merges overlapping ranges, in order. */
function merge(ranges: { start: number; end: number }[]) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const out: { start: number; end: number }[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end)
    else out.push({ ...r })
  }
  return out
}

/** `text` with the marked ranges (redact) or everything but them (admit) blacked out. */
export function redactField(text: string, ranges: { start: number; end: number }[], mode: MarkMode) {
  const merged = merge(ranges)
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

/**
 * The admitted turns or paragraphs. In redact mode, the marked text is
 * blacked out and parts left out are dropped; in admit mode, only what's
 * marked stays, and a part with nothing marked is dropped.
 */
export function redactText(parts: TextPart[], marks: TextMarks): TextPart[] {
  const byN = new Map(marks.parts.map((p) => [p.n, p]))
  const out: TextPart[] = []
  for (const part of parts) {
    const m = byN.get(part.n)
    if (m?.removed) continue
    const ranges = m?.ranges ?? []
    if (marks.mode === 'admit' && ranges.length === 0) continue
    const of = (field: 'question' | 'text') => ranges.filter((r) => r.field === field)
    out.push({
      ...part,
      text: of('text').length || marks.mode === 'admit' ? redactField(part.text, of('text'), marks.mode) : part.text,
      ...(part.question !== undefined && {
        question: of('question').length || marks.mode === 'admit' ? redactField(part.question, of('question'), marks.mode) : part.question,
      }),
    })
  }
  return out
}

// Storing the redacted file --------------------------------------------------------

/**
 * Checks the instructor's upload of a redacted file (one started for this
 * case, finished, a real PDF with the kept pages or a PNG) and moves it to the
 * case's files. Returns its storage key.
 */
export async function keepRedactedFile(caseId: string, kind: 'pdf' | 'image', uploadKey: unknown, pageCount: number) {
  if (typeof uploadKey !== 'string' || !uploadKey.startsWith(`uploads/${caseId}/`) || !KEY_PATTERN.test(uploadKey)) {
    throw new HttpError(400, 'Upload the redacted file first.')
  }
  const size = await storage.size(uploadKey)
  if (size === null) throw new HttpError(400, "The redacted file didn't finish uploading. Try again.")
  const data = await storage.read(uploadKey)
  let ok = false
  if (kind === 'image') {
    ok = data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  } else {
    try {
      ok = (await PDFDocument.load(data)).getPageCount() === pageCount
    } catch {
      ok = false
    }
  }
  if (!ok) {
    await storage.delete([uploadKey])
    throw new HttpError(400, "The redacted file doesn't match the marks. Try again.")
  }
  const key = `cases/${caseId}/${randomUUID()}`
  await storage.move(uploadKey, key)
  return key
}
