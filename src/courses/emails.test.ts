import { describe, expect, it } from 'vitest'
import { findEmails, readEmailsFromFile } from './emails'

describe('findEmails', () => {
  it('finds emails in any column of a CSV, skipping headers and duplicates', () => {
    const csv = [
      'Name,Email,Section',
      'Sam Student,sam@school.edu,A',
      '"Ana, Jr.",ANA@School.edu,B',
      'Sam again,Sam@school.edu,A',
      'No email here,,C',
    ].join('\n')

    expect(findEmails(csv)).toEqual(['sam@school.edu', 'ana@school.edu'])
  })

  it('handles semicolons, angle brackets and quotes around addresses', () => {
    expect(findEmails('Sam <sam@a.co>; "bo@b.org"')).toEqual(['sam@a.co', 'bo@b.org'])
  })

  it('returns nothing when there are no emails', () => {
    expect(findEmails('name\nSam\nAna')).toEqual([])
  })
})

describe('readEmailsFromFile', () => {
  it('rejects file types it cannot read', async () => {
    const file = new File(['x'], 'roster.pdf')
    await expect(readEmailsFromFile(file)).rejects.toThrow('Upload an Excel (.xlsx) or CSV file.')
  })
})
