import type request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/pool.ts'
import { createCourseAs, resetDatabase, sampleFacts, signedInAgent, uploadCaseFile } from '../test/helpers.ts'

let prof: request.Agent
let course: { id: string; entryCode: string }
let caseId: string

const email = (n: number) => `s${n}@example.com`
const caseUrl = () => `/api/courses/${course.id}/cases/${caseId}`
const myCaseUrl = () => `/api/courses/${course.id}/my-cases/${caseId}`

const upload = (filename: string, options?: { audience?: string; description?: string }, data?: Buffer) =>
  uploadCaseFile(prof, caseUrl(), filename, options, data)

/** Uploads the file every team starts from. */
async function uploadInitial(filename: string) {
  const id = (await upload(filename)).body.material.id as string
  await prof.put(`${caseUrl()}/materials/initial`).send({ materialId: id })
  return id
}

/** s1+s2 (plaintiff) v s3+s4 (defense) in World A. Returns the team and matchup ids. */
async function pairAndMatch() {
  await prof.post(`${caseUrl()}/teams`).send({ emails: [email(1), email(2)] })
  const { teams } = (await prof.post(`${caseUrl()}/teams`).send({ emails: [email(3), email(4)] })).body
  const { matchups } = (
    await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: teams[0].id, defenseTeamId: teams[1].id })
  ).body
  return { plaintiffTeamId: teams[0].id as string, defenseTeamId: teams[1].id as string, matchupId: matchups[0].id as string }
}

async function launch() {
  const res = await prof.post(`${caseUrl()}/launch`)
  if (res.status !== 200) throw new Error(`Launch failed: ${JSON.stringify(res.body)}`)
}

beforeEach(async () => {
  await resetDatabase()
  prof = (await signedInAgent('instructor', 'prof@example.com', 'Prof. Ruiz')).agent
  course = await createCourseAs(prof)
  await prof.post(`/api/courses/${course.id}/roster`).send({ emails: [1, 2, 3, 4].map(email) })
  caseId = (await prof.post(`/api/courses/${course.id}/cases`).send({ importantFacts: sampleFacts, summary: 'A test case.', title: 'Rivera v. Thrill Park' })).body.case.id
})

afterAll(async () => {
  await pool.end()
})

describe('case materials', () => {
  it('uploads, lists, edits, downloads, and deletes files', async () => {
    const res = await upload('Fact pattern.pdf', { description: 'Read first.' })
    expect(res.status).toBe(201)
    expect(res.body.material).toEqual({
      id: expect.any(String),
      // Teams ask for case files, so they start with the instructor.
      audience: 'instructor',
      filename: 'Fact pattern.pdf',
      description: 'Read first.',
      contentType: 'application/pdf',
      sizeBytes: 13,
      uploadedAt: expect.any(String),
      textStatus: 'pending',
      textError: null,
      initial: false,
    })
    const photo = (await upload('scene.JPG', { audience: 'plaintiff' })).body.material
    expect(photo).toMatchObject({ audience: 'plaintiff', contentType: 'image/jpeg' })

    const list = (await prof.get(`${caseUrl()}/materials`)).body.materials
    expect(list.map((m: { filename: string }) => m.filename)).toEqual(['Fact pattern.pdf', 'scene.JPG'])

    const edited = await prof
      .patch(`${caseUrl()}/materials/${photo.id}`)
      .send({ audience: 'defense', description: 'Ride photo' })
    expect(edited.body.material).toMatchObject({ audience: 'defense', description: 'Ride photo' })

    // Downloads redirect to a short-lived link from storage.
    const file = await prof.get(`${caseUrl()}/materials/${res.body.material.id}/file`)
    expect(file.status).toBe(302)
    const download = await prof.get(file.headers.location)
    expect(download.headers['content-disposition']).toBe(
      `attachment; filename="Fact pattern.pdf"; filename*=UTF-8''Fact%20pattern.pdf`,
    )
    expect(download.headers['content-type']).toBe('application/pdf')
    expect(download.body.toString()).toBe('%PDF-1.7 test')
    expect(download.headers['x-content-type-options']).toBe('nosniff')

    expect((await prof.delete(`${caseUrl()}/materials/${photo.id}`)).status).toBe(204)
    expect((await prof.get(`${caseUrl()}/materials/${photo.id}/file`)).status).toBe(404)
  })

  it('validates uploads', async () => {
    expect((await upload('page.html')).status).toBe(415)
    expect((await upload('interview.mp3')).body.material.contentType).toBe('audio/mpeg')
    expect((await upload('walkthrough.MP4')).body.material.contentType).toBe('video/mp4')
    expect((await upload('x.pdf', { audience: 'judge' })).status).toBe(400)
    expect((await upload('x.pdf', {}, Buffer.alloc(0))).body.error).toBe('The file is empty.')
    const big = await prof.post(`${caseUrl()}/materials/uploads`).send({ filename: 'big.pdf', size: 100 * 1024 * 1024 + 1 })
    expect(big.status).toBe(413)
    expect(big.body.error).toBe('That file is too large. The limit is 100 MB.')
  })
})

