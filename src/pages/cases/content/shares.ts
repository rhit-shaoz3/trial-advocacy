import type { CaseTeams, MaterialShares } from '../../../courses/types'
import { worldLabel } from '../../../courses/worldLabel'

/** "World A: Team 1 v. Team 2" */
export function worldName(teams: CaseTeams, matchupId: string) {
  const m = teams.matchups.find((x) => x.id === matchupId)
  if (!m) return 'A case world'
  const number = (id: string) => teams.teams.find((t) => t.id === id)?.number
  return `World ${worldLabel(m.number)}: Team ${number(m.plaintiffTeamId)} v. Team ${number(m.defenseTeamId)}`
}

export function teamName(teams: CaseTeams, teamId: string) {
  const t = teams.teams.find((x) => x.id === teamId)
  return t ? `Team ${t.number}` : 'A team'
}

/** "World A, Team 3": who a file is shared with beyond its audience. */
export function sharesLabel(teams: CaseTeams | null, shares: MaterialShares | undefined) {
  if (!teams || !shares) return ''
  const worlds = shares.matchupIds.map((id) => `World ${worldLabel(teams.matchups.find((m) => m.id === id)?.number ?? 0)}`)
  return [...worlds, ...shares.teamIds.map((id) => teamName(teams, id))].join(', ')
}
