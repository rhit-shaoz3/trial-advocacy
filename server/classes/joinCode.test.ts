import { describe, expect, it } from 'vitest'
import { joinCodePrefix, makeJoinCode, normalizeJoinCode } from './joinCode.ts'

describe('joinCodePrefix', () => {
  it.each([
    ['Trial Advocacy Fall 2026', 'TAF2'],
    ['Evidence', 'EVID'],
    ['Civil Procedure', 'CP'],
    ['Trial-Advocacy', 'TA'],
    ['Law 101', 'L1'],
    ['One Two Three Four Five', 'OTTF'],
    ['   ', 'CLASS'],
    ['¡¿!?', 'CLASS'],
  ])('%j -> %s', (name, prefix) => {
    expect(joinCodePrefix(name)).toBe(prefix)
  })
})

describe('makeJoinCode', () => {
  it('adds the requested number of random digits to the prefix', () => {
    expect(makeJoinCode('Evidence', 3)).toMatch(/^EVID\d{3}$/)
    expect(makeJoinCode('Evidence', 4)).toMatch(/^EVID\d{4}$/)
  })
})

describe('normalizeJoinCode', () => {
  it('ignores case, spaces and dashes', () => {
    expect(normalizeJoinCode(' taf2-482 ')).toBe('TAF2482')
  })
})