describe('the initial file', () => {
  it('is one file per case, always shared with everyone, listed first', async () => {
    const memo = (await upload('Memo.pdf', { audience: 'plaintiff' })).body.material.id
    const complaint = (await upload('Complaint.pdf')).body.material.id
    const choose = (materialId: unknown) => prof.put(`${caseUrl()}/materials/initial`).send({ materialId })

    const first = await choose(complaint)
    expect(first.status).toBe(200)
    expect(first.body.materials.map((m: { filename: string; initial: boolean; audience: string }) => [m.filename, m.initial, m.audience])).toEqual([
      ['Complaint.pdf', true, 'all'],
      ['Memo.pdf', false, 'plaintiff'],
    ])

    // It can't be narrowed to one side or to instructors while it's the initial file.
    const narrowed = await prof.patch(`${caseUrl()}/materials/${complaint}`).send({ audience: 'instructor' })
    expect(narrowed.status).toBe(400)
    expect(narrowed.body.error).toMatch(/Choose another initial file first/)

    // Choosing another moves it; the old one keeps its audience.
    const moved = (await choose(memo)).body.materials
    expect(moved.filter((m: { initial: boolean }) => m.initial).map((m: { filename: string }) => m.filename)).toEqual(['Memo.pdf'])
    expect(moved.find((m: { filename: string }) => m.filename === 'Memo.pdf').audience).toBe('all')

    expect((await choose(null)).body.materials.some((m: { initial: boolean }) => m.initial)).toBe(false)
    expect((await choose(caseId)).status).toBe(404)
    expect((await choose('nope')).status).toBe(404)
  })
})

describe('witnesses, tasks, and the note', () => {
  it('adds, edits, and deletes witnesses', async () => {
    const res = await prof
      .post(`${caseUrl()}/witnesses`)
      .send({ name: ' Elena Torres ', role: 'Ride operator', description: 'Was at the controls.' })
    expect(res.status).toBe(201)
    expect(res.body.witness).toEqual({
      id: expect.any(String),
      name: 'Elena Torres',
      role: 'Ride operator',
      description: 'Was at the controls.',
      audience: 'all',
      alignedSide: null,
      personaNotes: '',
      depositionMaterialId: null,
      knownMaterialIds: [],
      defendingCounsel: '',
      avatarPreset: null,
      avatarUrl: null,
    })
    const { id } = res.body.witness
    const edited = await prof.put(`${caseUrl()}/witnesses/${id}`).send({ name: 'Elena Torres', audience: 'defense' })
    expect(edited.body.witness).toMatchObject({ role: '', audience: 'defense' })
    expect((await prof.post(`${caseUrl()}/witnesses`).send({ name: '' })).body.error).toBe('Witness name is required.')
    expect((await prof.delete(`${caseUrl()}/witnesses/${id}`)).status).toBe(204)
    expect((await prof.get(`${caseUrl()}/witnesses`)).body.witnesses).toEqual([])
  })

  it('adds tasks, soonest due first, and validates due dates', async () => {
    await prof.post(`${caseUrl()}/tasks`).send({ title: 'No date' })
    await prof.post(`${caseUrl()}/tasks`).send({ title: 'Later', dueAt: '2026-11-20T23:59:00.000Z' })
    const soon = await prof
      .post(`${caseUrl()}/tasks`)
      .send({ title: 'Soon', description: 'Outline it.', dueAt: '2026-11-01T23:59:00.000Z', audience: 'plaintiff' })
    expect(soon.body.task).toEqual({
      id: expect.any(String),
      title: 'Soon',
      description: 'Outline it.',
      dueAt: '2026-11-01T23:59:00.000Z',
      audience: 'plaintiff',
    })
    const titles = (await prof.get(`${caseUrl()}/tasks`)).body.tasks.map((t: { title: string }) => t.title)
    expect(titles).toEqual(['Soon', 'Later', 'No date'])

    expect((await prof.post(`${caseUrl()}/tasks`).send({ title: 'X', dueAt: 'someday' })).body.error).toBe(
      'Enter a valid due date.',
    )
    const cleared = await prof.put(`${caseUrl()}/tasks/${soon.body.task.id}`).send({ title: 'Soon', dueAt: null })
    expect(cleared.body.task.dueAt).toBeNull()
  })

  it('saves the instructor note on the case', async () => {
    const res = await prof.put(`${caseUrl()}/note`).send({ note: '  Mind the timeline.  ' })
    expect(res.body.case.instructorNote).toBe('Mind the timeline.')
  })
})

