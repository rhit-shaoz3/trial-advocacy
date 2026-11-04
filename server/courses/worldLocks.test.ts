import type request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/pool.ts'
import { createCourseAs, resetDatabase, sampleFacts, signedInAgent } from '../test/helpers.ts'

interface Body {
  teams: { id: string; number: number; members: { email: string }[] }[]
  unpaired: { email: string }[]
  matchups: { id: string; number: number; plaintiffTeamId: string; defenseTeamId: string; locked: boolean }[]
  worldsLocked: boolean
}

let prof: request.Agent
let course: { id: string; entryCode: string }
let caseId: string

const email = (n: number) => `s${n}@example.com`
const caseUrl = (id = caseId) => `/api/courses/${course.id}/cases/${id}`
const teamsUrl = () => `${caseUrl()}/teams`

beforeEach(async () => {
  await resetDatabase()
  prof = (await signedInAgent('instructor', 'prof@example.com')).agent
  course = await createCourseAs(prof)
  await prof.post(`/api/courses/${course.id}/roster`).send({ emails: Array.from({ length: 12 }, (_, i) => email(i + 1)) })
  const res = await prof.post(`/api/courses/${course.id}/cases`).send({ importantFacts: sampleFacts, summary: 'A test case.', title: 'Rivera v. Thrill Park' })
  caseId = res.body.case.id
})

afterAll(async () => {
  await pool.end()
})

/** Two worlds of two-student teams: World A is Teams 1 v 2, World B is Teams 3 v 4. */
async function twoWorlds() {
  for (let n = 1; n <= 8; n += 2) await prof.post(teamsUrl()).send({ emails: [email(n), email(n + 1)] })
  const { teams } = (await prof.get(teamsUrl())).body as Body
  await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: teams[0].id, defenseTeamId: teams[1].id })
  const body = (await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: teams[2].id, defenseTeamId: teams[3].id })).body as Body
  return { teams: body.teams, worlds: body.matchups }
}

/** A team's interview with one answer from the witness. */
async function interviewAnswer(teamId: string) {
  const { rows: [witness] } = await pool.query<{ id: string }>(
    `INSERT INTO case_witnesses (case_id, name) VALUES ($1, 'Dana Ortiz') RETURNING id`,
    [caseId],
  )
  const { rows: [interview] } = await pool.query<{ id: string }>(
    `INSERT INTO interviews (witness_id, team_id, side) VALUES ($1, $2, 'plaintiff') RETURNING id`,
    [witness.id, teamId],
  )
  await pool.query(
    `INSERT INTO interview_turns (interview_id, position, question, reply, answer, model)
     VALUES ($1, 0, 'What did you see?', 'The bar opened.', 'The bar opened.', 'test')`,
    [interview.id],
  )
  return { witnessId: witness.id, interviewId: interview.id }
}

const lockedOf = (body: Body) => body.matchups.map((m) => m.locked)

