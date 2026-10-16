import { randomInt } from 'node:crypto'
import type { PoolClient } from 'pg'
import { HttpError } from '../httpError.ts'
import { changeTeams, listTeams, partnerKey } from './teams.ts'

export type Side = 'plaintiff' | 'defense'

async function insertMatchup(client: PoolClient, caseId: string, plaintiffTeamId: string, defenseTeamId: string) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO matchups (case_id, number)
     SELECT $1, coalesce(max(number), 0) + 1 FROM matchups WHERE case_id = $1
     RETURNING id`,
    [caseId],
  )
  await client.query(
    `INSERT INTO matchup_teams (matchup_id, case_id, team_id, side)
     VALUES ($1, $2, $3, 'plaintiff'), ($1, $2, $4, 'defense')`,
    [rows[0].id, caseId, plaintiffTeamId, defenseTeamId],
  )
}

/** Sets two of the case's unmatched teams against each other in a new world. */
export function createMatchup(courseId: string, caseId: string, plaintiffTeamId: string, defenseTeamId: string) {
  return changeTeams(courseId, caseId, async (client) => {
    if (plaintiffTeamId === defenseTeamId) throw new HttpError(400, 'Choose two different teams.')
    const { rows } = await client.query<{ id: string; number: number; matched: boolean }>(
      `SELECT t.id, t.number, EXISTS (SELECT 1 FROM matchup_teams mt WHERE mt.team_id = t.id) AS matched
       FROM teams t WHERE t.case_id = $1 AND t.id = ANY($2::uuid[])`,
      [caseId, [plaintiffTeamId, defenseTeamId]],
    )
    if (rows.length !== 2) throw new HttpError(404, 'Team not found.')
    const matched = rows.find((t) => t.matched)
    if (matched) throw new HttpError(409, `Team ${matched.number} is already in a case world.`)
    await insertMatchup(client, caseId, plaintiffTeamId, defenseTeamId)
  })
}

export function swapSides(courseId: string, caseId: string, matchupId: string) {
  return changeTeams(courseId, caseId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE matchup_teams
       SET side = CASE side WHEN 'plaintiff' THEN 'defense' ELSE 'plaintiff' END
       WHERE matchup_id = $1 AND case_id = $2`,
      [matchupId, caseId],
    )
    if (!rowCount) throw new HttpError(404, 'Case world not found.')
  })
}

/** Its teams go back to waiting for an opponent. */
export function deleteMatchup(courseId: string, caseId: string, matchupId: string) {
  return changeTeams(courseId, caseId, async (client) => {
    const { rowCount } = await client.query('DELETE FROM matchups WHERE id = $1 AND case_id = $2', [
      matchupId,
      caseId,
    ])
    if (rowCount !== 1) throw new HttpError(404, 'Case world not found.')
  })
}

export function clearMatchups(courseId: string, caseId: string) {
  return changeTeams(courseId, caseId, async (client) => {
    await client.query('DELETE FROM matchups WHERE case_id = $1', [caseId])
  })
}

/**
 * Sets every unmatched team of the case against another at random. Avoids
 * students facing anyone they faced in the course's other cases where it can,
 * and gives plaintiff to the team whose members have argued it less.
 */
export function autoMatch(courseId: string, caseId: string) {
  return changeTeams(courseId, caseId, async (client) => {
    const { teams, matchups } = await listTeams(courseId, caseId, client)
    const matched = new Set(matchups.flatMap((m) => [m.plaintiffTeamId, m.defenseTeamId]))
    const waiting = teams.filter((t) => !matched.has(t.id))
    if (waiting.length < 2) throw new HttpError(409, 'There are not two teams waiting for an opponent.')

    const { rows: opponents } = await client.query<{ a: string; b: string }>(
      `SELECT a.email AS a, b.email AS b
       FROM matchup_teams ma
       JOIN matchup_teams mb ON mb.matchup_id = ma.matchup_id AND mb.side <> ma.side
       JOIN team_members a ON a.team_id = ma.team_id
       JOIN team_members b ON b.team_id = mb.team_id
       WHERE a.course_id = $1 AND ma.case_id <> $2`,
      [courseId, caseId],
    )
    const { rows: sides } = await client.query<{ email: string; lean: number }>(
      `SELECT m.email, sum(CASE mt.side WHEN 'plaintiff' THEN 1 ELSE -1 END)::int AS lean
       FROM matchup_teams mt
       JOIN team_members m ON m.team_id = mt.team_id
       WHERE m.course_id = $1 AND mt.case_id <> $2
       GROUP BY m.email`,
      [courseId, caseId],
    )

    const { pairs } = matchTeams(
      waiting.map((t) => ({ id: t.id, members: t.members.map((m) => m.email) })),
      new Set(opponents.map((r) => partnerKey(r.a, r.b))),
      new Map(sides.map((r) => [r.email, r.lean])),
    )
    for (const pair of pairs) await insertMatchup(client, caseId, pair.plaintiff, pair.defense)
  })
}

interface TeamToMatch {
  id: string
  members: string[]
}

/**
 * Pairs teams at random, preferring opponents whose members haven't faced
 * each other (`pastOpponents` holds `partnerKey`s of students). In each pair,
 * the team whose members lean plaintiff (`sideLean`: plaintiff count minus
 * defense count) takes defense. With an odd count, one team is left over.
 */
export function matchTeams(
  teams: TeamToMatch[],
  pastOpponents: Set<string>,
  sideLean: Map<string, number>,
  random: (max: number) => number = randomInt,
): { pairs: { plaintiff: string; defense: string }[]; leftover: string | null } {
  const remaining = [...teams]
  for (let i = remaining.length - 1; i > 0; i--) {
    const j = random(i + 1)
    ;[remaining[i], remaining[j]] = [remaining[j], remaining[i]]
  }

  const clashes = (x: TeamToMatch, y: TeamToMatch) =>
    x.members.reduce((n, a) => n + y.members.filter((b) => pastOpponents.has(partnerKey(a, b))).length, 0)
  const lean = (t: TeamToMatch) => t.members.reduce((n, m) => n + (sideLean.get(m) ?? 0), 0)

  const pairs: { plaintiff: string; defense: string }[] = []
  while (remaining.length >= 2) {
    const a = remaining.shift()!
    let best = 0
    for (let i = 1; i < remaining.length && clashes(a, remaining[best]) > 0; i++) {
      if (clashes(a, remaining[i]) < clashes(a, remaining[best])) best = i
    }
    const [b] = remaining.splice(best, 1)
    // Ties keep the shuffled order, so sides are random when history is even.
    pairs.push(lean(a) <= lean(b) ? { plaintiff: a.id, defense: b.id } : { plaintiff: b.id, defense: a.id })
  }
  return { pairs, leftover: remaining[0]?.id ?? null }
}