describe('launching the case worlds', () => {
  it('lists what is missing, then launches once everything is ready', async () => {
    const before = (await prof.get(`${caseUrl()}/launch`)).body.checks
    expect(before).toEqual([
      { key: 'importantFacts', ok: true, message: 'Important facts: 1 for the plaintiff, 1 for the defense.' },
      { key: 'paired', ok: false, message: 'Pair students into teams.' },
      { key: 'matched', ok: false, message: 'Match teams into case worlds.' },
      { key: 'caseFile', ok: false, message: 'Upload the case file.' },
    ])
    const early = await prof.post(`${caseUrl()}/launch`)
    expect(early.status).toBe(409)
    expect(early.body.error).toBe(
      'Not ready to launch: Pair students into teams. Match teams into case worlds. Upload the case file.',
    )

    await pairAndMatch()
    const factPattern = (await upload('Fact pattern.pdf', { description: 'Fact pattern' })).body.material.id
    const noInitial = (await prof.get(`${caseUrl()}/launch`)).body.checks[3]
    expect(noInitial).toEqual({ key: 'caseFile', ok: false, message: 'Choose the initial file every team starts from.' })
    await prof.put(`${caseUrl()}/materials/initial`).send({ materialId: factPattern })
    const after = (await prof.get(`${caseUrl()}/launch`)).body.checks
    expect(after.map((c: { message: string }) => c.message)).toEqual([
      'Important facts: 1 for the plaintiff, 1 for the defense.',
      'All 4 students are on a team.',
      '1 case world is set up.',
      'Teams start from Fact pattern; 1 case file is uploaded.',
    ])
    expect(after.every((c: { ok: boolean }) => c.ok)).toBe(true)

    const res = await prof.post(`${caseUrl()}/launch`)
    expect(res.status).toBe(200)
    expect(res.body.case.status).toBe('active')
    expect((await prof.post(`${caseUrl()}/launch`)).body.error).toBe('This case has already been launched.')
  })

  it('reports students and teams still left out', async () => {
    await prof.post(`${caseUrl()}/teams`).send({ emails: [email(1), email(2)] })
    const checks = (await prof.get(`${caseUrl()}/launch`)).body.checks
    expect(checks[1].message).toBe('2 students are not on a team yet.')
    expect(checks[2].message).toBe('1 team is waiting for an opponent.')
  })
})

