import type request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/pool.ts'
import { createCourseAs, resetDatabase, signedInAgent } from '../test/helpers.ts'
import { pairStudents, partnerKey } from './teams.ts'

let prof: request.Agent
let course: { id: string; entryCode: string }
let caseId: string

const STUDENTS = ['ada', 'ben', 'cy', 'dee', 'eve', 'fay', 'gus'].map((n) => `${n}@example.com`)
const [ada, ben, cy, dee, eve] = STUDENTS

async function newCase(title = 'Rivera v. Thrill Park') {
  const res = await prof.post(`/api/courses/${course.id}/cases`).send({ title })
  return res.body.case.id as string
}

beforeEach(async () => {
  await resetDatabase()
  prof = (await signedInAgent('instructor', 'prof@example.com')).agent
  course = await createCourseAs(prof)
  await prof.post(`/api/courses/${course.id}/roster`).send({ emails: STUDENTS })
  caseId = await newCase()
})

afterAll(async () => {
  await pool.end()
})

const teamsUrl = (id = caseId) => `/api/courses/${course.id}/cases/${id}/teams`
const emailsOf = (team: { members: { email: string }[] }) => team.members.map((m) => m.email).sort()
type TeamsBody = { teams: { id: string; number: number; members: { email: string }[] }[]; unpaired: { email: string }[] }

describe('listing', () => {
  it('starts with no teams and the whole roster unpaired', async () => {
    const res = await prof.get(teamsUrl())

    expect(res.status).toBe(200)
    expect(res.body.teams).toEqual([])
    expect(res.body.unpaired.map((s: { email: string }) => s.email).sort()).toEqual(STUDENTS)
    expect(res.body.unpaired[0]).toEqual({ email: expect.any(String), name: null, joined: false })
  })
})

describe('pairing by hand', () => {
  it('creates numbered teams from roster students, pending ones included', async () => {
    await signedInAgent('student', ada, 'Ada Lawyer')

    const first = await prof.post(teamsUrl()).send({ emails: [ada, ben.toUpperCase()] })
    expect(first.status).toBe(201)
    expect(first.body.teams).toEqual([
      {
        id: expect.any(String),
        number: 1,
        members: [
          { email: ada, name: 'Ada Lawyer', joined: true },
          { email: ben, name: null, joined: false },
        ],
      },
    ])
    expect(first.body.unpaired.map((s: { email: string }) => s.email)).not.toContain(ada)

    const second = await prof.post(teamsUrl()).send({ emails: [cy] })
    expect(second.body.teams.map((t: { number: number }) => t.number)).toEqual([1, 2])
  })

  it('rejects students who are not on the roster or already paired', async () => {
    await prof.post(teamsUrl()).send({ emails: [ada, ben] })

    const stranger = await prof.post(teamsUrl()).send({ emails: [cy, 'who@example.com'] })
    expect(stranger.status).toBe(400)
    expect(stranger.body.error).toBe('who@example.com is not on the course roster.')

    const taken = await prof.post(teamsUrl()).send({ emails: [cy, ada] })
    expect(taken.status).toBe(409)
    expect(taken.body.error).toBe(`${ada} is already on a team for this case.`)
    // Nothing from the failed request was saved.
    expect((await prof.get(teamsUrl())).body.teams).toHaveLength(1)
  })

  it('needs one to three students', async () => {
    expect((await prof.post(teamsUrl()).send({ emails: [] })).body.error).toBe('Choose at least one student.')
    expect((await prof.post(teamsUrl()).send({ emails: [ada, ben, cy, dee] })).body.error).toBe(
      'A team can have at most 3 students.',
    )
    expect((await prof.post(teamsUrl()).send({ emails: ada })).status).toBe(400)
  })

  it('adds members up to three and removes them, deleting a team left empty', async () => {
    const { id } = (await prof.post(teamsUrl()).send({ emails: [ada] })).body.teams[0]

    expect((await prof.post(`${teamsUrl()}/${id}/members`).send({ email: ben })).status).toBe(200)
    const three = await prof.post(`${teamsUrl()}/${id}/members`).send({ email: cy })
    expect(emailsOf(three.body.teams[0])).toEqual([ada, ben, cy])
    const four = await prof.post(`${teamsUrl()}/${id}/members`).send({ email: dee })
    expect(four.status).toBe(409)
    expect(four.body.error).toBe('A team can have at most 3 students.')

    const removed = await prof.delete(`${teamsUrl()}/${id}/members/${encodeURIComponent(cy)}`)
    expect(emailsOf(removed.body.teams[0])).toEqual([ada, ben])
    expect(removed.body.unpaired.map((s: { email: string }) => s.email)).toContain(cy)

    await prof.delete(`${teamsUrl()}/${id}/members/${encodeURIComponent(ada)}`)
    const last = await prof.delete(`${teamsUrl()}/${id}/members/${encodeURIComponent(ben)}`)
    expect(last.body.teams).toEqual([])
  })

  it('deletes one team or all of them', async () => {
    await prof.post(teamsUrl()).send({ emails: [ada, ben] })
    const { teams } = (await prof.post(teamsUrl()).send({ emails: [cy, dee] })).body as TeamsBody

    const afterDelete = await prof.delete(`${teamsUrl()}/${teams[0].id}`)
    expect(afterDelete.body.teams.map(emailsOf)).toEqual([[cy, dee]])

    const cleared = await prof.delete(teamsUrl())
    expect(cleared.body.teams).toEqual([])
    expect(cleared.body.unpaired).toHaveLength(STUDENTS.length)
  })

  it('returns 404 for unknown teams', async () => {
    const missing = '00000000-0000-4000-8000-000000000000'
    expect((await prof.delete(`${teamsUrl()}/${missing}`)).body.error).toBe('Team not found.')
    expect((await prof.post(`${teamsUrl()}/nope/members`).send({ email: ada })).status).toBe(404)
  })

  it('keeps pairings separate per case', async () => {
    await prof.post(teamsUrl()).send({ emails: [ada, ben] })
    const secondCase = await newCase('State v. Hale')

    const res = await prof.post(teamsUrl(secondCase)).send({ emails: [ada, cy] })
    expect(res.status).toBe(201)
    expect(res.body.teams[0].number).toBe(1)
  })
})

