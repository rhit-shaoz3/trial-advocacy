import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../app.ts'
import { pool } from '../db/pool.ts'
import { withTransaction } from '../db/transaction.ts'

const NOT_FOUND_MESSAGE = "Sorry, we can't find a class associated with this code."

type Role = 'student' | 'instructor'

/** Signs up a user and returns an agent that stays logged in as them. */
async function signUp(name: string, role: Role, extra: Record<string, unknown> = {}) {
  const agent = request.agent(app)
  const email = `${name.toLowerCase()}@example.com`
  const res = await agent
    .post('/api/auth/signup')
    .send({ name, email, password: 'correct-horse', role, ...extra })
  return { agent, res, email, id: res.body.user?.id as string }
}

type Agent = Awaited<ReturnType<typeof signUp>>['agent']

async function createClass(agent: Agent, name = 'Trial Advocacy', studentEmails: string[] = []) {
  const res = await agent.post('/api/classes').send({ name, studentEmails })
  return { res, id: res.body.class?.id as string, code: res.body.class?.joinCode as string }
}

async function instructorClass(agent: Agent) {
  const res = await agent.get('/api/classes')
  return res.body.classes[0]
}

async function count(table: string) {
  const { rows } = await pool.query<{ count: string }>(`SELECT count(*) FROM ${table}`)
  return Number(rows[0].count)
}

beforeEach(async () => {
  await pool.query('TRUNCATE users, session, stored_files CASCADE')
})

afterAll(async () => {
  await pool.end()
})

