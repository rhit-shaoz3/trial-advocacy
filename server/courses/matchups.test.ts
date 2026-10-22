import type request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/pool.ts'
import { createCourseAs, resetDatabase, sampleFacts, signedInAgent } from '../test/helpers.ts'
import { matchTeams } from './matchups.ts'
import { partnerKey } from './teams.ts'

interface Body {
  teams: { id: string; number: number; members: { email: string }[] }[]
  unpaired: { email: string }[]
  matchups: { id: string; number: number; plaintiffTeamId: string; defenseTeamId: string }[]
}

let prof: request.Agent
let course: { id: string; entryCode: string }
let caseId: string

const email = (n: number) => `s${n}@example.com`

async function newCase(title: string) {
  const res = await prof.post(`/api/courses/${course.id}/cases`).send({ importantFacts: sampleFacts, summary: 'A test case.', title })
  return res.body.case.id as string
}

const caseUrl = (id = caseId) => `/api/courses/${course.id}/cases/${id}`

/** Pairs students into teams [[s1, s2], [s3, s4], ...] in order, returning the teams. */
async function pairInOrder(count: number, id = caseId) {
  let body: Body | undefined
  for (let n = 1; n <= count; n += 2) {
    body = (await prof.post(`${caseUrl(id)}/teams`).send({ emails: [email(n), email(n + 1)] })).body
  }
  return body!.teams
}

beforeEach(async () => {
  await resetDatabase()
  prof = (await signedInAgent('instructor', 'prof@example.com')).agent
  course = await createCourseAs(prof)
  await prof.post(`/api/courses/${course.id}/roster`).send({ emails: Array.from({ length: 10 }, (_, i) => email(i + 1)) })
  caseId = await newCase('Rivera v. Thrill Park')
})

afterAll(async () => {
  await pool.end()
})

describe('creating case worlds by hand', () => {
  it('sets two teams against each other, numbering the worlds', async () => {
    const [t1, t2, t3, t4] = await pairInOrder(8)

    const res = await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: t1.id, defenseTeamId: t2.id })
    expect(res.status).toBe(201)
    expect(res.body.matchups).toEqual([
      { id: expect.any(String), number: 1, plaintiffTeamId: t1.id, defenseTeamId: t2.id },
    ])

    const second = await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: t4.id, defenseTeamId: t3.id })
    expect((second.body as Body).matchups.map((m) => m.number)).toEqual([1, 2])
    // The teams list comes back with the matchups.
    expect((await prof.get(`${caseUrl()}/teams`)).body.matchups).toEqual(second.body.matchups)
  })

  it('rejects a team that is already in a world, the same team twice, or unknown teams', async () => {
    const [t1, t2, t3] = await pairInOrder(6)
    await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: t1.id, defenseTeamId: t2.id })

    const taken = await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: t3.id, defenseTeamId: t2.id })
    expect(taken.status).toBe(409)
    expect(taken.body.error).toBe('Team 2 is already in a case world.')

    const same = await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: t3.id, defenseTeamId: t3.id })
    expect(same.body.error).toBe('Choose two different teams.')

    const missing = '00000000-0000-4000-8000-000000000000'
    expect((await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: t3.id, defenseTeamId: missing })).status).toBe(404)
    expect((await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: t3.id })).status).toBe(400)
  })

  it("won't match teams from another case", async () => {
    const [t1] = await pairInOrder(2)
    const other = await newCase('State v. Hale')
    const [o1] = await pairInOrder(2, other)

    const res = await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: t1.id, defenseTeamId: o1.id })
    expect(res.status).toBe(404)
  })
})

