import { describe, expect, it } from 'vitest'
import { startingFilePhrase } from './startingFilePhrase'

describe('startingFilePhrase', () => {
  it('keeps only the first sentence, without doubling "the"', () => {
    expect(
      startingFilePhrase('The complaint, notice of removal, and pretrial order. Read this first: every team starts here.'),
    ).toBe('the complaint, notice of removal, and pretrial order')
  })

  it('adds "the" to a plain title', () => {
    expect(startingFilePhrase('Amended complaint')).toBe('the Amended complaint')
  })

  it("doesn't split at abbreviations or file extensions", () => {
    expect(startingFilePhrase('Crest v. Thrillville complaint')).toBe('the Crest v. Thrillville complaint')
    expect(startingFilePhrase('01_Complaint.pdf')).toBe('the 01_Complaint.pdf')
  })
})
