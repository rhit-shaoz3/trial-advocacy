import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { extractMadeFiles, MAX_MADE_FILES, madeFileText, renderMadeFile } from './records.ts'

const REPORT = `1. The property record lists the owner. [NEW FACT] [NEW RECORD: Property record]

<record title="Property record">
PARCEL 14-220
Owner: Elm Street Holdings LLC
</record>

<aid title="Typical costs">
SUMMARY: About $2,000 a month, an estimate.
UNIT: dollars per month
DATA:
- Contract service | $2,400 | [1]
- In-house | $1,500 to $1,800 | [1, 2]
- Unknown | not published |
SOURCES:
1. Cleaning Cost Survey (2024)
2. Grocery Maintenance Benchmarks (2023)
</aid>`

describe('extractMadeFiles', () => {
  it('takes the records and aids out of the report, reading the aid’s figures and sources', () => {
    const { body, files } = extractMadeFiles(REPORT)
    expect(body).toBe('1. The property record lists the owner. [NEW FACT] [NEW RECORD: Property record]')
    expect(files[0]).toEqual({ kind: 'record', title: 'Property record', text: 'PARCEL 14-220\nOwner: Elm Street Holdings LLC' })
    expect(files[1]).toEqual({
      kind: 'aid',
      title: 'Typical costs',
      summary: 'About $2,000 a month, an estimate.',
      unit: 'dollars per month',
      rows: [
        { label: 'Contract service', value: '$2,400', amount: 2400, high: null, sources: [1] },
        { label: 'In-house', value: '$1,500 to $1,800', amount: 1500, high: 1800, sources: [1, 2] },
        { label: 'Unknown', value: 'not published', amount: null, high: null, sources: [] },
      ],
      sources: ['Cleaning Cost Survey (2024)', 'Grocery Maintenance Benchmarks (2023)'],
    })
  })

  it('keeps at most a few, and no two with the same title', () => {
    const many = Array.from({ length: 6 }, (_, i) => `<record title="R${i % 5}">x</record>`).join('\n')
    expect(extractMadeFiles(many).files.map((f) => f.title)).toEqual(['R0', 'R1', 'R2', 'R3'].slice(0, MAX_MADE_FILES))
  })
})

describe('renderMadeFile', () => {
  it('draws a record and an aid as PDFs, running onto more pages as needed', async () => {
    const { files } = extractMadeFiles(REPORT)
    const pages = async (data: Uint8Array) => (await PDFDocument.load(data)).getPageCount()
    expect(await pages(await renderMadeFile(files[0], 'John Hastings', 1))).toBe(1)
    expect(await pages(await renderMadeFile(files[1], 'John Hastings', 1))).toBe(1)
    const long = {
      kind: 'record' as const,
      title: 'Long log',
      text: Array.from({ length: 150 }, (_, i) => `Line ${i} ≈ “quoted” — ok`).join('\n'),
    }
    expect(await pages(await renderMadeFile(long, 'John Hastings', 1))).toBeGreaterThan(1)
  })

  it('writes a text version the AI can read', () => {
    const { files } = extractMadeFiles(REPORT)
    expect(madeFileText(files[1], 'John Hastings')).toContain('- In-house: $1,500 to $1,800 [1, 2]')
  })
})