describe('changing case worlds', () => {
  it('swaps sides, deletes one world, and clears them all', async () => {
    const [t1, t2, t3, t4] = await pairInOrder(8)
    await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: t1.id, defenseTeamId: t2.id })
    const { matchups } = (await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: t3.id, defenseTeamId: t4.id })).body as Body

    const swapped = await prof.post(`${caseUrl()}/matchups/${matchups[0].id}/swap`)
    expect(swapped.body.matchups[0]).toMatchObject({ plaintiffTeamId: t2.id, defenseTeamId: t1.id })

    const deleted = await prof.delete(`${caseUrl()}/matchups/${matchups[0].id}`)
    expect((deleted.body as Body).matchups.map((m) => m.number)).toEqual([2])
    expect(deleted.body.teams).toHaveLength(4)

    expect((await prof.delete(`${caseUrl()}/matchups`)).body.matchups).toEqual([])
  })

  it('returns 404 for unknown worlds', async () => {
    expect((await prof.post(`${caseUrl()}/matchups/nope/swap`)).body.error).toBe('Case world not found.')
    const missing = '00000000-0000-4000-8000-000000000000'
    expect((await prof.delete(`${caseUrl()}/matchups/${missing}`)).status).toBe(404)
  })

  it('removes a world when one of its teams goes away', async () => {
    const [t1, t2, t3, t4] = await pairInOrder(8)
    await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: t1.id, defenseTeamId: t2.id })
    await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: t3.id, defenseTeamId: t4.id })

    const afterDelete = await prof.delete(`${caseUrl()}/teams/${t1.id}`)
    expect((afterDelete.body as Body).matchups.map((m) => m.number)).toEqual([2])

    // Removing both of team 3's students from the roster empties it, so world 2 goes too.
    await prof.delete(`/api/courses/${course.id}/roster/${encodeURIComponent(email(5))}`)
    await prof.delete(`/api/courses/${course.id}/roster/${encodeURIComponent(email(6))}`)
    expect((await prof.get(`${caseUrl()}/teams`)).body.matchups).toEqual([])

    await prof.delete(`${caseUrl()}/teams`)
    const { rows } = await pool.query('SELECT (SELECT count(*) FROM matchups)::int AS m, (SELECT count(*) FROM matchup_teams)::int AS t')
    expect(rows[0]).toEqual({ m: 0, t: 0 })
  })

  it('freezes the worlds of a closed case', async () => {
    const [t1, t2] = await pairInOrder(4)
    await prof.patch(caseUrl()).send({ importantFacts: sampleFacts, title: 'Rivera v. Thrill Park', summary: '', status: 'closed' })

    const res = await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: t1.id, defenseTeamId: t2.id })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('This case is closed, so its teams and case worlds can no longer change.')
  })
})

describe('auto-matching', () => {
  it('matches every waiting team, leaving one out when the count is odd', async () => {
    const teams = await pairInOrder(10)
    await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: teams[0].id, defenseTeamId: teams[1].id })

    const res = await prof.post(`${caseUrl()}/matchups/auto`)

    expect(res.status).toBe(200)
    const { matchups } = res.body as Body
    expect(matchups.map((m) => m.number)).toEqual([1, 2])
    const used = matchups.flatMap((m) => [m.plaintiffTeamId, m.defenseTeamId])
    expect(new Set(used).size).toBe(4)

    const again = await prof.post(`${caseUrl()}/matchups/auto`)
    expect(again.status).toBe(409)
    expect(again.body.error).toBe('There are not two teams waiting for an opponent.')
  })

  it("avoids opponents students faced in earlier cases", async () => {
    // Case 1: (s1,s2) v (s3,s4) and (s5,s6) v (s7,s8), plaintiffs first.
    const [a, b, c, d] = await pairInOrder(8)
    await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: a.id, defenseTeamId: b.id })
    await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: c.id, defenseTeamId: d.id })

    // Case 2 keeps the same pairs.
    const second = await newCase('State v. Hale')
    const teams = await pairInOrder(8, second)
    const byFirst = new Map(teams.map((t) => [t.members[0].email, t.id]))

    for (let run = 0; run < 5; run++) {
      const { matchups } = (await prof.post(`${caseUrl(second)}/matchups/auto`)).body as Body
      for (const m of matchups) {
        const pair = [m.plaintiffTeamId, m.defenseTeamId].sort()
        expect(pair).not.toEqual([byFirst.get(email(1)), byFirst.get(email(3))].sort())
        expect(pair).not.toEqual([byFirst.get(email(5)), byFirst.get(email(7))].sort())
      }
      await prof.delete(`${caseUrl(second)}/matchups`)
    }
  })

  it("switches students' sides from earlier cases", async () => {
    const [a, b] = await pairInOrder(4)
    await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: a.id, defenseTeamId: b.id })
    const second = await newCase('State v. Hale')
    const [a2, b2] = await pairInOrder(4, second)

    for (let run = 0; run < 5; run++) {
      const { matchups } = (await prof.post(`${caseUrl(second)}/matchups/auto`)).body as Body
      expect(matchups[0]).toMatchObject({ plaintiffTeamId: b2.id, defenseTeamId: a2.id })
      await prof.delete(`${caseUrl(second)}/matchups`)
    }
  })
})

