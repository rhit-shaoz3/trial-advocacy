import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../app.ts'
import { pool } from '../db/pool.ts'
import { createCourseAs, joinCourse, resetDatabase } from '../test/helpers.ts'

type Role = 'student' | 'instructor'

async function signUp(name: string, role: Role) {
  const agent = request.agent(app)
  const res = await agent
    .post('/api/auth/signup')
    .send({ name, email: `${name.toLowerCase()}@example.com`, password: 'correct-horse', role })
  return { agent, id: res.body.user.id as string, name }
}

type User = Awaited<ReturnType<typeof signUp>>

/** An instructor with a course the named students have joined, and one case in it. */
async function setup(studentNames = ['Ana', 'Bo', 'Cy', 'Di']) {
  const ivy = await signUp('Ivy', 'instructor')
  const course = await createCourseAs(ivy.agent)
  const students: User[] = []
  for (const name of studentNames) {
    const s = await signUp(name, 'student')
    await joinCourse(s.agent, ivy.agent, course)
    students.push(s)
  }
  const created = await ivy.agent
    .post(`/api/courses/${course.id}/cases`)
    .send({ name: 'Smith v. Jones' })
  return { ivy, students, courseId: course.id, caseId: created.body.case.id as string }
}

function sendFile(agent: User['agent'], caseId: string, name: string, data: Buffer, side = 'both') {
  return agent
    .post(`/api/cases/${caseId}/documents?side=${side}`)
    .set('X-Filename', encodeURIComponent(name))
    .set('Content-Type', 'application/octet-stream')
    .send(data)
}

async function upload(agent: User['agent'], caseId: string, name: string, side = 'both') {
  const res = await sendFile(agent, caseId, name, Buffer.from(`contents of ${name}`), side)
  return res.body.document
}

async function count(table: string) {
  const { rows } = await pool.query<{ count: string }>(`SELECT count(*) FROM ${table}`)
  return Number(rows[0].count)
}

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await pool.end()
})

describe('creating and viewing cases', () => {
  it('creates a case in a course the instructor teaches', async () => {
    const { ivy, caseId, courseId } = await setup([])

    const res = await ivy.agent.get(`/api/cases/${caseId}`)

    expect(res.status).toBe(200)
    expect(res.body.case).toMatchObject({
      id: caseId,
      name: 'Smith v. Jones',
      courseId,
      courseName: 'LAW 540: Trial Advocacy',
      published: { documents: false, characters: false, teams: false },
      documents: [],
      characters: [],
      teams: [],
      matchups: [],
    })
    expect((await ivy.agent.get(`/api/courses/${courseId}/cases`)).body.cases).toHaveLength(1)
  })

  it('refuses a course the instructor does not teach', async () => {
    const { courseId } = await setup([])
    const other = await signUp('Oscar', 'instructor')

    const res = await other.agent.post(`/api/courses/${courseId}/cases`).send({ name: 'X' })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Course not found.')
  })

  it('hides the case from other instructors and stops students creating cases', async () => {
    const { caseId, courseId, students } = await setup(['Ana'])
    const other = await signUp('Oscar', 'instructor')

    expect((await other.agent.get(`/api/cases/${caseId}`)).status).toBe(404)
    expect((await other.agent.patch(`/api/cases/${caseId}/publish`).send({ teams: true })).status).toBe(404)
    expect(
      (await students[0].agent.post(`/api/courses/${courseId}/cases`).send({ name: 'X' })).status,
    ).toBe(403)
    expect((await request(app).get(`/api/cases/${caseId}`)).status).toBe(401)
  })
})