describe("a student's case dashboard", () => {
  let plaintiff: request.Agent
  let defense: request.Agent

  beforeEach(async () => {
    plaintiff = (await signedInAgent('student', email(1), 'Ada Lawyer')).agent
    defense = (await signedInAgent('student', email(3), 'Cy Counsel')).agent
    await pairAndMatch()
    await uploadInitial('Fact pattern.pdf')
    // Kept with the instructor until a team asks for it.
    await upload('Accident log.pdf')
    await upload('Plaintiff memo.pdf', { audience: 'plaintiff' })
    await upload('Defense memo.pdf', { audience: 'defense' })
    await prof.post(`${caseUrl()}/witnesses`).send({ name: 'Elena Torres', role: 'Ride operator' })
    await prof.post(`${caseUrl()}/witnesses`).send({ name: 'Dr. Lin', audience: 'defense' })
    await prof.post(`${caseUrl()}/tasks`).send({ title: 'Read the fact pattern' })
    await prof.post(`${caseUrl()}/tasks`).send({ title: 'Interview the rider', audience: 'plaintiff' })
    await prof.put(`${caseUrl()}/note`).send({ note: 'Mind the timeline.' })
  })

  it('is hidden while the case is a draft', async () => {
    expect((await plaintiff.get(myCaseUrl())).status).toBe(404)
  })

  it("shows the student's team, world, and only their side's material", async () => {
    await launch()

    const { workspace } = (await plaintiff.get(myCaseUrl())).body
    expect(workspace.case).toEqual({
      id: caseId,
      title: 'Rivera v. Thrill Park',
      summary: 'A test case.',
      status: 'active',
      phase: 'subpoena',
      instructorNote: 'Mind the timeline.',
    })
    expect(workspace.side).toBe('plaintiff')
    expect(workspace.preview).toBe(false)
    expect(workspace.team.members.map((m: { email: string }) => m.email)).toEqual([email(1), email(2)])
    expect(workspace.world).toMatchObject({ number: 1, side: 'plaintiff', opponents: { number: 2 } })
    expect(workspace.materials.map((m: { filename: string }) => m.filename)).toEqual([
      'Fact pattern.pdf',
      'Plaintiff memo.pdf',
    ])
    expect(workspace.witnesses.map((w: { name: string }) => w.name)).toEqual(['Elena Torres'])
    expect(workspace.tasks.map((t: { title: string }) => t.title)).toEqual(['Read the fact pattern', 'Interview the rider'])

    const theirs = (await defense.get(myCaseUrl())).body.workspace
    expect(theirs.materials.map((m: { filename: string }) => m.filename)).toEqual(['Fact pattern.pdf', 'Defense memo.pdf'])
    expect(theirs.witnesses).toHaveLength(2)
  })

  it("downloads only the files the student's side can see", async () => {
    await launch()
    const materials = (await prof.get(`${caseUrl()}/materials`)).body.materials as { id: string; filename: string }[]
    const byName = (name: string) => materials.find((m) => m.filename === name)!.id

    const own = await plaintiff.get(`${myCaseUrl()}/materials/${byName('Plaintiff memo.pdf')}/file`)
    expect(own.status).toBe(302)
    expect((await plaintiff.get(own.headers.location)).headers['content-disposition']).toContain('attachment')
    expect((await plaintiff.get(`${myCaseUrl()}/materials/${byName('Defense memo.pdf')}/file`)).status).toBe(404)
  })

  it('lets either teammate mark a task done for the whole team, and undo it', async () => {
    await launch()
    const teammate = (await signedInAgent('student', email(2), 'Ben Partner')).agent
    const task = (await plaintiff.get(myCaseUrl())).body.workspace.tasks[0]

    const res = await plaintiff.put(`${myCaseUrl()}/tasks/${task.id}`).send({ done: true })
    expect(res.status).toBe(200)
    expect(res.body.workspace.tasks[0]).toMatchObject({ completedBy: 'Ada Lawyer', completedAt: expect.any(String) })
    expect((await teammate.get(myCaseUrl())).body.workspace.tasks[0].completedBy).toBe('Ada Lawyer')
    // The other team's copy of the task is untouched.
    expect((await defense.get(myCaseUrl())).body.workspace.tasks[0].completedAt).toBeNull()

    const undone = await teammate.put(`${myCaseUrl()}/tasks/${task.id}`).send({ done: false })
    expect(undone.body.workspace.tasks[0].completedAt).toBeNull()
  })

  it("shows the team's progress and next task on the course dashboard", async () => {
    await launch()
    const home = async () => (await plaintiff.get(`/api/courses/${course.id}/home`)).body.cases[0]
    expect(await home()).toMatchObject({ progress: 0, nextTask: { title: 'Read the fact pattern', dueAt: null } })

    const task = (await plaintiff.get(myCaseUrl())).body.workspace.tasks[0]
    await plaintiff.put(`${myCaseUrl()}/tasks/${task.id}`).send({ done: true })

    expect(await home()).toMatchObject({ progress: 50, nextTask: { title: 'Interview the rider' } })
  })

  it('lists open task deadlines and counts completed tasks on the course dashboard', async () => {
    await prof.post(`${caseUrl()}/tasks`).send({ title: 'File the brief', dueAt: '2026-11-02T23:59:00.000Z' })
    await prof.post(`${caseUrl()}/tasks`).send({ title: 'Defense memo', dueAt: '2026-11-01T23:59:00.000Z', audience: 'defense' })
    await launch()
    const homeOf = async (agent: request.Agent) => (await agent.get(`/api/courses/${course.id}/home`)).body

    const before = await homeOf(plaintiff)
    expect(before.upcoming).toEqual([
      {
        id: expect.any(String),
        kind: 'deadline',
        title: 'File the brief',
        caseTitle: 'Rivera v. Thrill Park',
        at: '2026-11-02T23:59:00.000Z',
      },
    ])
    expect(before.stats).toEqual({ tasksCompleted: 0, tasksCompletedThisWeek: 0 })
    expect((await homeOf(defense)).upcoming.map((u: { title: string }) => u.title)).toEqual([
      'Defense memo',
      'File the brief',
    ])

    await plaintiff.put(`${myCaseUrl()}/tasks/${before.upcoming[0].id}`).send({ done: true })
    const after = await homeOf(plaintiff)
    expect(after.upcoming).toEqual([])
    expect(after.stats).toEqual({ tasksCompleted: 1, tasksCompletedThisWeek: 1 })
  })

  it("won't complete another side's task, or any task in a closed case", async () => {
    await launch()
    const plaintiffOnly = (await prof.get(`${caseUrl()}/tasks`)).body.tasks.find(
      (t: { audience: string }) => t.audience === 'plaintiff',
    )
    expect((await defense.put(`${myCaseUrl()}/tasks/${plaintiffOnly.id}`).send({ done: true })).status).toBe(404)
    expect((await plaintiff.put(`${myCaseUrl()}/tasks/${plaintiffOnly.id}`).send({ done: 'yes' })).status).toBe(400)

    await prof.patch(caseUrl()).send({ importantFacts: sampleFacts, title: 'Rivera v. Thrill Park', summary: '', status: 'closed' })
    const closed = await plaintiff.put(`${myCaseUrl()}/tasks/${plaintiffOnly.id}`).send({ done: true })
    expect(closed.status).toBe(409)
  })

  it('shows unpaired students only the shared material', async () => {
    await launch()
    await prof.post(`/api/courses/${course.id}/roster`).send({ emails: [email(5)] })
    const late = (await signedInAgent('student', email(5))).agent

    const { workspace } = (await late.get(myCaseUrl())).body
    expect(workspace.team).toBeNull()
    expect(workspace.side).toBeNull()
    expect(workspace.materials.map((m: { filename: string }) => m.filename)).toEqual(['Fact pattern.pdf'])
    const res = await late.put(`${myCaseUrl()}/tasks/${workspace.tasks[0].id}`).send({ done: true })
    expect(res.body.error).toBe('You need to be on a team to complete tasks.')
  })
})

