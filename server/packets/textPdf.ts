import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

// A plain document for the trial packet: headings and wrapped text on letter
// pages, numbered at the foot. The standard fonts only cover Western
// characters, so anything else prints as "?"; the black bars of redacted text
// are drawn as boxes.

const PAGE = { width: 612, height: 792 }
const MARGIN = 72
const BOTTOM = 64
const BAR = /(█+)/
const GRAY = rgb(0.4, 0.4, 0.4)
const BLACK = rgb(0, 0, 0)

interface TextOptions {
  bold?: boolean
  size?: number
  indent?: number
  /** A line drawn through the text, for struck testimony. */
  struck?: boolean
  gray?: boolean
}

export class TextPdf {
  private page!: PDFPage
  private y = 0
  private readonly doc: PDFDocument
  private readonly regular: PDFFont
  private readonly bold: PDFFont
  private readonly footer: string
  private readonly known: Set<number>

  private constructor(doc: PDFDocument, regular: PDFFont, bold: PDFFont, footer: string) {
    this.doc = doc
    this.regular = regular
    this.bold = bold
    this.footer = footer
    this.known = new Set(regular.getCharacterSet())
    this.addPage()
  }

  /** `footer` runs along the foot of every page, beside its number. */
  static async create(footer: string) {
    const doc = await PDFDocument.create()
    const [regular, bold] = await Promise.all([doc.embedFont(StandardFonts.TimesRoman), doc.embedFont(StandardFonts.TimesRomanBold)])
    return new TextPdf(doc, regular, bold, footer)
  }

  get pageCount() {
    return this.doc.getPageCount()
  }

  private addPage() {
    this.page = this.doc.addPage([PAGE.width, PAGE.height])
    this.y = PAGE.height - MARGIN
  }

  /** What the fonts can print of `text`. */
  private printable(text: string) {
    return [...text.replace(/\t/g, '    ')].map((c) => (c === '█' || c === '\n' || this.known.has(c.codePointAt(0)!) ? c : '?')).join('')
  }

  private width(line: string, font: PDFFont, size: number) {
    return line.split(BAR).reduce((sum, run) => sum + (run.startsWith('█') ? run.length * size * 0.5 : font.widthOfTextAtSize(run, size)), 0)
  }

  /** `paragraph` broken into lines at most `room` wide; a word too long for a line is split. */
  private wrap(paragraph: string, font: PDFFont, size: number, room: number) {
    const lines: string[] = []
    let line = ''
    for (let word of paragraph.split(/ +/)) {
      while (this.width(word, font, size) > room) {
        let cut = word.length - 1
        while (cut > 1 && this.width(word.slice(0, cut), font, size) > room) cut--
        if (line) lines.push(line)
        line = ''
        lines.push(word.slice(0, cut))
        word = word.slice(cut)
      }
      const next = line ? `${line} ${word}` : word
      if (this.width(next, font, size) > room) {
        lines.push(line)
        line = word
      } else line = next
    }
    lines.push(line)
    return lines
  }

  private drawLine(line: string, x: number, font: PDFFont, size: number, color: typeof BLACK, struck: boolean) {
    let at = x
    for (const run of line.split(BAR)) {
      if (!run) continue
      const width = this.width(run, font, size)
      if (run.startsWith('█')) this.page.drawRectangle({ x: at, y: this.y - 2, width, height: size, color: BLACK })
      else this.page.drawText(run, { x: at, y: this.y, size, font, color })
      at += width
    }
    if (struck && at > x) {
      const y = this.y + size * 0.3
      this.page.drawLine({ start: { x, y }, end: { x: at, y }, thickness: 0.8, color: BLACK })
    }
  }

  /** Wrapped text; each line of `text` is its own paragraph. */
  text(text: string, { bold = false, size = 11, indent = 0, struck = false, gray = false }: TextOptions = {}) {
    const font = bold ? this.bold : this.regular
    const leading = size * 1.35
    const room = PAGE.width - 2 * MARGIN - indent
    for (const paragraph of this.printable(text.replace(/\r\n?/g, '\n')).split('\n')) {
      for (const line of this.wrap(paragraph, font, size, room)) {
        if (this.y - leading < BOTTOM) this.addPage()
        this.y -= leading
        this.drawLine(line, MARGIN + indent, font, size, gray ? GRAY : BLACK, struck)
      }
    }
    return this
  }

  title(text: string) {
    return this.text(text, { bold: true, size: 16 }).space(4)
  }

  heading(text: string) {
    if (this.y - 60 < BOTTOM) this.addPage()
    return this.space(8).text(text, { bold: true, size: 12.5 }).space(3)
  }

  space(points = 6) {
    this.y -= points
    return this
  }

  /**
   * A line of a table of contents: `text`, dots, and `page` at the right edge.
   * Says where it landed, for a link to the page.
   */
  contentsLine(text: string, page: number) {
    const size = 11
    const leading = size * 1.35
    const left = MARGIN + 14
    const right = PAGE.width - MARGIN
    const number = String(page)
    const lines = this.wrap(this.printable(text.replace(/\s+/g, ' ')), this.regular, size, right - left - 44)
    if (this.y - leading * lines.length < BOTTOM) this.addPage()
    const top = this.y
    for (const line of lines) {
      this.y -= leading
      this.drawLine(line, left, this.regular, size, BLACK, false)
    }
    const numberAt = right - this.regular.widthOfTextAtSize(number, size)
    const end = left + this.width(lines[lines.length - 1], this.regular, size) + 4
    const dots = Math.floor((numberAt - 4 - end) / this.regular.widthOfTextAtSize('.', size))
    if (dots > 0) this.page.drawText('.'.repeat(dots), { x: end, y: this.y, size, font: this.regular, color: GRAY })
    this.page.drawText(number, { x: numberAt, y: this.y, size, font: this.regular, color: BLACK })
    this.space(2)
    return { pageIndex: this.doc.getPageCount() - 1, rect: [left, this.y, right, top] }
  }

  /** The pages as a file; `footer: false` leaves their feet empty, for pages numbered with another document's. */
  async save({ footer: withFooter = true } = {}) {
    if (!withFooter) return Buffer.from(await this.doc.save())
    const pages = this.doc.getPages()
    const footer = this.printable(this.footer.replace(/\s+/g, ' '))
    pages.forEach((page, i) => {
      const number = `Page ${i + 1} of ${pages.length}`
      const room = PAGE.width - 2 * MARGIN - 70
      const [line] = this.wrap(footer, this.regular, 9, room)
      page.drawText(line.replace(/█/g, ''), { x: MARGIN, y: 36, size: 9, font: this.regular, color: GRAY })
      page.drawText(number, { x: PAGE.width - MARGIN - this.regular.widthOfTextAtSize(number, 9), y: 36, size: 9, font: this.regular, color: GRAY })
    })
    return Buffer.from(await this.doc.save())
  }
}