describe('documents', () => {
  it('uploads and downloads the same bytes', async () => {
    const { ivy, caseId } = await setup([])

    const doc = await upload(ivy.agent, caseId, 'Exhibit Ñ.pdf', 'plaintiff')
    expect(doc).toMatchObject({ filename: 'Exhibit Ñ.pdf', side: 'plaintiff', sizeBytes: 26 })

    const file = await ivy.agent
      .get(`/api/cases/${caseId}/documents/${doc.id}/file`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => done(null, Buffer.concat(chunks)))
      })
    expect(file.status).toBe(200)
    expect(file.headers['content-type']).toBe('application/pdf')
    expect(file.headers['content-disposition']).toMatch(/^attachment/)
    expect((file.body as Buffer).toString()).toBe('contents of Exhibit Ñ.pdf')
  })

  it('rejects file types that are not allowed, like fact patterns do', async () => {
    const { ivy, caseId } = await setup([])
    const res = await sendFile(ivy.agent, caseId, 'evil.html', Buffer.from('<script>'))

    expect(res.status).toBe(415)
    expect(res.body.error).toBe('Upload a PDF, Word document, or text file.')
    expect(await count('case_documents')).toBe(0)
  })

  it('rejects files over the size limit', async () => {
    const { ivy, caseId } = await setup([])
    const res = await sendFile(ivy.agent, caseId, 'big.pdf', Buffer.alloc(10 * 1024 * 1024 + 1))

    expect(res.status).toBe(413)
    expect(res.body.error).toBe('That file is too large. The limit is 10 MB.')
  })

  it('only lets the course’s instructor upload', async () => {
    const { caseId, students } = await setup(['Ana'])
    const res = await sendFile(students[0].agent, caseId, 'x.pdf', Buffer.from('x'))

    expect(res.status).toBe(403)
  })

  it('changes a document’s side and deletes it', async () => {
    const { ivy, caseId } = await setup([])
    const doc = await upload(ivy.agent, caseId, 'memo.txt')

    const patched = await ivy.agent
      .patch(`/api/cases/${caseId}/documents/${doc.id}`)
      .send({ side: 'defendant' })
    expect(patched.body.document.side).toBe('defendant')

    expect((await ivy.agent.delete(`/api/cases/${caseId}/documents/${doc.id}`)).status).toBe(204)
    expect(await count('case_documents')).toBe(0)
  })
})

describe('characters', () => {
  it('creates characters and links them to documents', async () => {
    const { ivy, caseId } = await setup([])
    const doc = await upload(ivy.agent, caseId, 'police-report.pdf')
    const created = await ivy.agent
      .post(`/api/cases/${caseId}/characters`)
      .send({ name: 'Officer Diaz', title: 'Police Officer', role: 'witness', side: 'plaintiff' })
    const charId = created.body.character.id

    expect(
      (await ivy.agent.put(`/api/cases/${caseId}/characters/${charId}/documents/${doc.id}`)).status,
    ).toBe(204)
    let detail = await ivy.agent.get(`/api/cases/${caseId}`)
    expect(detail.body.case.characters).toEqual([
      {
        id: charId,
        name: 'Officer Diaz',
        title: 'Police Officer',
        role: 'witness',
        side: 'plaintiff',
        documentIds: [doc.id],
      },
    ])

    await ivy.agent.delete(`/api/cases/${caseId}/characters/${charId}/documents/${doc.id}`)
    detail = await ivy.agent.get(`/api/cases/${caseId}`)
    expect(detail.body.case.characters[0].documentIds).toEqual([])
  })

  it('will not link a document from another case', async () => {
    const { ivy, caseId, courseId } = await setup([])
    const otherCase = await ivy.agent.post(`/api/courses/${courseId}/cases`).send({ name: 'Other' })
    const doc = await upload(ivy.agent, otherCase.body.case.id, 'x.pdf')
    const created = await ivy.agent
      .post(`/api/cases/${caseId}/characters`)
      .send({ name: 'W', title: 'Bystander', role: 'witness' })

    const res = await ivy.agent.put(
      `/api/cases/${caseId}/characters/${created.body.character.id}/documents/${doc.id}`,
    )
    expect(res.status).toBe(404)
  })

  it.each([
    ['a missing title', { name: 'W', role: 'witness' }, 'Title is required.'],
    ['an unknown role', { name: 'W', title: 'Clerk', role: 'judge' }, 'Role must be witness or investigator.'],
    ['a missing role', { name: 'W', title: 'Clerk' }, 'Role must be witness or investigator.'],
  ])('rejects %s', async (_label, body, message) => {
    const { ivy, caseId } = await setup([])
    const res = await ivy.agent.post(`/api/cases/${caseId}/characters`).send(body)

    expect(res.status).toBe(400)
    expect(res.body.error).toBe(message)
  })

  it('edits a character’s name, title, role and side', async () => {
    const { ivy, caseId } = await setup([])
    const created = await ivy.agent
      .post(`/api/cases/${caseId}/characters`)
      .send({ name: 'Det. Ruiz', title: 'Detective', role: 'witness' })

    const res = await ivy.agent
      .patch(`/api/cases/${caseId}/characters/${created.body.character.id}`)
      .send({ name: 'Det. Ana Ruiz', title: 'Lead Detective', role: 'investigator', side: 'defendant' })

    expect(res.body.character).toEqual({
      id: created.body.character.id,
      name: 'Det. Ana Ruiz',
      title: 'Lead Detective',
      role: 'investigator',
      side: 'defendant',
    })
  })
})

