import type { MatchupInput, Side, TeamInput } from './types'

/** Returns a number in [0, 1), like Math.random. Tests pass a seeded one. */
export type Random = () => number

function shuffle<T>(items: readonly T[], random: Random) {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/**
 * Splits students into teams of `teamSize`, named "{caseName} 1", "{caseName} 2", ...
 * Leftover students each join a different random team (going around again only
 * if there are more leftovers than teams). Sides alternate plaintiff/defendant,
 * so an odd number of teams has one extra plaintiff team.
 */
export function autoTeams(
  studentIds: readonly string[],
  teamSize: number,
  caseName: string,
  random: Random = Math.random,
): TeamInput[] {
  const size = Math.max(1, Math.floor(teamSize))
  const count = Math.max(1, Math.floor(studentIds.length / size))
  const teams: TeamInput[] = Array.from({ length: count }, (_, i) => ({
    name: `${caseName} ${i + 1}`,
    side: (i % 2 === 0 ? 'plaintiff' : 'defendant') as Side,
    studentIds: [],
  }))

  const shuffled = shuffle(studentIds, random)
  const dealt = Math.min(shuffled.length, count * size)
  shuffled.slice(0, dealt).forEach((id, i) => teams[Math.floor(i / size)].studentIds.push(id))

  const order = shuffle(teams, random)
  shuffled.slice(dealt).forEach((id, i) => order[i % order.length].studentIds.push(id))
  return teams
}

/**
 * Pairs plaintiff teams with defendant teams at random, one-to-one. Teams left
 * over because one side has more teams are returned in `unmatched`.
 */
export function autoMatchups(
  teams: readonly { id: string; side: Side }[],
  random: Random = Math.random,
) {
  const plaintiffs = shuffle(teams.filter((t) => t.side === 'plaintiff'), random)
  const defendants = shuffle(teams.filter((t) => t.side === 'defendant'), random)
  const pairs = Math.min(plaintiffs.length, defendants.length)
  const matchups: MatchupInput[] = plaintiffs.slice(0, pairs).map((p, i) => ({
    plaintiffTeamId: p.id,
    defendantTeamId: defendants[i].id,
  }))
  const unmatched = [...plaintiffs.slice(pairs), ...defendants.slice(pairs)].map((t) => t.id)
  return { matchups, unmatched }
}
