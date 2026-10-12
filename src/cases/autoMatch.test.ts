import { describe, expect, it } from 'vitest'
import { autoMatchups, autoTeams, type Random } from './autoMatch'

/** Small seeded random number generator, so results are repeatable. */
function seeded(seed: number): Random {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const students = (n: number) => Array.from({ length: n }, (_, i) => `s${i + 1}`)

describe('autoTeams', () => {
  it('makes teams of the requested size, spreading leftovers one per team', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const teams = autoTeams(students(11), 3, 'Case', seeded(seed))
      const sizes = teams.map((t) => t.studentIds.length).sort()
      expect(sizes).toEqual([3, 4, 4])
    }
  })

  it('names teams in order and alternates sides, extra team going to plaintiff', () => {
    const teams = autoTeams(students(10), 3, 'Smith v. Jones', seeded(1))

    expect(teams.map((t) => t.name)).toEqual(['Smith v. Jones 1', 'Smith v. Jones 2', 'Smith v. Jones 3'])
    expect(teams.map((t) => t.side)).toEqual(['plaintiff', 'defendant', 'plaintiff'])
  })

  it('puts every student on exactly one team', () => {
    const teams = autoTeams(students(17), 4, 'Case', seeded(7))
    const placed = teams.flatMap((t) => t.studentIds).sort()

    expect(placed).toEqual(students(17).sort())
  })

  it('makes a single team when there are fewer students than the team size', () => {
    const teams = autoTeams(students(2), 5, 'Case', seeded(3))

    expect(teams).toHaveLength(1)
    expect(teams[0].studentIds).toHaveLength(2)
  })

  it('goes around again when there are more leftovers than teams', () => {
    // 7 students, size 4: one team of 4 plus 3 leftovers, all on that team.
    const teams = autoTeams(students(7), 4, 'Case', seeded(2))

    expect(teams).toHaveLength(1)
    expect(teams[0].studentIds).toHaveLength(7)
  })

  it('shuffles students differently for different random values', () => {
    const a = autoTeams(students(12), 3, 'Case', seeded(1)).map((t) => t.studentIds)
    const b = autoTeams(students(12), 3, 'Case', seeded(2)).map((t) => t.studentIds)

    expect(a).not.toEqual(b)
  })
})

describe('autoMatchups', () => {
  const team = (id: string, side: 'plaintiff' | 'defendant') => ({ id, side })

  it('pairs every plaintiff team with a different defendant team', () => {
    const { matchups, unmatched } = autoMatchups(
      [team('p1', 'plaintiff'), team('d1', 'defendant'), team('p2', 'plaintiff'), team('d2', 'defendant')],
      seeded(4),
    )

    expect(matchups).toHaveLength(2)
    expect(matchups.map((m) => m.plaintiffTeamId).sort()).toEqual(['p1', 'p2'])
    expect(matchups.map((m) => m.defendantTeamId).sort()).toEqual(['d1', 'd2'])
    expect(unmatched).toEqual([])
  })

  it('reports the leftover team when the sides are uneven', () => {
    const { matchups, unmatched } = autoMatchups(
      [team('p1', 'plaintiff'), team('d1', 'defendant'), team('p2', 'plaintiff')],
      seeded(5),
    )

    expect(matchups).toHaveLength(1)
    expect(unmatched).toHaveLength(1)
    expect(['p1', 'p2']).toContain(unmatched[0])
  })
})
