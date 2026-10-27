import { describe, expect, it } from 'vitest'
import { body, zip } from '../test/docx.ts'
import { docxText } from './docx.ts'

describe('reading a Word document', () => {
  it('keeps paragraphs, tabs, and line breaks, and decodes the XML', () => {
    const docx = zip({
      '[Content_Types].xml': '<Types/>',
      'word/document.xml': body(
        '<w:p><w:r><w:t>COMPLAINT</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t>1.</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve">Paige Winston &amp; Logan Crest rode </w:t></w:r><w:r><w:t>&quot;Atlas&quot;.</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t>Line one</w:t><w:br/><w:t>line two</w:t></w:r></w:p>',
      ),
    })
    expect(docxText(docx)).toBe('COMPLAINT\n1.\tPaige Winston & Logan Crest rode "Atlas".\nLine one\nline two')
  })

  it("returns null for something that isn't a Word document", () => {
    expect(docxText(Buffer.from('not a zip'))).toBeNull()
    expect(docxText(zip({ 'other.xml': '<x/>' }))).toBeNull()
  })
})