describe('teams', () => {
  it('saves teams with their members and sides', async () => {
    const { ivy, caseId, students } = await setup()
    const [ana, bo, cy, di] = students

    const res = await ivy.agent.put(`/api/cases/${caseId}/teams`).send({
      teams: [
        { name: 'Team 1', side: 'plaintiff', studentIds: [ana.id, bo.id] },
        { name: 'Team 2', side: 'defendant', studentIds: [cy.id, di.id] },
      ],
    })

    expect(res.status).toBe(200)
    const teams = res.body.case.teams
    expect(teams.map((t: { name: string; side: string }) => [t.name, t.side])).toEqual([
      ['Team 1', 'plaintiff'],
      ['Team 2', 'defendant'],
    ])
    expect(teams[0].members.map((m: { name: string }) => m.name)).toEqual(['Ana', 'Bo'])
  })

  it.each([
    [
      'an empty team',
      (ids: string[]) => [
        { name: 'A', side: 'plaintiff', studentIds: ids },
        { name: 'B', side: 'defendant', studentIds: [] },
      ],
      'B needs at least one student.',
    ],
    [
      'an unplaced student',
      (ids: string[]) => [{ name: 'A', side: 'plaintiff', studentIds: ids.slice(1) }],
      'Every student must be on a team. Not placed: Ana',
    ],
    [
      'a student on two teams',
      (ids: string[]) => [
        { name: 'A', side: 'plaintiff', studentIds: ids },
        { name: 'B', side: 'defendant', studentIds: [ids[0]] },
      ],
      'Ana is on both A and B.',
    ],
    [
      'a duplicate team name',
      (ids: string[]) => [
        { name: 'A', side: 'plaintiff', studentIds: ids.slice(0, 2) },
        { name: 'a', side: 'defendant', studentIds: ids.slice(2) },
      ],
      'There are two teams named "a".',
    ],
    [
      'a bad side',
      (ids: string[]) => [{ name: 'A', side: 'jury', studentIds: ids }],
      'Each team must be plaintiff or defendant.',
    ],
  ])('rejects %s', async (_label, build, message) => {
    const { ivy, caseId, students } = await setup()

    const res = await ivy.agent
      .put(`/api/cases/${caseId}/teams`)
      .send({ teams: build(students.map((s) => s.id)) })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe(message)
    expect(await count('teams')).toBe(0)
  })

  it('rejects a student who is not in the class', async () => {
    const { ivy, caseId, students } = await setup(['Ana'])
    const outsider = await signUp('Zed', 'student')

    const res = await ivy.agent.put(`/api/cases/${caseId}/teams`).send({
      teams: [{ name: 'A', side: 'plaintiff', studentIds: [students[0].id, outsider.id] }],
    })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe("A has a student who isn't in this course.")
  })

  it('keeps matchups when a team is renamed, and drops them when its side changes', async () => {
    const { ivy, caseId, students } = await setup()
    const [ana, bo, cy, di] = students
    const first = await ivy.agent.put(`/api/cases/${caseId}/teams`).send({
      teams: [
        { name: 'P', side: 'plaintiff', studentIds: [ana.id, bo.id] },
        { name: 'D', side: 'defendant', studentIds: [cy.id, di.id] },
      ],
    })
    const [p, d] = first.body.case.teams
    await ivy.agent
      .put(`/api/cases/${caseId}/matchups`)
      .send({ matchups: [{ plaintiffTeamId: p.id, defendantTeamId: d.id }] })

    const renamed = await ivy.agent.put(`/api/cases/${caseId}/teams`).send({
      teams: [
        { id: p.id, name: 'Plaintiffs', side: 'plaintiff', studentIds: [ana.id, bo.id] },
        { id: d.id, name: 'D', side: 'defendant', studentIds: [cy.id, di.id] },
      ],
    })
    expect(renamed.body.case.teams[0].name).toBe('Plaintiffs')
    expect(renamed.body.case.matchups).toHaveLength(1)

    const flipped = await ivy.agent.put(`/api/cases/${caseId}/teams`).send({
      teams: [
        { id: p.id, name: 'Plaintiffs', side: 'defendant', studentIds: [ana.id, bo.id] },
        { id: d.id, name: 'D', side: 'defendant', studentIds: [cy.id, di.id] },
      ],
    })
    expect(flipped.body.case.matchups).toEqual([])
  })

  it('deletes teams that are left out, with their matchups', async () => {
    const { ivy, caseId, students } = await setup()
    const ids = students.map((s) => s.id)
    const first = await ivy.agent.put(`/api/cases/${caseId}/teams`).send({
      teams: [
        { name: 'P', side: 'plaintiff', studentIds: ids.slice(0, 2) },
        { name: 'D', side: 'defendant', studentIds: ids.slice(2) },
      ],
    })
    const [p, d] = first.body.case.teams
    await ivy.agent
      .put(`/api/cases/${caseId}/matchups`)
      .send({ matchups: [{ plaintiffTeamId: p.id, defendantTeamId: d.id }] })

    const res = await ivy.agent.put(`/api/cases/${caseId}/teams`).send({
      teams: [{ id: p.id, name: 'P', side: 'plaintiff', studentIds: ids }],
    })

    expect(res.body.case.teams).toHaveLength(1)
    expect(res.body.case.matchups).toEqual([])
  })
})