describe('POST /api/classes', () => {
  it('creates the class with a name-based code and invites the emails', async () => {
    await signUp('Sam', 'student')
    const ivy = await signUp('Ivy', 'instructor')

    const { res } = await createClass(ivy.agent, 'Trial Advocacy', [
      'sam@example.com',
      ' NEW@Example.com ',
      'new@example.com',
    ])

    expect(res.status).toBe(201)
    expect(res.body).toEqual({
      class: { id: expect.any(String), name: 'Trial Advocacy', joinCode: expect.any(String) },
      invited: 2,
      withAccounts: 1,
    })
    expect(res.body.class.joinCode).toMatch(/^TA\d{3}$/)

    const cls = await instructorClass(ivy.agent)
    expect(cls.joinCode).toBe(res.body.class.joinCode)
    expect(cls.students).toEqual([])
    expect(cls.invitations).toHaveLength(2)
    expect(cls.invitations).toEqual(
      expect.arrayContaining([
        { id: expect.any(String), email: 'sam@example.com', name: 'Sam', hasAccount: true },
        { id: expect.any(String), email: 'new@example.com', name: null, hasAccount: false },
      ]),
    )
  })

  it('gives classes with the same name different codes', async () => {
    const ivy = await signUp('Ivy', 'instructor')
    const first = await createClass(ivy.agent, 'Evidence')
    const second = await createClass(ivy.agent, 'Evidence')

    expect(first.code).toMatch(/^EVID\d{3}$/)
    expect(second.code).toMatch(/^EVID\d{3}$/)
    expect(second.code).not.toBe(first.code)
  })

  it('only lets instructors create classes', async () => {
    const sam = await signUp('Sam', 'student')

    expect((await createClass(sam.agent)).res.status).toBe(403)
    expect((await request(app).post('/api/classes').send({ name: 'X' })).status).toBe(401)
    expect(await count('classes')).toBe(0)
  })

  it.each([
    ['missing name', { name: '  ' }, 'Class name is required.'],
    ['invalid email', { studentEmails: ['nope'] }, "These aren't valid email addresses: nope"],
    ['non-list emails', { studentEmails: 'a@b.co' }, 'studentEmails must be a list of email addresses.'],
  ])('rejects %s with 400 and creates nothing', async (_label, override, message) => {
    const ivy = await signUp('Ivy', 'instructor')
    const res = await ivy.agent.post('/api/classes').send({ name: 'Evidence', ...override })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe(message)
    expect(await count('classes')).toBe(0)
  })

  it('saves nothing if a step inside the transaction fails', async () => {
    const ivy = await signUp('Ivy', 'instructor')

    await expect(
      withTransaction(async (client) => {
        await client.query(
          `INSERT INTO classes (name, join_code, created_by) VALUES ('Doomed', 'DOOM123', $1)`,
          [ivy.id],
        )
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(await count('classes')).toBe(0)
  })
})

describe('invitations', () => {
  it('lets an invited student accept and join the class', async () => {
    const sam = await signUp('Sam', 'student')
    const ivy = await signUp('Ivy', 'instructor')
    await createClass(ivy.agent, 'Evidence', ['sam@example.com'])

    const inbox = await sam.agent.get('/api/classes/inbox')
    expect(inbox.body.invitations).toEqual([{ id: expect.any(String), className: 'Evidence' }])

    const accept = await sam.agent.post(
      `/api/classes/invitations/${inbox.body.invitations[0].id}/accept`,
    )
    expect(accept.status).toBe(204)

    const mine = await sam.agent.get('/api/classes')
    expect(mine.body.classes).toEqual([
      { id: expect.any(String), name: 'Evidence', instructors: ['Ivy'] },
    ])
    expect((await sam.agent.get('/api/classes/inbox')).body.invitations).toEqual([])

    const cls = await instructorClass(ivy.agent)
    expect(cls.students).toEqual([{ id: sam.id, name: 'Sam', email: 'sam@example.com' }])
    expect(cls.invitations).toEqual([])
  })

  it('removes a rejected invitation from the instructor list without enrolling', async () => {
    const sam = await signUp('Sam', 'student')
    const ivy = await signUp('Ivy', 'instructor')
    await createClass(ivy.agent, 'Evidence', ['sam@example.com'])

    const inbox = await sam.agent.get('/api/classes/inbox')
    const reject = await sam.agent.post(
      `/api/classes/invitations/${inbox.body.invitations[0].id}/reject`,
    )
    expect(reject.status).toBe(204)

    const cls = await instructorClass(ivy.agent)
    expect(cls.invitations).toEqual([])
    expect(cls.students).toEqual([])
    expect((await sam.agent.get('/api/classes')).body.classes).toEqual([])
  })

  it("doesn't let a student accept someone else's invitation", async () => {
    await signUp('Sam', 'student')
    const eve = await signUp('Eve', 'student')
    const ivy = await signUp('Ivy', 'instructor')
    await createClass(ivy.agent, 'Evidence', ['sam@example.com'])
    const [invitation] = (await instructorClass(ivy.agent)).invitations

    const res = await eve.agent.post(`/api/classes/invitations/${invitation.id}/accept`)

    expect(res.status).toBe(404)
    expect(await count('class_students')).toBe(0)
  })

  it('shows the invitation to someone who signs up later with the invited email', async () => {
    const ivy = await signUp('Ivy', 'instructor')
    await createClass(ivy.agent, 'Evidence', ['newbie@example.com'])
    expect((await instructorClass(ivy.agent)).invitations[0].hasAccount).toBe(false)

    const newbie = await signUp('Newbie', 'student')

    const inbox = await newbie.agent.get('/api/classes/inbox')
    expect(inbox.body.invitations).toEqual([{ id: expect.any(String), className: 'Evidence' }])
    expect((await instructorClass(ivy.agent)).invitations[0]).toMatchObject({
      hasAccount: true,
      name: 'Newbie',
    })
  })
})

describe('POST /api/classes/join', () => {
  it('rejects an unknown code', async () => {
    const sam = await signUp('Sam', 'student')
    const res = await sam.agent.post('/api/classes/join').send({ code: 'NOPE999' })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe(NOT_FOUND_MESSAGE)
  })

  it('asks the instructor for admission, ignoring case and dashes in the code', async () => {
    const sam = await signUp('Sam', 'student')
    const ivy = await signUp('Ivy', 'instructor')
    const { code } = await createClass(ivy.agent, 'Evidence')

    const typed = `${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase()
    const res = await sam.agent.post('/api/classes/join').send({ code: typed })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'requested', className: 'Evidence' })
    expect((await instructorClass(ivy.agent)).pendingRequests).toEqual([
      { id: sam.id, name: 'Sam', email: 'sam@example.com' },
    ])
    expect((await sam.agent.get('/api/classes/inbox')).body.pendingRequests).toEqual([
      { classId: expect.any(String), className: 'Evidence' },
    ])
    expect((await sam.agent.get('/api/classes')).body.classes).toEqual([])
  })

  it('enrolls an already-invited student straight away', async () => {
    const sam = await signUp('Sam', 'student')
    const ivy = await signUp('Ivy', 'instructor')
    const { code } = await createClass(ivy.agent, 'Evidence', ['sam@example.com'])

    const res = await sam.agent.post('/api/classes/join').send({ code })

    expect(res.body).toEqual({ status: 'enrolled', className: 'Evidence' })
    const cls = await instructorClass(ivy.agent)
    expect(cls.students).toHaveLength(1)
    expect(cls.invitations).toEqual([])
    expect(cls.pendingRequests).toEqual([])
  })

  it('says so when the student is already in the class', async () => {
    const sam = await signUp('Sam', 'student')
    const ivy = await signUp('Ivy', 'instructor')
    const { code } = await createClass(ivy.agent, 'Evidence', ['sam@example.com'])
    await sam.agent.post('/api/classes/join').send({ code })

    const res = await sam.agent.post('/api/classes/join').send({ code })

    expect(res.status).toBe(409)
    expect(res.body.error).toBe("You're already in Evidence.")
  })

  it('is only for students', async () => {
    const ivy = await signUp('Ivy', 'instructor')
    const { code } = await createClass(ivy.agent, 'Evidence')

    expect((await ivy.agent.post('/api/classes/join').send({ code })).status).toBe(403)
  })
})

describe('admitting and denying requests', () => {
  async function classWithRequests() {
    const ivy = await signUp('Ivy', 'instructor')
    const { id, code } = await createClass(ivy.agent, 'Evidence')
    const sam = await signUp('Sam', 'student')
    const ana = await signUp('Ana', 'student')
    await sam.agent.post('/api/classes/join').send({ code })
    await ana.agent.post('/api/classes/join').send({ code })
    return { ivy, sam, ana, classId: id, code }
  }

  it('admits several students at once', async () => {
    const { ivy, sam, ana, classId } = await classWithRequests()

    const res = await ivy.agent
      .post(`/api/classes/${classId}/requests`)
      .send({ userIds: [sam.id, ana.id], decision: 'admit' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ updated: 2 })
    const cls = await instructorClass(ivy.agent)
    expect(cls.pendingRequests).toEqual([])
    expect(cls.students.map((s: { name: string }) => s.name)).toEqual(['Ana', 'Sam'])
    expect((await sam.agent.get('/api/classes')).body.classes[0].name).toBe('Evidence')
  })

  it('hides denied students from the instructor and tells the student once', async () => {
    const { ivy, sam, ana, classId } = await classWithRequests()

    await ivy.agent
      .post(`/api/classes/${classId}/requests`)
      .send({ userIds: [sam.id], decision: 'deny' })

    const cls = await instructorClass(ivy.agent)
    expect(cls.pendingRequests).toEqual([{ id: ana.id, name: 'Ana', email: 'ana@example.com' }])
    expect(cls.students).toEqual([])

    const inbox = await sam.agent.get('/api/classes/inbox')
    expect(inbox.body.denials).toEqual([{ classId, className: 'Evidence' }])
    expect(inbox.body.pendingRequests).toEqual([])

    const dismiss = await sam.agent.post(`/api/classes/denials/${classId}/dismiss`)
    expect(dismiss.status).toBe(204)
    expect((await sam.agent.get('/api/classes/inbox')).body.denials).toEqual([])
    expect((await sam.agent.get('/api/classes')).body.classes).toEqual([])
  })

  it('lets a denied student ask again', async () => {
    const { ivy, sam, classId, code } = await classWithRequests()
    await ivy.agent
      .post(`/api/classes/${classId}/requests`)
      .send({ userIds: [sam.id], decision: 'deny' })

    const res = await sam.agent.post('/api/classes/join').send({ code })

    expect(res.body.status).toBe('requested')
    const pending = (await instructorClass(ivy.agent)).pendingRequests
    expect(pending.map((p: { id: string }) => p.id)).toContain(sam.id)
  })

  it("doesn't let another instructor decide", async () => {
    const { sam, classId } = await classWithRequests()
    const other = await signUp('Oscar', 'instructor')

    const res = await other.agent
      .post(`/api/classes/${classId}/requests`)
      .send({ userIds: [sam.id], decision: 'admit' })

    expect(res.status).toBe(404)
    expect(await count('class_students')).toBe(0)
  })

  it.each([
    ['no students', { userIds: [], decision: 'admit' }, 'Choose at least one student.'],
    ['bad decision', { decision: 'maybe' }, 'Decision must be admit or deny.'],
  ])('rejects %s with 400', async (_label, body, message) => {
    const { ivy, sam, classId } = await classWithRequests()

    const res = await ivy.agent
      .post(`/api/classes/${classId}/requests`)
      .send({ userIds: [sam.id], ...body })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe(message)
  })

  it('returns 404 for a malformed class id', async () => {
    const ivy = await signUp('Ivy', 'instructor')
    const res = await ivy.agent
      .post('/api/classes/not-a-uuid/requests')
      .send({ userIds: [], decision: 'admit' })

    expect(res.status).toBe(404)
  })
})

describe('signing up with a class code', () => {
  it('refuses an unknown code and creates no account', async () => {
    const { res } = await signUp('Sam', 'student', { classCode: 'NOPE999' })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe(NOT_FOUND_MESSAGE)
    expect(await count('users')).toBe(0)
  })

  it('creates the account and asks to join the class', async () => {
    const ivy = await signUp('Ivy', 'instructor')
    const { code } = await createClass(ivy.agent, 'Evidence')

    const sam = await signUp('Sam', 'student', { classCode: code })

    expect(sam.res.status).toBe(201)
    expect((await instructorClass(ivy.agent)).pendingRequests).toEqual([
      { id: sam.id, name: 'Sam', email: 'sam@example.com' },
    ])
  })

  it('ignores a class code sent by an instructor', async () => {
    const { res } = await signUp('Ivy', 'instructor', { classCode: 'NOPE999' })

    expect(res.status).toBe(201)
  })
})