describe("a student's case world", () => {
  it('shows their world, side, and opponents', async () => {
    const { agent: student } = await signedInAgent('student', email(1), 'Ada Lawyer')
    const [t1, t2] = await pairInOrder(4)
    await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: t2.id, defenseTeamId: t1.id })
    await prof.patch(caseUrl()).send({ importantFacts: sampleFacts, title: 'Rivera v. Thrill Park', summary: '', status: 'active' })

    const { cases } = (await student.get(`/api/courses/${course.id}/my-cases`)).body
    expect(cases[0].team.number).toBe(1)
    expect(cases[0].world).toEqual({
      number: 1,
      side: 'defense',
      opponents: {
        number: 2,
        members: [
          { email: email(3), name: null, joined: false, avatarUrl: null, you: false },
          { email: email(4), name: null, joined: false, avatarUrl: null, you: false },
        ],
      },
    })
  })
})

describe('the course home cases', () => {
  it("lists a student's launched cases with their world, role, and everyone in it", async () => {
    const { agent: student } = await signedInAgent('student', email(1), 'Ada Lawyer')
    const home = async () => (await student.get(`/api/courses/${course.id}/home`)).body.cases
    const [t1, t2] = await pairInOrder(4)
    await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: t1.id, defenseTeamId: t2.id })

    // Drafts stay off the dashboard.
    expect(await home()).toEqual([])

    await prof.patch(caseUrl()).send({ importantFacts: sampleFacts, title: 'Rivera v. Thrill Park', summary: 'Coaster.', status: 'active' })
    // A launched case the student isn't paired in doesn't show either.
    const other = await newCase('State v. Hale')
    await prof.patch(caseUrl(other)).send({ importantFacts: sampleFacts, title: 'State v. Hale', summary: '', status: 'active' })

    expect(await home()).toEqual([
      {
        id: caseId,
        title: 'Rivera v. Thrill Park',
        summary: 'Coaster.',
        status: 'active',
        world: { number: 1, side: 'plaintiff' },
        worldCount: null,
        progress: null,
        nextMilestone: null,
        nextTask: null,
        participants: [{ name: 'Ada Lawyer', avatarUrl: null }, { name: email(2), avatarUrl: null }, { name: email(3), avatarUrl: null }, { name: email(4), avatarUrl: null }],
      },
    ])
  })

  it('lists every launched case for the instructor, with its worlds and paired students', async () => {
    const [t1, t2] = await pairInOrder(4)
    await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: t1.id, defenseTeamId: t2.id })
    await prof.patch(caseUrl()).send({ importantFacts: sampleFacts, title: 'Rivera v. Thrill Park', summary: '', status: 'active' })
    await newCase('Still a draft')

    const { cases } = (await prof.get(`/api/courses/${course.id}/home`)).body
    expect(cases).toEqual([
      expect.objectContaining({ id: caseId, worldCount: 1, world: null, participants: expect.any(Array) }),
    ])
    expect(cases[0].participants).toHaveLength(4)
  })
})

describe('access', () => {
  it('is closed to students and to other instructors', async () => {
    const { agent: student } = await signedInAgent('student', email(1))
    const other = (await signedInAgent('instructor', 'other@example.com')).agent

    expect((await student.post(`${caseUrl()}/matchups/auto`)).status).toBe(404)
    expect((await other.delete(`${caseUrl()}/matchups`)).status).toBe(404)
  })
})

describe('matchTeams', () => {
  const inOrder = () => 0 // makes the shuffle deterministic
  const team = (id: string, ...members: string[]) => ({ id, members })

  it('pairs teams and leaves the odd one out', () => {
    const { pairs, leftover } = matchTeams([team('x', 'a'), team('y', 'b'), team('z', 'c')], new Set(), new Map(), inOrder)
    expect(pairs).toHaveLength(1)
    expect([...pairs.flatMap((p) => [p.plaintiff, p.defense]), leftover].sort()).toEqual(['x', 'y', 'z'])
  })

  it('prefers opponents with no history, and gives plaintiff to the team that has had it less', () => {
    const teams = [team('w', 'a'), team('x', 'b'), team('y', 'c'), team('z', 'd')]
    const past = new Set([partnerKey('a', 'b'), partnerKey('a', 'c'), partnerKey('d', 'b'), partnerKey('d', 'c')])
    const lean = new Map([['a', 1], ['d', -1]])

    const { pairs } = matchTeams(teams, past, lean, inOrder)

    // a's only fresh opponent is d; a was plaintiff before, so d takes plaintiff.
    expect(pairs).toContainEqual({ plaintiff: 'z', defense: 'w' })
  })
})