describe('auto-pairing', () => {
  it('pairs everyone unpaired, with one team of three for an odd class', async () => {
    await prof.post(teamsUrl()).send({ emails: [ada, ben] })

    const res = await prof.post(`${teamsUrl()}/auto`)

    expect(res.status).toBe(200)
    expect(res.body.unpaired).toEqual([])
    // 5 left over: two new teams, one of them three.
    const sizes = (res.body as TeamsBody).teams.map((t) => t.members.length)
    expect(sizes[0]).toBe(2)
    expect(sizes.slice(1).sort()).toEqual([2, 3])
    expect(res.body.teams.map((t: { number: number }) => t.number)).toEqual([1, 2, 3])

    const again = await prof.post(`${teamsUrl()}/auto`)
    expect(again.status).toBe(409)
    expect(again.body.error).toBe('Everyone is already on a team.')
  })

  it("avoids repeating partners from the course's other cases", async () => {
    await prof.delete(`/api/courses/${course.id}/roster/${encodeURIComponent('fay@example.com')}`)
    await prof.delete(`/api/courses/${course.id}/roster/${encodeURIComponent('gus@example.com')}`)
    await prof.delete(`/api/courses/${course.id}/roster/${encodeURIComponent(eve)}`)
    await prof.post(teamsUrl()).send({ emails: [ada, ben] })
    await prof.post(teamsUrl()).send({ emails: [cy, dee] })
    const secondCase = await newCase('State v. Hale')

    for (let run = 0; run < 5; run++) {
      const { teams } = (await prof.post(`${teamsUrl(secondCase)}/auto`)).body as TeamsBody
      const pairs = teams.map(emailsOf).map(String)
      expect(pairs).not.toContain(String([ada, ben]))
      expect(pairs).not.toContain(String([cy, dee]))
      await prof.delete(teamsUrl(secondCase))
    }
  })
})