describe('when a world locks', () => {
  it('starts unlocked, and locks one world once a team in it has an interview answer', async () => {
    const { teams } = await twoWorlds()
    expect(lockedOf((await prof.get(teamsUrl())).body)).toEqual([false, false])

    await interviewAnswer(teams[1].id)
    const body = (await prof.get(teamsUrl())).body as Body
    expect(lockedOf(body)).toEqual([true, false])
    expect(body.worldsLocked).toBe(false)
  })

  it("doesn't lock for an interview with no answers yet, or an instructor's test interview", async () => {
    const { teams } = await twoWorlds()
    const { rows: [w] } = await pool.query<{ id: string }>(`INSERT INTO case_witnesses (case_id, name) VALUES ($1, 'Dana') RETURNING id`, [caseId])
    await pool.query(`INSERT INTO interviews (witness_id, team_id, side) VALUES ($1, $2, 'plaintiff')`, [w.id, teams[0].id])
    const { interviewId } = await interviewAnswer(teams[0].id)
    await pool.query('UPDATE interviews SET team_id = NULL WHERE id = $1', [interviewId])
    expect(lockedOf((await prof.get(teamsUrl())).body)).toEqual([false, false])
  })

  it('locks for an exchange request, a subpoena, or a file only that world has', async () => {
    const { teams, worlds } = await twoWorlds()
    await pool.query(
      `INSERT INTO exchange_requests (case_id, kind, from_team_id, to_team_id, due_at)
       VALUES ($1, 'rfas', $2, $3, now() + interval '7 days')`,
      [caseId, teams[0].id, teams[1].id],
    )
    expect(lockedOf((await prof.get(teamsUrl())).body)).toEqual([true, false])

    await pool.query(
      `INSERT INTO case_materials (case_id, filename, content_type, size_bytes, matchup_id)
       VALUES ($1, 'Lab report.pdf', 'application/pdf', 10, $2)`,
      [caseId, worlds[1].id],
    )
    expect(lockedOf((await prof.get(teamsUrl())).body)).toEqual([true, true])
  })

  it('locks a world for a subpoena its team served', async () => {
    const { teams } = await twoWorlds()
    await pool.query(
      `INSERT INTO subpoenas (case_id, team_id, world_number, team_number, side, recipient, records, due_at)
       VALUES ($1, $2, 2, 3, 'plaintiff', 'Thrill Park', 'Logs', now() + interval '7 days')`,
      [caseId, teams[2].id],
    )
    expect(lockedOf((await prof.get(teamsUrl())).body)).toEqual([false, true])
  })

  it('locks every world when the case leaves Introduction, and keeps them locked if it goes back', async () => {
    await twoWorlds()
    await prof.put(`${caseUrl()}/phase`).send({ phase: 'deposition' }).expect(200)
    let body = (await prof.get(teamsUrl())).body as Body
    expect(body.worldsLocked).toBe(true)
    expect(lockedOf(body)).toEqual([true, true])

    await prof.put(`${caseUrl()}/phase`).send({ phase: 'introduction' }).expect(200)
    body = (await prof.get(teamsUrl())).body as Body
    expect(body.worldsLocked).toBe(true)
    expect(lockedOf(body)).toEqual([true, true])
  })

  it('starts a copy of a locked case unlocked', async () => {
    await twoWorlds()
    await prof.put(`${caseUrl()}/phase`).send({ phase: 'deposition' }).expect(200)
    const copy = await prof.post(`${caseUrl()}/duplicate`).send({ title: 'Rivera again' })
    expect(copy.status).toBe(201)
    const { rows } = await pool.query('SELECT worlds_locked_at FROM cases WHERE id = $1', [copy.body.case.id])
    expect(rows[0].worlds_locked_at).toBeNull()
  })
})