describe('matchups', () => {
  async function withTeams() {
    const ctx = await setup(['Ana', 'Bo', 'Cy'])
    const ids = ctx.students.map((s) => s.id)
    const res = await ctx.ivy.agent.put(`/api/cases/${ctx.caseId}/teams`).send({
      teams: [
        { name: 'P1', side: 'plaintiff', studentIds: [ids[0]] },
        { name: 'P2', side: 'plaintiff', studentIds: [ids[1]] },
        { name: 'D1', side: 'defendant', studentIds: [ids[2]] },
      ],
    })
    const [p1, p2, d1] = res.body.case.teams
    return { ...ctx, p1, p2, d1 }
  }

  it('saves matchups, including a team doubled up against two others', async () => {
    const { ivy, caseId, p1, p2, d1 } = await withTeams()

    const res = await ivy.agent.put(`/api/cases/${caseId}/matchups`).send({
      matchups: [
        { plaintiffTeamId: p1.id, defendantTeamId: d1.id },
        { plaintiffTeamId: p2.id, defendantTeamId: d1.id },
      ],
    })

    expect(res.status).toBe(200)
    expect(res.body.case.matchups).toEqual([
      { id: expect.any(String), plaintiffTeamId: p1.id, defendantTeamId: d1.id },
      { id: expect.any(String), plaintiffTeamId: p2.id, defendantTeamId: d1.id },
    ])
  })

  it('rejects two teams on the same side', async () => {
    const { ivy, caseId, p1, p2 } = await withTeams()
    const res = await ivy.agent
      .put(`/api/cases/${caseId}/matchups`)
      .send({ matchups: [{ plaintiffTeamId: p1.id, defendantTeamId: p2.id }] })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe(
      'Each matchup needs one plaintiff team and one defendant team from this case.',
    )
  })

  it('rejects the same pair twice', async () => {
    const { ivy, caseId, p1, d1 } = await withTeams()
    const pair = { plaintiffTeamId: p1.id, defendantTeamId: d1.id }
    const res = await ivy.agent.put(`/api/cases/${caseId}/matchups`).send({ matchups: [pair, pair] })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('The same two teams are matched up twice.')
  })

  it('rejects a team from another case', async () => {
    const { ivy, courseId, p1, d1 } = await withTeams()
    const other = await ivy.agent.post(`/api/courses/${courseId}/cases`).send({ name: 'Other' })

    const res = await ivy.agent
      .put(`/api/cases/${other.body.case.id}/matchups`)
      .send({ matchups: [{ plaintiffTeamId: p1.id, defendantTeamId: d1.id }] })

    expect(res.status).toBe(400)
  })
})

