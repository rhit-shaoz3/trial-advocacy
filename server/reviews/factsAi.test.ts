import { describe, expect, it } from 'vitest'
import { readGroups, type PendingFact } from './factsAi.ts'

const fact = (id: string, reviewId: string): PendingFact => ({ id, text: id, source: 'Paige', teamNumber: 1, worldNumber: 1, reviewId })
const facts = [fact('a', 'r1'), fact('b', 'r2'), fact('c', 'r2'), fact('d', 'r3')]

describe('reading the proposed groups', () => {
  it('keeps groups from two reviews or more, of known facts, each fact in one group', () => {
    expect(
      readGroups(
        [
          { headline: 'Bills.', differences: '$6,000 vs. $8,000', fact_ids: ['a', 'b', 'zzz', 'a'] },
          // Same review only: not a group.
          { headline: 'Smoke.', differences: '', fact_ids: ['b', 'c'] },
          // b is taken, so c and d are left: still two reviews.
          { headline: 'Gate.', fact_ids: ['b', 'c', 'd'] },
          { headline: '', fact_ids: ['a', 'd'] },
          'nonsense',
        ],
        facts,
      ),
    ).toEqual([
      { headline: 'Bills.', differences: '$6,000 vs. $8,000', factIds: ['a', 'b'] },
      { headline: 'Gate.', differences: '', factIds: ['c', 'd'] },
    ])
  })
})