describe('a locked world', () => {
  async function lockWorldA() {
    const setup = await twoWorlds()
    await interviewAnswer(setup.teams[0].id)
    return setup
  }

  it("can't be deleted or have its sides swapped", async () => {
    const { worlds } = await lockWorldA()
    const del = await prof.delete(`${caseUrl()}/matchups/${worlds[0].id}`)
    expect(del.status).toBe(409)
    expect(del.body.error).toMatch(/World A is locked/)
    expect((await prof.post(`${caseUrl()}/matchups/${worlds[0].id}/swap`)).status).toBe(409)
    // World B is still open.
    expect((await prof.post(`${caseUrl()}/matchups/${worlds[1].id}/swap`)).status).toBe(200)
  })

  it("can't lose a team, or have a team emptied", async () => {
    const { teams } = await lockWorldA()
    expect((await prof.delete(`${teamsUrl()}/${teams[1].id}`)).status).toBe(409)

    await prof.delete(`${teamsUrl()}/${teams[1].id}/members/${email(3)}`).expect(200)
    const last = await prof.delete(`${teamsUrl()}/${teams[1].id}/members/${email(4)}`)
    expect(last.status).toBe(409)
    expect(last.body.error).toBe('Team 2 is in World A, which is locked, so it needs at least one student.')
    const body = (await prof.get(teamsUrl())).body as Body
    expect(body.teams[1].members.map((m) => m.email)).toEqual([email(4)])
  })

  it('takes new students, and students moved in from other teams', async () => {
    const { teams } = await lockWorldA()
    await prof.post(`${teamsUrl()}/${teams[0].id}/members`).send({ email: email(9) }).expect(200)

    const moved = await prof.put(`${teamsUrl()}/${teams[0].id}/members/${email(5)}`)
    expect(moved.status).toBe(200)
    const body = moved.body as Body
    expect(body.teams[0].members.map((m) => m.email).sort()).toEqual([email(1), email(2), email(5), email(9)].sort())
    expect(body.teams[2].members.map((m) => m.email)).toEqual([email(6)])
    expect(lockedOf(body)).toEqual([true, false])
  })

  it("won't move a team's last student out", async () => {
    const { teams } = await lockWorldA()
    await prof.delete(`${teamsUrl()}/${teams[0].id}/members/${email(1)}`).expect(200)
    const res = await prof.put(`${teamsUrl()}/${teams[2].id}/members/${email(2)}`)
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/Team 1 is in World A/)
  })

  it('is kept when everything else is cleared', async () => {
    const { teams, worlds } = await lockWorldA()
    let body = (await prof.delete(`${caseUrl()}/matchups`)).body as Body
    expect(body.matchups.map((m) => m.id)).toEqual([worlds[0].id])

    body = (await prof.delete(teamsUrl())).body as Body
    expect(body.teams.map((t) => t.id)).toEqual([teams[0].id, teams[1].id])
    expect(body.unpaired).toHaveLength(8)
  })
})

describe('moving a student', () => {
  it('moves them in one step, within the size limit', async () => {
    const { teams } = await twoWorlds()
    const moved = (await prof.put(`${teamsUrl()}/${teams[1].id}/members/${email(1)}`)).body as Body
    expect(moved.teams[1].members.map((m) => m.email).sort()).toEqual([email(1), email(3), email(4)])

    for (const n of [9, 10, 11, 12]) await prof.post(`${teamsUrl()}/${teams[1].id}/members`).send({ email: email(n) }).expect(200)
    const full = await prof.put(`${teamsUrl()}/${teams[1].id}/members/${email(5)}`)
    expect(full.status).toBe(409)
    expect(full.body.error).toBe('A team can have at most 7 students.')
  })

  it('needs a student on a team', async () => {
    const { teams } = await twoWorlds()
    expect((await prof.put(`${teamsUrl()}/${teams[0].id}/members/${email(12)}`)).status).toBe(404)
  })
})

describe('a case past Introduction', () => {
  it('still makes new teams and worlds, which lock only once they have something of their own', async () => {
    for (let n = 1; n <= 8; n += 2) await prof.post(teamsUrl()).send({ emails: [email(n), email(n + 1)] })
    const { teams } = (await prof.get(teamsUrl())).body as Body
    await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: teams[0].id, defenseTeamId: teams[1].id })
    await prof.put(`${caseUrl()}/phase`).send({ phase: 'deposition' }).expect(200)

    expect((await prof.post(teamsUrl()).send({ emails: [email(9), email(10)] })).status).toBe(201)
    expect((await prof.post(`${teamsUrl()}/auto`).send({})).status).toBe(200)
    let body = (await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: teams[2].id, defenseTeamId: teams[3].id })).body as Body
    expect(lockedOf(body)).toEqual([true, false])
    body = (await prof.post(`${caseUrl()}/matchups/auto`)).body as Body
    expect(lockedOf(body)).toEqual([true, false, false])

    // A new world can still be undone, until it has facts of its own.
    await prof.post(`${caseUrl()}/matchups/${body.matchups[2].id}/swap`).expect(200)
    await prof.delete(`${caseUrl()}/matchups/${body.matchups[2].id}`).expect(200)
    await interviewAnswer(teams[2].id)
    expect(lockedOf((await prof.get(teamsUrl())).body)).toEqual([true, true])
  })
})