describe('what students see', () => {
  async function fullCase() {
    const ctx = await setup(['Ana', 'Bo', 'Cy'])
    const { ivy, caseId, students } = ctx
    const [ana, bo, cy] = students
    const teams = await ivy.agent.put(`/api/cases/${caseId}/teams`).send({
      teams: [
        { name: 'P1', side: 'plaintiff', studentIds: [ana.id, bo.id] },
        { name: 'D1', side: 'defendant', studentIds: [cy.id] },
      ],
    })
    const [p1, d1] = teams.body.case.teams
    await ivy.agent
      .put(`/api/cases/${caseId}/matchups`)
      .send({ matchups: [{ plaintiffTeamId: p1.id, defendantTeamId: d1.id }] })
    const shared = await upload(ivy.agent, caseId, 'complaint.pdf', 'both')
    const plaintiffOnly = await upload(ivy.agent, caseId, 'p-notes.pdf', 'plaintiff')
    const defendantOnly = await upload(ivy.agent, caseId, 'd-notes.pdf', 'defendant')
    await ivy.agent
      .post(`/api/cases/${caseId}/characters`)
      .send({ name: 'Neutral', title: 'Bystander', role: 'witness', side: 'both' })
    await ivy.agent
      .post(`/api/cases/${caseId}/characters`)
      .send({ name: 'Doc', title: 'Expert', role: 'investigator', side: 'defendant' })
    const publish = (body: object) => ivy.agent.patch(`/api/cases/${caseId}/publish`).send(body)
    return { ...ctx, ana, cy, shared, plaintiffOnly, defendantOnly, publish }
  }

  it('shows nothing until something is published', async () => {
    const { ana, caseId, courseId } = await fullCase()

    expect((await ana.agent.get(`/api/courses/${courseId}/cases`)).body.cases).toEqual([])
    expect((await ana.agent.get(`/api/cases/${caseId}`)).status).toBe(404)
  })

  it('shows only shared documents before teams are published', async () => {
    const { ana, caseId, courseId, publish } = await fullCase()
    await publish({ documents: true })

    expect((await ana.agent.get(`/api/courses/${courseId}/cases`)).body.cases).toEqual([
      {
        id: caseId,
        name: 'Smith v. Jones',
        courseId,
        courseName: 'LAW 540: Trial Advocacy',
        published: { documents: true, characters: false, teams: false },
      },
    ])
    const view = (await ana.agent.get(`/api/cases/${caseId}`)).body.case
    expect(view.team).toBeNull()
    expect(view.documents.map((d: { filename: string }) => d.filename)).toEqual(['complaint.pdf'])
    expect(view.characters).toBeNull()
  })

  it('adds the student’s side once teams are published', async () => {
    const { ana, cy, caseId, publish } = await fullCase()
    await publish({ documents: true, characters: true, teams: true })

    const anaView = (await ana.agent.get(`/api/cases/${caseId}`)).body.case
    expect(anaView.team).toMatchObject({
      name: 'P1',
      side: 'plaintiff',
      teammates: [{ name: 'Bo', email: 'bo@example.com' }],
      opponents: [{ name: 'D1', side: 'defendant', members: [{ name: 'Cy' }] }],
    })
    expect(anaView.documents.map((d: { filename: string }) => d.filename)).toEqual([
      'complaint.pdf',
      'p-notes.pdf',
    ])
    expect(anaView.characters).toEqual([
      { id: expect.any(String), name: 'Neutral', title: 'Bystander', role: 'witness' },
    ])

    const cyView = (await cy.agent.get(`/api/cases/${caseId}`)).body.case
    expect(cyView.documents.map((d: { filename: string }) => d.filename)).toEqual([
      'complaint.pdf',
      'd-notes.pdf',
    ])
    expect(cyView.characters.map((c: { name: string }) => c.name)).toEqual(['Neutral', 'Doc'])
  })

  it('lets a student download only documents they can see', async () => {
    const { ana, caseId, publish, shared, defendantOnly } = await fullCase()
    await publish({ documents: true, teams: true })

    expect((await ana.agent.get(`/api/cases/${caseId}/documents/${shared.id}/file`)).status).toBe(200)
    expect(
      (await ana.agent.get(`/api/cases/${caseId}/documents/${defendantOnly.id}/file`)).status,
    ).toBe(404)
  })

  it('hides a section again when it is unpublished', async () => {
    const { ana, caseId, publish } = await fullCase()
    await publish({ documents: true, teams: true })
    await publish({ teams: false })

    const view = (await ana.agent.get(`/api/cases/${caseId}`)).body.case
    expect(view.published).toEqual({ documents: true, characters: false, teams: false })
    expect(view.team).toBeNull()
    expect(view.documents.map((d: { filename: string }) => d.filename)).toEqual(['complaint.pdf'])
  })

  it('does not show the case to students outside the course', async () => {
    const { caseId, courseId, publish } = await fullCase()
    await publish({ documents: true })
    const outsider = await signUp('Zed', 'student')

    expect((await outsider.agent.get(`/api/cases/${caseId}`)).status).toBe(404)
    expect((await outsider.agent.get(`/api/courses/${courseId}/cases`)).status).toBe(404)
  })

  it('lists cases across courses: all for the instructor, released ones for students', async () => {
    const { ivy, ana, caseId, courseId, publish } = await fullCase()
    const other = await createCourseAs(ivy.agent, { code: 'LAW 520', title: 'Evidence', season: 'Spring', year: 2026 })
    await ivy.agent.post(`/api/courses/${other.id}/cases`).send({ name: 'State v. Hale' })

    const mine = (await ivy.agent.get('/api/cases')).body.cases
    expect(mine.map((c: { name: string }) => c.name).sort()).toEqual(['Smith v. Jones', 'State v. Hale'])

    expect((await ana.agent.get('/api/cases')).body.cases).toEqual([])
    await publish({ documents: true })
    expect((await ana.agent.get('/api/cases')).body.cases).toEqual([
      expect.objectContaining({ id: caseId, courseId, courseName: 'LAW 540: Trial Advocacy' }),
    ])
  })

  it('fills the course dashboard with case cards for each role', async () => {
    const { ivy, ana, courseId, publish } = await fullCase()

    const before = await ana.agent.get(`/api/courses/${courseId}/home`)
    expect(before.body.cases).toEqual([])

    await publish({ teams: true })
    const instructorHome = await ivy.agent.get(`/api/courses/${courseId}/home`)
    expect(instructorHome.body.cases).toEqual([
      expect.objectContaining({
        title: 'Smith v. Jones',
        caseType: '3 files · 2 characters',
        summary: 'Published to students: teams.',
        status: 'active',
        progress: null,
      }),
    ])

    const studentHome = await ana.agent.get(`/api/courses/${courseId}/home`)
    expect(studentHome.body.cases).toEqual([
      expect.objectContaining({
        title: 'Smith v. Jones',
        caseType: 'Plaintiff · P1',
        summary: 'Against D1.',
        participants: [{ name: 'Ana' }, { name: 'Bo' }],
      }),
    ])
  })
})
