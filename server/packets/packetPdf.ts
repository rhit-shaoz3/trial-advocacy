import { PDFDocument, PDFName, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { TextPdf } from './textPdf.ts'

// A trial packet as one PDF for court: a first page with a table of contents,
// then the chosen documents in order. Every page gets a number along its foot
// counting through the whole PDF, which is what the table of contents points
// to, since each document keeps its own numbers.

export interface PdfPart {
  section: string
  title: string
  print(): Promise<Uint8Array>
  /** A label stuck on the part's first page, like a court's exhibit sticker. */
  sticker?: string
}

type Cover = (pdf: TextPdf, unreadable: string[]) => void

const LETTER: [number, number] = [612, 792]
const PICTURE_MARGIN = 36
const STAMP_SIZE = 9
const STAMP_INSET = 16

const isPng = (data: Uint8Array) => data[0] === 0x89 && data[1] === 0x50
const isJpeg = (data: Uint8Array) => data[0] === 0xff && data[1] === 0xd8

/** A picture, as large as it fits on a page of its own. */
async function addPicture(doc: PDFDocument, data: Uint8Array) {
  const image = isPng(data) ? await doc.embedPng(data) : await doc.embedJpg(data)
  const [width, height] = LETTER
  const scale = Math.min((width - 2 * PICTURE_MARGIN) / image.width, (height - 2 * PICTURE_MARGIN) / image.height, 1)
  const size = { width: image.width * scale, height: image.height * scale }
  doc.addPage(LETTER).drawImage(image, { ...size, x: (width - size.width) / 2, y: (height - size.height) / 2 })
}

/** Adds a document's pages to the end of `doc`; throws, leaving `doc` as it was, if they can't be read. */
async function addPages(doc: PDFDocument, data: Uint8Array) {
  if (isPng(data) || isJpeg(data)) return addPicture(doc, data)
  const source = await PDFDocument.load(data)
  const pages = await doc.copyPages(source, source.getPageIndices())
  if (pages.length === 0) throw new Error('The PDF has no pages.')
  for (const page of pages) doc.addPage(page)
}

/**
 * The page as a reader sees it, whichever way it's turned: its size, and where
 * a point measured from the reader's bottom left falls on the page itself.
 */
function upright(page: PDFPage) {
  const { x, y, width, height } = page.getCropBox()
  const turn = (((page.getRotation().angle % 360) + 360) % 360) as 0 | 90 | 180 | 270
  const sideways = turn === 90 || turn === 270
  const at = (u: number, v: number) =>
    ({
      0: { x: x + u, y: y + v },
      90: { x: x + width - v, y: y + u },
      180: { x: x + width - u, y: y + height - v },
      270: { x: x + v, y: y + height - u },
    })[turn]
  return { width: sideways ? height : width, height: sideways ? width : height, rotate: degrees(turn), at }
}

/** Writes `text` along the foot of the page as a reader sees it. */
function stamp(page: PDFPage, text: string, font: PDFFont) {
  const view = upright(page)
  const length = font.widthOfTextAtSize(text, STAMP_SIZE)
  page.drawText(text, { ...view.at((view.width - length) / 2, STAMP_INSET), size: STAMP_SIZE, font, color: rgb(0.25, 0.25, 0.25), rotate: view.rotate })
}

const STICKER_SIZE = 10
const STICKER_PAD = 5

/** A boxed label near the bottom right of the page as a reader sees it, above the page number. */
function sticker(page: PDFPage, text: string, font: PDFFont) {
  const view = upright(page)
  const width = font.widthOfTextAtSize(text, STICKER_SIZE) + 2 * STICKER_PAD
  const height = STICKER_SIZE + 2 * STICKER_PAD
  const u = view.width - 36 - width
  const v = STAMP_INSET + 16
  page.drawRectangle({ ...view.at(u, v), width, height, color: rgb(1, 1, 1), borderColor: rgb(0, 0, 0), borderWidth: 1, rotate: view.rotate })
  page.drawText(text, { ...view.at(u + STICKER_PAD, v + STICKER_PAD + 1.5), size: STICKER_SIZE, font, rotate: view.rotate })
}

/** The first pages, for documents that start after `before` pages. */
async function frontPages(footer: string, cover: Cover, placed: (PdfPart & { index: number })[], unreadable: string[], before: number) {
  const pdf = await TextPdf.create(footer)
  cover(pdf, unreadable)
  pdf.heading('Table of contents')
  const links = []
  let section = ''
  for (const part of placed) {
    if (part.section !== section) {
      section = part.section
      pdf.space(4).text(section, { bold: true })
    }
    links.push({ ...pdf.contentsLine(part.title, before + part.index + 1), index: part.index })
  }
  return { pdf, links }
}

/**
 * The parts as one PDF. A part that can't be read is left out and named on
 * the first page, so one bad file doesn't cost the rest.
 */
export async function mergedPdf(footer: string, parts: PdfPart[], cover: Cover) {
  const doc = await PDFDocument.create()
  doc.setTitle(footer)
  const placed: (PdfPart & { index: number })[] = []
  const unreadable: string[] = []
  for (const part of parts) {
    const index = doc.getPageCount()
    try {
      await addPages(doc, await part.print())
      placed.push({ ...part, index })
    } catch (err) {
      console.error(`Could not add ${part.title} to a trial packet's PDF:`, err)
      unreadable.push(part.title)
    }
  }

  // How long the table of contents runs doesn't depend on its numbers, so a
  // first pass says how many pages come before the documents.
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold)
  for (const part of placed) if (part.sticker) sticker(doc.getPage(part.index), part.sticker, bold)

  const before = (await frontPages(footer, cover, placed, unreadable, 0)).pdf.pageCount
  const { pdf, links } = await frontPages(footer, cover, placed, unreadable, before)
  const front = await PDFDocument.load(await pdf.save({ footer: false }))
  const copied = await doc.copyPages(front, front.getPageIndices())
  copied.forEach((page, i) => doc.insertPage(i, page))

  const pages = doc.getPages()
  for (const { pageIndex, rect, index } of links) {
    const link = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], Dest: [pages[before + index].ref, PDFName.of('Fit')] })
    pages[pageIndex].node.addAnnot(doc.context.register(link))
  }

  const font = await doc.embedFont(StandardFonts.TimesRoman)
  pages.forEach((page, i) => stamp(page, `Packet page ${i + 1} of ${pages.length}`, font))
  return doc.save()
}
