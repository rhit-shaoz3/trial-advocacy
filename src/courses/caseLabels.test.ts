import { describe, expect, it } from 'vitest'
import { caseOverview } from './caseLabels'

describe('caseOverview', () => {
  it('keeps only the first paragraph of the summary', () => {
    const summary = 'A rider was hurt on the coaster.\n\nProcedural history: the case was removed.\n\nOnly negligence remains.'
    expect(caseOverview(summary)).toBe('A rider was hurt on the coaster.')
  })

  it('treats blank lines with spaces as paragraph breaks, and leaves one-paragraph summaries alone', () => {
    expect(caseOverview('  First part.\r\n  \r\nSecond part.')).toBe('First part.')
    expect(caseOverview('Just one paragraph,\nwrapped onto two lines.')).toBe('Just one paragraph,\nwrapped onto two lines.')
    expect(caseOverview('')).toBe('')
  })
})