describe('roster changes and case status', () => {
  it('takes a student removed from the roster off their team', async () => {
    await prof.post(teamsUrl()).send({ emails: [ada, ben] })
    await prof.post(teamsUrl()).send({ emails: [cy] })

    await prof.delete(`/api/courses/${course.id}/roster/${encodeURIComponent(ada)}`)
    await prof.delete(`/api/courses/${course.id}/roster/${encodeURIComponent(cy)}`)

    const { teams } = (await prof.get(teamsUrl())).body as TeamsBody
    expect(teams.map(emailsOf)).toEqual([[ben]])
  })

  it('freezes the teams of a closed case', async () => {
    await prof.post(teamsUrl()).send({ emails: [ada, ben] })
    await prof
      .patch(`/api/courses/${course.id}/cases/${caseId}`)
      .send({ title: 'Rivera v. Thrill Park', summary: '', status: 'closed' })

    const res = await prof.post(`${teamsUrl()}/auto`)
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('This case is closed, so its teams and case worlds can no longer change.')
    expect((await prof.delete(teamsUrl())).status).toBe(409)
    expect((await prof.get(teamsUrl())).body.teams).toHaveLength(1)
  })

  it('deletes the teams with their case', async () => {
    await prof.post(teamsUrl()).send({ emails: [ada, ben] })

    await prof.delete(`/api/courses/${course.id}/cases/${caseId}`)

    const { rows } = await pool.query('SELECT (SELECT count(*) FROM teams)::int AS t, (SELECT count(*) FROM team_members)::int AS m')
    expect(rows[0]).toEqual({ t: 0, m: 0 })
  })
})

describe('access', () => {
  it("is closed to other instructors and to students, and can't cross courses", async () => {
    const other = (await signedInAgent('instructor', 'other@example.com')).agent
    const otherCourse = await createCourseAs(other)
    const { agent: student } = await signedInAgent('student', ada)

    expect((await other.get(teamsUrl())).status).toBe(404)
    expect((await other.get(`/api/courses/${otherCourse.id}/cases/${caseId}/teams`)).status).toBe(404)
    expect((await student.get(teamsUrl())).status).toBe(404)
    expect((await student.post(`${teamsUrl()}/auto`)).status).toBe(404)
  })
})

describe('pairStudents', () => {
  const inOrder = () => 0 // makes the shuffle deterministic

  it('pairs an even class', () => {
    const groups = pairStudents(['a', 'b', 'c', 'd'], new Set(), inOrder)
    expect(groups.flat().sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(groups.map((g) => g.length)).toEqual([2, 2])
  })

  it('adds the odd student out to a pair, or leaves a lone student solo', () => {
    expect(pairStudents(['a', 'b', 'c'], new Set(), inOrder).map((g) => g.length)).toEqual([3])
    expect(pairStudents(['a'], new Set(), inOrder)).toEqual([['a']])
    expect(pairStudents([], new Set(), inOrder)).toEqual([])
  })

  it('prefers new partners, and repeats only when there is no other choice', () => {
    const past = new Set([partnerKey('a', 'b'), partnerKey('a', 'c')])
    const groups = pairStudents(['a', 'b', 'c', 'd'], past, inOrder)
    expect(groups.every((g) => !(g.includes('a') && (g.includes('b') || g.includes('c'))))).toBe(true)

    expect(pairStudents(['a', 'b'], new Set([partnerKey('a', 'b')]), inOrder)).toHaveLength(1)
  })
})

describe("a student's cases", () => {
  it('lists non-draft cases with their team, or null before pairing', async () => {
    const { agent: student } = await signedInAgent('student', ada, 'Ada Lawyer')
    await signedInAgent('student', ben, 'Ben Counsel')
    const myCases = async () => (await student.get(`/api/courses/${course.id}/my-cases`)).body.cases
    const setStatus = (id: string, title: string, status: string) =>
      prof.patch(`/api/courses/${course.id}/cases/${id}`).send({ title, summary: '', status })

    // Drafts are hidden, even once paired.
    await prof.post(teamsUrl()).send({ emails: [ben, ada, cy] })
    expect(await myCases()).toEqual([])

    await setStatus(caseId, 'Rivera v. Thrill Park', 'active')
    const second = await newCase('State v. Hale')
    await setStatus(second, 'State v. Hale', 'active')

    expect(await myCases()).toEqual([
      {
        id: caseId,
        title: 'Rivera v. Thrill Park',
        summary: '',
        status: 'active',
        team: {
          number: 1,
          members: [
            { email: ada, name: 'Ada Lawyer', joined: true, you: true },
            { email: ben, name: 'Ben Counsel', joined: true, you: false },
            { email: cy, name: null, joined: false, you: false },
          ],
        },
        world: null,
      },
      { id: second, title: 'State v. Hale', summary: '', status: 'active', team: null, world: null },
    ])
  })

  it('is only for course members', async () => {
    const { agent: outsider } = await signedInAgent('student', 'outsider@example.com')
    expect((await outsider.get(`/api/courses/${course.id}/my-cases`)).status).toBe(404)
  })
})
