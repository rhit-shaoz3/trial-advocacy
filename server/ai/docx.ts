import { inflateRawSync } from 'node:zlib'

/** A Word document (.docx). */
export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/**
 * The text of a Word document, read on the server (no AI needed): a .docx is
 * a zip file whose body is word/document.xml. Paragraphs become lines, tabs
 * and line breaks are kept. Returns null if the file isn't a readable .docx.
 */
export function docxText(data: Buffer): string | null {
  const xml = zipEntry(data, 'word/document.xml')
  if (xml === null) return null
  const text = xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:(br|cr)\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text || null
}

/** One file from a zip archive, as text; null if it's missing or can't be read. */
function zipEntry(zip: Buffer, name: string): string | null {
  // The central directory's end record sits in the last 64 KB (after an optional comment).
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (end < 0 || end + 22 > zip.length) return null
  const entries = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  for (let i = 0; i < entries && at + 46 <= zip.length; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) return null
    const method = zip.readUInt16LE(at + 10)
    const size = zip.readUInt32LE(at + 20)
    const nameLength = zip.readUInt16LE(at + 28)
    const extraLength = zip.readUInt16LE(at + 30)
    const commentLength = zip.readUInt16LE(at + 32)
    const local = zip.readUInt32LE(at + 42)
    const entryName = zip.toString('utf8', at + 46, at + 46 + nameLength)
    if (entryName === name) {
      if (zip.readUInt32LE(local) !== 0x04034b50) return null
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
      const body = zip.subarray(start, start + size)
      try {
        if (method === 0) return body.toString('utf8')
        if (method === 8) return inflateRawSync(body).toString('utf8')
      } catch {
        return null
      }
      return null
    }
    at += 46 + nameLength + extraLength + commentLength
  }
  return null
}
