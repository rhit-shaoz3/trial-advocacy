import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

// Records and illustrative aids the investigator makes with a report. When a
// finding is itself a record (a public-record printout, a capture of a public
// post, his own photo or measurement log), he writes the record out in a
// <record> block; when he gives an estimate built from several sources, he
// lays it out in an <aid> block, with its figures and the sources behind
// them. Each becomes a PDF in his team's case world, reviewed with the report
// like the files he unlocks.

export interface MadeRecord {
  kind: 'record'
  title: string
  /** The record's text, laid out line by line as on the document. */
  text: string
}

export interface AidRow {
  label: string
  /** The figure as written ("$4,200", "about 35"). */
  value: string
  /** The number in it, for the chart (a range's low end); null if there's none. */
  amount: number | null
  /** A range's high end ("$90,000 to $180,000"); null for a single figure. */
  high: number | null
  /** Which sources it rests on, by number. */
  sources: number[]
}

export interface MadeAid {
  kind: 'aid'
  title: string
  summary: string
  unit: string
  rows: AidRow[]
  sources: string[]
}

export type MadeFile = MadeRecord | MadeAid

/** At most this many records and aids are kept from one report. */
export const MAX_MADE_FILES = 4

const BLOCK = /<(record|aid)\s+title\s*=\s*"([^"]*)"\s*>([\s\S]*?)<\/\1>/gi

/** The records and aids in a report, and the report without them. */
export function extractMadeFiles(body: string): { body: string; files: MadeFile[] } {
  const files: MadeFile[] = []
  const rest = body.replace(BLOCK, (_, kind: string, rawTitle: string, content: string) => {
    const title = rawTitle.trim()
    if (!title || files.length >= MAX_MADE_FILES || files.some((f) => f.title.toLowerCase() === title.toLowerCase())) return ''
    files.push(kind.toLowerCase() === 'record' ? { kind: 'record', title, text: trimLines(content) } : readAid(title, content))
    return ''
  })
  return { body: rest.replace(/\n{3,}/g, '\n\n').trim(), files }
}

const trimLines = (text: string) =>
  text
    .replace(/^\s*\n/, '')
    .replace(/\s+$/, '')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')

/** Reads an aid's SUMMARY, UNIT, DATA (label | value | [n]) and SOURCES sections. */
function readAid(title: string, content: string): MadeAid {
  const aid: MadeAid = { kind: 'aid', title, summary: '', unit: '', rows: [], sources: [] }
  let section: 'data' | 'sources' | null = null
  for (const raw of content.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const head = /^(SUMMARY|UNIT|DATA|SOURCES)\s*:?\s*(.*)$/i.exec(line)
    if (head) {
      const name = head[1].toUpperCase()
      if (name === 'SUMMARY') aid.summary = head[2].trim()
      else if (name === 'UNIT') aid.unit = head[2].trim()
      else section = name === 'DATA' ? 'data' : 'sources'
      continue
    }
    const item = line.replace(/^(?:[-*•]|\d+[.)])\s*/, '').trim()
    if (!item) continue
    if (section === 'sources') aid.sources.push(item)
    else if (section === 'data') {
      const [label, value = '', refs = ''] = item.split('|').map((c) => c.trim())
      const numbers = [...value.replace(/\$/g, '').matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, '')))
      const range = numbers.length >= 2 && numbers[1] > numbers[0] && /\d\s*(?:to|-|–|—)\s*\$?\d/i.test(value)
      aid.rows.push({
        label,
        value,
        amount: numbers[0] ?? null,
        high: range ? numbers[1] : null,
        sources: [...refs.matchAll(/\d+/g)].map((m) => Number(m[0])),
      })
    } else if (!aid.summary) aid.summary = item
  }
  return aid
}