describe("the instructor's student-view preview", () => {
  it("shows a side's view, or one world's team with its progress", async () => {
    const { matchupId } = await pairAndMatch()
    await upload('Defense memo.pdf', { audience: 'defense' })

    const sideOnly = (await prof.get(`${caseUrl()}/preview?side=plaintiff`)).body.workspace
    expect(sideOnly).toMatchObject({ preview: true, side: 'plaintiff', team: null, world: null, materials: [] })

    const world = (await prof.get(`${caseUrl()}/preview?side=defense&matchup=${matchupId}`)).body.workspace
    expect(world.team.number).toBe(2)
    expect(world.world).toMatchObject({ number: 1, side: 'defense', opponents: { number: 1 } })
    expect(world.materials.map((m: { filename: string }) => m.filename)).toEqual(['Defense memo.pdf'])

    expect((await prof.get(`${caseUrl()}/preview`)).body.error).toBe('Choose a side to preview.')
    expect((await prof.get(`${caseUrl()}/preview?side=defense&matchup=${caseId}`)).status).toBe(404)
  })
})

describe('case phases', () => {
  const setPhase = (phase: unknown, agent = prof) => agent.put(`${caseUrl()}/phase`).send({ phase })

  it('starts in subpoena, and the instructor moves it forward or back', async () => {
    expect((await prof.get(caseUrl())).body.case.phase).toBe('subpoena')

    const moved = await setPhase('deposition')
    expect(moved.status).toBe(200)
    expect(moved.body.case.phase).toBe('deposition')
    expect((await setPhase('investigate')).body.case.phase).toBe('investigate')

    // Editing the case keeps its phase.
    await prof.patch(caseUrl()).send({ title: 'Rivera v. Thrill Park', summary: '', status: 'draft', importantFacts: sampleFacts })
    expect((await prof.get(caseUrl())).body.case.phase).toBe('investigate')
  })

  it('validates the phase, and freezes it once the case is closed', async () => {
    expect((await setPhase('trial')).body.error).toBe('Choose a valid phase.')
    expect((await setPhase(undefined)).status).toBe(400)

    await prof.patch(caseUrl()).send({ title: 'Rivera v. Thrill Park', summary: '', status: 'closed', importantFacts: sampleFacts })
    const closed = await setPhase('investigate')
    expect(closed.status).toBe(409)
    expect(closed.body.error).toBe('This case is closed, so its phase can no longer change.')
  })

  it('is only for the instructor', async () => {
    const other = (await signedInAgent('instructor', 'other@example.com')).agent
    const student = (await signedInAgent('student', email(1))).agent
    expect((await setPhase('deposition', other)).status).toBe(404)
    expect((await setPhase('deposition', student)).status).toBe(404)
    expect((await prof.get(caseUrl())).body.case.phase).toBe('subpoena')
  })

  describe('what each side sees', () => {
    let plaintiff: request.Agent
    let defense: request.Agent
    let unpaired: request.Agent
    const view = async (agent: request.Agent) => {
      const { workspace } = (await agent.get(myCaseUrl())).body
      return {
        phase: workspace.case.phase,
        investigator: workspace.investigatorAvailable,
        witnesses: workspace.witnesses.map((w: { name: string }) => w.name),
      }
    }

    beforeEach(async () => {
      plaintiff = (await signedInAgent('student', email(1))).agent
      defense = (await signedInAgent('student', email(3))).agent
      await pairAndMatch()
      await uploadInitial('Fact pattern.pdf')
      await prof.post(`${caseUrl()}/witnesses`).send({ name: 'Rider', alignedSide: 'plaintiff' })
      await prof.post(`${caseUrl()}/witnesses`).send({ name: 'Operator', alignedSide: 'defense' })
      await prof.post(`${caseUrl()}/witnesses`).send({ name: 'Bystander' })
      await prof.post(`${caseUrl()}/witnesses`).send({ name: 'Engineer', audience: 'defense' })
      await launch()
      // Joins after launch, so isn't on a team yet.
      await prof.post(`/api/courses/${course.id}/roster`).send({ emails: [email(5)] })
      unpaired = (await signedInAgent('student', email(5))).agent
    })

    it("hides each side's witnesses from the other, and the investigator, in subpoena", async () => {
      expect(await view(plaintiff)).toEqual({ phase: 'subpoena', investigator: false, witnesses: ['Rider', 'Bystander'] })
      expect(await view(defense)).toEqual({
        phase: 'subpoena',
        investigator: false,
        witnesses: ['Operator', 'Bystander', 'Engineer'],
      })
      expect((await view(unpaired)).witnesses).toEqual(['Bystander'])
    })

    it('opens the investigator in investigate, still hiding the other side', async () => {
      await setPhase('investigate')
      expect(await view(plaintiff)).toEqual({ phase: 'investigate', investigator: true, witnesses: ['Rider', 'Bystander'] })
      expect((await view(defense)).witnesses).toEqual(['Operator', 'Bystander', 'Engineer'])
    })

    it('reveals every witness to both sides in deposition', async () => {
      await setPhase('deposition')
      const all = ['Rider', 'Operator', 'Bystander', 'Engineer']
      expect(await view(plaintiff)).toEqual({ phase: 'deposition', investigator: true, witnesses: all })
      expect((await view(defense)).witnesses).toEqual(all)
      const operator = (await plaintiff.get(myCaseUrl())).body.workspace.witnesses[1]
      expect(operator).toMatchObject({ name: 'Operator', side: 'defense' })
      expect(operator).not.toHaveProperty('personaNotes')
    })

    it("follows the phase in the instructor's preview", async () => {
      const preview = async () =>
        (await prof.get(`${caseUrl()}/preview?side=plaintiff`)).body.workspace.witnesses.map((w: { name: string }) => w.name)
      expect(await preview()).toEqual(['Rider', 'Bystander'])
      await setPhase('deposition')
      expect(await preview()).toEqual(['Rider', 'Operator', 'Bystander', 'Engineer'])
    })
  })

  it('keeps the phase when the case launches', async () => {
    await signedInAgent('student', email(1))
    await pairAndMatch()
    await uploadInitial('Fact pattern.pdf')
    await setPhase('investigate')
    await launch()
    expect((await prof.get(caseUrl())).body.case).toMatchObject({ status: 'active', phase: 'investigate' })
  })
})

describe('access', () => {
  it("keeps case content to the course's instructor, and the dashboard to its students", async () => {
    const other = (await signedInAgent('instructor', 'other@example.com')).agent
    const student = (await signedInAgent('student', email(1))).agent

    expect((await other.get(`${caseUrl()}/materials`)).status).toBe(404)
    expect((await student.get(`${caseUrl()}/tasks`)).status).toBe(404)
    expect((await student.get(`${caseUrl()}/preview?side=plaintiff`)).status).toBe(404)
    expect((await other.get(myCaseUrl())).status).toBe(404)
  })
})