/** The plain text of a record or aid, for the case file's transcription (so witnesses and the investigator can read it). */
export function madeFileText(file: MadeFile, madeBy: string) {
  if (file.kind === 'record') return `${file.title}\n\n${file.text}\n\n(Obtained by ${madeBy}, investigator.)`
  const rows = file.rows.map((r) => `- ${r.label}: ${r.value}${r.sources.length ? ` [${r.sources.join(', ')}]` : ''}`)
  const sources = file.sources.map((s, i) => `${i + 1}. ${s}`)
  return [
    `ILLUSTRATIVE AID: ${file.title}`,
    `Prepared by ${madeBy}, investigator. An estimate, not a record of the case.`,
    file.summary,
    file.unit ? `Unit: ${file.unit}` : '',
    rows.join('\n'),
    sources.length ? `Sources:\n${sources.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

// Drawing the PDFs -------------------------------------------------------------

const PAGE = { width: 612, height: 792, margin: 60 }
const INK = rgb(0.1, 0.1, 0.12)
const SOFT = rgb(0.38, 0.4, 0.45)
const BAR = rgb(0.18, 0.36, 0.62)

/** `text` with any character the standard fonts can't draw replaced. */
function drawable(font: PDFFont, text: string) {
  return [...text.replace(/\t/g, '    ')]
    .map((ch) => {
      if (ch === '\n') return ch
      try {
        font.encodeText(ch)
        return ch
      } catch {
        return '?'
      }
    })
    .join('')
}

/** Splits `text` into lines no wider than `width`, breaking long words. */
function wrap(font: PDFFont, size: number, text: string, width: number) {
  const lines: string[] = []
  for (const paragraph of drawable(font, text).split('\n')) {
    let line = ''
    for (const word of paragraph.split(/(\s+)/)) {
      const next = line + word
      if (font.widthOfTextAtSize(next, size) <= width) {
        line = next
        continue
      }
      if (line.trim()) lines.push(line.trimEnd())
      line = word.trimStart()
      while (font.widthOfTextAtSize(line, size) > width) {
        let cut = line.length - 1
        while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--
        lines.push(line.slice(0, cut))
        line = line.slice(cut)
      }
    }
    lines.push(line.trimEnd())
  }
  return lines
}

/** Writes lines down the page, starting new pages as needed. */
class Writer {
  doc: PDFDocument
  footer: string
  footerFont: PDFFont
  page: PDFPage
  y: number
  constructor(doc: PDFDocument, footer: string, footerFont: PDFFont) {
    this.doc = doc
    this.footer = footer
    this.footerFont = footerFont
    this.page = this.newPage()
    this.y = PAGE.height - PAGE.margin
  }
  newPage() {
    const page = this.doc.addPage([PAGE.width, PAGE.height])
    page.drawText(drawable(this.footerFont, this.footer), { x: PAGE.margin, y: 32, size: 8, font: this.footerFont, color: SOFT })
    return page
  }
  room(height: number) {
    if (this.y - height < PAGE.margin) {
      this.page = this.newPage()
      this.y = PAGE.height - PAGE.margin
    }
  }
  text(text: string, font: PDFFont, size: number, { color = INK, gap = 4, indent = 0 } = {}) {
    for (const line of wrap(font, size, text, PAGE.width - 2 * PAGE.margin - indent)) {
      this.room(size + gap)
      this.y -= size
      this.page.drawText(line, { x: PAGE.margin + indent, y: this.y, size, font, color })
      this.y -= gap
    }
  }
  space(height: number) {
    this.y -= height
  }
}

const longDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

/** The record or aid as a PDF. */
export async function renderMadeFile(file: MadeFile, madeBy: string, teamNumber: number, date = new Date()) {
  const doc = await PDFDocument.create()
  doc.setTitle(file.title)
  doc.setAuthor(madeBy)
  const [bold, regular, mono] = await Promise.all([
    doc.embedFont(StandardFonts.HelveticaBold),
    doc.embedFont(StandardFonts.Helvetica),
    doc.embedFont(StandardFonts.Courier),
  ])
  const footer =
    file.kind === 'record'
      ? `Obtained by ${madeBy}, investigator for Team ${teamNumber}, on ${longDate(date)}.`
      : `Illustrative aid prepared by ${madeBy}, investigator for Team ${teamNumber}, on ${longDate(date)}. Not a record of the case.`
  const w = new Writer(doc, footer, regular)

  if (file.kind === 'record') {
    w.text(file.title, bold, 15, { gap: 14 })
    w.text(file.text, mono, 10, { gap: 3 })
    return doc.save()
  }

  w.text('ILLUSTRATIVE AID', bold, 9, { color: SOFT, gap: 6 })
  w.text(file.title, bold, 16, { gap: 10 })
  if (file.summary) w.text(file.summary, regular, 11, { gap: 4 })
  if (file.unit) w.text(`Figures in ${file.unit}.`, regular, 9, { color: SOFT, gap: 4 })
  w.space(12)

  // A bar for each figure with a number, scaled to the largest; a range's bar runs on, lighter, to its high end.
  const charted = file.rows.filter((r) => r.amount !== null && r.amount >= 0)
  const max = Math.max(0, ...charted.map((r) => r.high ?? r.amount!))
  const labelWidth = 170
  const valueText = (row: AidRow) => drawable(bold, row.value) + (row.sources.length ? ` [${row.sources.join(', ')}]` : '')
  // Room for the widest figure after its bar.
  const widest = Math.max(60, ...file.rows.map((r) => bold.widthOfTextAtSize(valueText(r), 10)))
  const barWidth = Math.max(80, PAGE.width - 2 * PAGE.margin - labelWidth - widest - 8)
  for (const row of file.rows) {
    const label = wrap(regular, 10, row.label, labelWidth - 10)
    const height = Math.max(18, label.length * 12 + 6)
    w.room(height)
    const top = w.y
    label.forEach((line, i) => w.page.drawText(line, { x: PAGE.margin, y: top - 11 - i * 12, size: 10, font: regular, color: INK }))
    let x = PAGE.margin + labelWidth
    if (row.amount !== null && row.amount >= 0 && max > 0) {
      const width = Math.max(2, (row.amount / max) * barWidth)
      w.page.drawRectangle({ x, y: top - 14, width, height: 12, color: BAR })
      x += width
      if (row.high !== null) {
        const more = ((row.high - row.amount) / max) * barWidth
        w.page.drawRectangle({ x, y: top - 14, width: more, height: 12, color: BAR, opacity: 0.35 })
        x += more
      }
      x += 6
    }
    w.page.drawText(valueText(row), { x, y: top - 11, size: 10, font: bold, color: INK })
    w.y = top - height
  }

  if (file.sources.length) {
    w.space(14)
    w.text('Sources', bold, 11, { gap: 6 })
    file.sources.forEach((s, i) => w.text(`[${i + 1}] ${s}`, regular, 9, { gap: 3, indent: 4 }))
  }
  return doc.save()
}
