import type request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ai } from '../ai/ai.ts'
import { transcriptionsSettled } from '../courses/materialText.ts'
import { pool } from '../db/pool.ts'
import { createCourseAs, resetDatabase, sampleFacts, signedInAgent, uploadCaseFile } from '../test/helpers.ts'
import { buildSystemPrompt, type DepositionSettings, type WitnessProfile } from './prompt.ts'
import { formatCaseDate, partyNames } from './profile.ts'

// The AI witness as the instructor sets it up in the app: files are
// transcribed on upload, the witness is pointed at its deposition, and teams
// interview it. Claude is faked (server/test/fakeAi.ts): a file's text is its bytes.

let prof: request.Agent
let ada: request.Agent
let bo: request.Agent
let cy: request.Agent
let course: { id: string; entryCode: string }
let caseId: string
const files: Record<string, string> = {}

const email = (n: number) => `s${n}@example.com`
const caseUrl = () => `/api/courses/${course.id}/cases/${caseId}`
const myCaseUrl = () => `/api/courses/${course.id}/my-cases/${caseId}`

/** Every request the fake witness got, and its canned reply. */
let asked: { profile: WitnessProfile; settings: DepositionSettings; transcript: { question: string; reply: string }[]; question: string }[]
let nextReply = 'I was at the booth.'

async function upload(filename: string, text: string, audience = 'all') {
  const res = await uploadCaseFile(prof, caseUrl(), filename, { audience, description: filename.replace(/\.\w+$/, '') }, Buffer.from(text))
  if (res.status !== 201) throw new Error(`Upload failed: ${JSON.stringify(res.body)}`)
  files[filename] = res.body.material.id
  return res.body.material
}

beforeEach(async () => {
  await resetDatabase()
  prof = (await signedInAgent('instructor', 'prof@example.com', 'Prof. Ruiz')).agent
  course = await createCourseAs(prof)
  await prof.post(`/api/courses/${course.id}/roster`).send({ emails: [1, 2, 3, 4].map(email) })
  ada = (await signedInAgent('student', email(1), 'Ada Lawyer')).agent
  bo = (await signedInAgent('student', email(2), 'Bo Partner')).agent
  cy = (await signedInAgent('student', email(3), 'Cy Counsel')).agent
  caseId = (await prof.post(`/api/courses/${course.id}/cases`).send({ importantFacts: sampleFacts, title: 'Rivera v. Thrill Park', summary: 'A rider fell.' })).body.case.id

  const { teams } = (await prof.post(`${caseUrl()}/teams`).send({ emails: [email(1), email(2)] })).body
  const defense = (await prof.post(`${caseUrl()}/teams`).send({ emails: [email(3), email(4)] })).body.teams[1]
  await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: teams[0].id, defenseTeamId: defense.id })

  await upload('Operator manual.txt', 'Stay in the booth.')
  await upload('Accident log.pdf', '6/10/19 | Atlas | Rider fell')
  await upload('Torres deposition.pdf', 'Q: Where were you? A: At the booth.', 'instructor')
  await upload('Lin deposition.pdf', 'Q: Did you see it? A: No.', 'instructor')
  await upload('Complaint.txt', 'Rivera alleges the operator left the booth.')
  await prof.put(`${caseUrl()}/materials/initial`).send({ materialId: files['Complaint.txt'] })
  await transcriptionsSettled()

  asked = []
  nextReply = 'I was at the booth.'
  ai.askWitness = async (options) => {
    asked.push(structuredClone(options))
    return { reply: nextReply, objection: null, answer: nextReply, model: 'fake-model', usage: {} as never }
  }
})

afterAll(async () => {
  await pool.end()
})

async function createWitness(fields: Record<string, unknown> = {}) {
  const res = await prof.post(`${caseUrl()}/witnesses`).send({
    name: 'Elena Torres',
    role: 'Ride operator',
    description: 'Was at the controls.',
    alignedSide: 'defense',
    depositionMaterialId: files['Torres deposition.pdf'],
    knownMaterialIds: [files['Operator manual.txt']],
    personaNotes: 'Proud of her work.',
    defendingCounsel: 'Ms. Park',
    ...fields,
  })
  if (res.status !== 201) throw new Error(`Create witness failed: ${JSON.stringify(res.body)}`)
  return res.body.witness as { id: string }
}

const launch = async () => expect((await prof.post(`${caseUrl()}/launch`)).status).toBe(200)

describe('case file transcription', () => {
  it('transcribes each upload in the background and serves the text to the instructor', async () => {
    const materials = (await prof.get(`${caseUrl()}/materials`)).body.materials as { id: string; textStatus: string }[]
    expect(materials.every((m) => m.textStatus === 'ready')).toBe(true)

    const text = await prof.get(`${caseUrl()}/materials/${files['Accident log.pdf']}/text`)
    expect(text.status).toBe(200)
    expect(text.headers['content-type']).toMatch(/^text\/plain/)
    expect(text.text).toBe('6/10/19 | Atlas | Rider fell')
  })

  it('records a failed transcription and retries it', async () => {
    ai.transcribe = async () => {
      throw new Error('boom')
    }
    const failed = await upload('Photos.pdf', 'pictures')
    await transcriptionsSettled()
    const listed = (await prof.get(`${caseUrl()}/materials`)).body.materials.find((m: { id: string }) => m.id === failed.id)
    expect(listed).toMatchObject({ textStatus: 'failed', textError: 'Could not read this file. Try again later.' })
    expect((await prof.get(`${caseUrl()}/materials/${failed.id}/text`)).status).toBe(404)

    ai.transcribe = async () => '[Photo: the booth]'
    const retried = await prof.post(`${caseUrl()}/materials/${failed.id}/text`)
    // Retry answers at once and reads the file in the background.
    expect(retried.body.material).toMatchObject({ textStatus: 'pending', textError: null })
    await transcriptionsSettled()
    const done = (await prof.get(`${caseUrl()}/materials`)).body.materials.find((m: { id: string }) => m.id === failed.id)
    expect(done).toMatchObject({ textStatus: 'ready', textError: null })
  })

  it('never reads a file again once it has text, or while it is being read', async () => {
    let reads = 0
    ai.transcribe = async (file) => {
      reads += 1
      return file.contentType.startsWith('audio/') ? null : file.data.toString('utf8')
    }
    const read = await upload('Log.txt', 'The ride stopped at 3:02.')
    await transcriptionsSettled()
    const again = await prof.post(`${caseUrl()}/materials/${read.id}/text`)
    expect(again.status).toBe(409)
    expect(again.body.error).toBe('This file has already been read. Upload a new version to read it again.')

    const call = await uploadCaseFile(prof, caseUrl(), 'Call.mp3')
    await transcriptionsSettled()
    const nothing = await prof.post(`${caseUrl()}/materials/${call.body.material.id}/text`)
    expect(nothing.status).toBe(409)
    expect(nothing.body.error).toBe("There's nothing to read in this file.")

    // Still pending: asking again doesn't start a second reading.
    let finish: (text: string) => void = () => {}
    ai.transcribe = () => {
      reads += 1
      return new Promise((resolve) => (finish = resolve))
    }
    const slow = await upload('Slow.pdf', 'pages')
    const pending = await prof.post(`${caseUrl()}/materials/${slow.id}/text`)
    expect(pending.body.material).toMatchObject({ textStatus: 'pending' })
    finish('[Pages]')
    await transcriptionsSettled()
    // One reading per file (Log.txt, Call.mp3, Slow.pdf), and none of them twice.
    expect(reads).toBe(3)
  })

  it('marks files with nothing to read', async () => {
    await uploadCaseFile(prof, caseUrl(), 'Call.mp3')
    await transcriptionsSettled()
    const call = (await prof.get(`${caseUrl()}/materials`)).body.materials.find((m: { filename: string }) => m.filename === 'Call.mp3')
    expect(call.textStatus).toBe('none')
  })
})

describe('instructor-only files', () => {
  it('are never shown to or downloadable by students', async () => {
    await launch()
    const { workspace } = (await ada.get(myCaseUrl())).body
    expect(workspace.materials.map((m: { filename: string }) => m.filename)).toEqual([
      'Complaint.txt',
      'Operator manual.txt',
      'Accident log.pdf',
    ])
    expect((await ada.get(`${myCaseUrl()}/materials/${files['Torres deposition.pdf']}/file`)).status).toBe(404)
  })

  it("can't make a witness's deposition the initial file", async () => {
    await createWitness()
    const res = await prof.put(`${caseUrl()}/materials/initial`).send({ materialId: files['Torres deposition.pdf'] })
    expect(res.status).toBe(400)
    const materials = (await prof.get(`${caseUrl()}/materials`)).body.materials as { filename: string; initial: boolean; audience: string }[]
    expect(materials.find((m) => m.filename === 'Torres deposition.pdf')).toMatchObject({ initial: false, audience: 'instructor' })
    // The initial file it would have replaced is untouched.
    expect(materials.find((m) => m.initial)?.filename).toBe('Complaint.txt')
  })

  it('can be moved to and from instructors only', async () => {
    const res = await prof.patch(`${caseUrl()}/materials/${files['Accident log.pdf']}`).send({ audience: 'instructor' })
    expect(res.body.material.audience).toBe('instructor')
  })
})

describe('setting up an AI witness', () => {
  it('saves its side, deposition, known files, persona, and lawyer', async () => {
    const witness = await createWitness({ knownMaterialIds: [files['Operator manual.txt'], files['Torres deposition.pdf']] })
    expect(witness).toMatchObject({
      alignedSide: 'defense',
      depositionMaterialId: files['Torres deposition.pdf'],
      // The deposition isn't also listed as a file she has seen.
      knownMaterialIds: [files['Operator manual.txt']],
      personaNotes: 'Proud of her work.',
      defendingCounsel: 'Ms. Park',
    })
  })

  it('rejects files from another case and bad sides', async () => {
    const otherCase = (await prof.post(`/api/courses/${course.id}/cases`).send({ importantFacts: sampleFacts, summary: 'A test case.', title: 'Other' })).body.case.id
    const res = await prof
      .post(`/api/courses/${course.id}/cases/${otherCase}/witnesses`)
      .send({ name: 'X', depositionMaterialId: files['Torres deposition.pdf'] })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('That deposition file is not in this case.')
    expect((await prof.post(`${caseUrl()}/witnesses`).send({ name: 'X', alignedSide: 'judge' })).status).toBe(400)
    expect((await prof.post(`${caseUrl()}/witnesses`).send({ name: 'X', knownMaterialIds: ['nope'] })).status).toBe(400)
  })

  it('saves the case date and disputed issues', async () => {
    const res = await prof.put(`${caseUrl()}/witness-settings`).send({ inWorldDate: '2024-10-01', disputedIssues: 'Where she stood.' })
    expect(res.body.case).toMatchObject({ inWorldDate: '2024-10-01', disputedIssues: 'Where she stood.' })
    expect((await prof.put(`${caseUrl()}/witness-settings`).send({ inWorldDate: 'soon' })).status).toBe(400)
    const cleared = await prof.put(`${caseUrl()}/witness-settings`).send({ inWorldDate: '' })
    expect(cleared.body.case.inWorldDate).toBeNull()
  })

  it("shows students the witness but none of its AI setup", async () => {
    await createWitness()
    await prof.post(`${caseUrl()}/witnesses`).send({ name: 'Bystander' })
    await launch()
    // Elena testifies for the defense, so (before the deposition phase) only the defense team sees her.
    const { witnesses } = (await cy.get(myCaseUrl())).body.workspace
    expect(witnesses).toEqual([
      { id: expect.any(String), name: 'Elena Torres', role: 'Ride operator', description: 'Was at the controls.', audience: 'all', side: 'defense', canInterview: true, disclosed: false, avatarUrl: null },
      { id: expect.any(String), name: 'Bystander', role: '', description: '', audience: 'all', side: null, canInterview: false, disclosed: false, avatarUrl: null },
    ])
  })
})

describe('interviewing an AI witness', () => {
  let witnessId: string
  const interview = () => `${myCaseUrl()}/witnesses/${witnessId}/interview`

  beforeEach(async () => {
    witnessId = (await createWitness()).id
    await prof.put(`${caseUrl()}/witness-settings`).send({ inWorldDate: '2024-10-01', disputedIssues: 'Where she stood.' })
    await launch()
    // Elena testifies for the defense; the plaintiff team (Ada's) can depose her only in this phase.
    await prof.put(`${caseUrl()}/phase`).send({ phase: 'deposition' })
  })

  it('counts depositions of the other side\'s witnesses, for the case dashboard', async () => {
    const overview = async () => (await prof.get(`${caseUrl()}/depositions/overview`)).body.overview
    expect(await overview()).toMatchObject({ teamsDeposed: 0, depositions: 0, questions: 0 })
    // Ada's team is the plaintiff, and Elena testifies for the defense.
    await ada.post(`${interview()}/questions`).send({ question: 'Where were you?' })
    await ada.post(`${interview()}/questions`).send({ question: 'And then?' })
    expect(await overview()).toMatchObject({ teamsDeposed: 1, depositions: 1, questions: 2, objections: 0 })
  })

  it("shows the witness a file the team has, by name, and refuses one it doesn't", async () => {
    const res = await ada
      .post(`${interview()}/questions`)
      .send({ question: 'Do you recognize this document?', exhibitIds: [files['Accident log.pdf']] })
    expect(res.status).toBe(200)
    // The witness already has every case file; the question names the one handed over.
    expect(asked[0].question).toBe('[Exhibit: "Accident log"] Do you recognize this document?')
    expect(res.body.interview.turns[0].question).toBe('[Exhibit: "Accident log"] Do you recognize this document?')
    // The files the team can show are listed, and an instructors-only one isn't among them.
    const titles = res.body.interview.exhibits.map((e: { title: string }) => e.title)
    expect(titles).toContain('Accident log')
    expect(titles).not.toContain('Torres deposition')

    const hidden = await ada.post(`${interview()}/questions`).send({ question: 'And this?', exhibitIds: [files['Torres deposition.pdf']] })
    expect(hidden.status).toBe(400)
    expect(hidden.body.error).toBe('You can only show the witness files your team has.')
  })

  it('builds the witness from the case file', async () => {
    // Evidence kept with the instructor is still a record; another witness's deposition is their account.
    await prof.patch(`${caseUrl()}/materials/${files['Accident log.pdf']}`).send({ audience: 'instructor', description: 'Accident log' })
    await createWitness({ name: 'Dr. Lin', alignedSide: 'plaintiff', depositionMaterialId: files['Lin deposition.pdf'], knownMaterialIds: [] })
    await ada.post(`${interview()}/questions`).send({ question: 'Where were you?' })
    const [{ profile, settings }] = asked
    expect(profile).toMatchObject({
      name: 'Elena Torres',
      title: 'Ride operator',
      roleInCase: 'Was at the controls.',
      alignedPartyRole: 'defendant',
      alignedPartyName: 'Thrill Park',
      plaintiffName: 'Rivera',
      caseSummary: 'A rider fell.',
      // A saved case date is ignored: the case runs on the real date.
      inWorldDate: formatCaseDate(new Date().toISOString().slice(0, 10)),
      keyDisputedIssues: 'Where she stood.',
      personaNotes: 'Proud of her work.',
      importantFacts: sampleFacts,
    })
    expect(profile.documents.map((d) => [d.title, d.type, d.witnessKnows])).toEqual([
      ['Torres deposition', 'own_statement', true],
      ['Operator manual', 'record', true],
      ['Accident log', 'record', false],
      ['Lin deposition', 'other_witness', false],
      // The initial file: pleadings, so allegations rather than facts.
      ['Complaint', 'background', false],
    ])
    expect(profile.documents[0].content).toBe('Q: Where were you? A: At the booth.')
    // The plaintiff team is the other side, so her lawyer defends.
    expect(settings).toEqual({ examiningPartyRole: 'plaintiff', examiningPartyName: 'Rivera', defendingCounselName: 'Ms. Park' })
    expect(buildSystemPrompt(profile, settings)).toContain('Ms. Park')
  })

  it("is shared by a team's partners and kept from the other team", async () => {
    const first = await ada.post(`${interview()}/questions`).send({ question: 'Where were you?' })
    expect(first.status).toBe(200)
    expect(first.body.interview).toMatchObject({
      side: 'plaintiff',
      witness: { id: witnessId, name: 'Elena Torres', role: 'Ride operator' },
      canAsk: true,
      turns: [{ position: 0, question: 'Where were you?', objection: null, answer: 'I was at the booth.', askedBy: 'Ada Lawyer' }],
    })

    nextReply = 'Ms. Park: Objection, form.\n\nA: Yes.'
    ai.askWitness = async (options) => {
      asked.push(structuredClone(options))
      return { reply: nextReply, objection: { speaker: 'Ms. Park', text: 'Objection, form.' }, answer: 'Yes.', model: 'fake-model', usage: {} as never }
    }
    const second = await bo.post(`${interview()}/questions`).send({ question: 'And you saw it all?' })
    expect(second.body.interview.turns[1]).toMatchObject({ objection: 'Ms. Park: Objection, form.', answer: 'Yes.', askedBy: 'Bo Partner' })
    // The partner's question was asked with the transcript so far.
    expect(asked[1].transcript).toEqual([{ question: 'Where were you?', reply: 'I was at the booth.' }])

    const theirs = (await cy.get(interview())).body.interview
    expect(theirs).toMatchObject({ side: 'defense', turns: [] })
    await cy.post(`${interview()}/questions`).send({ question: 'Hi?' })
    expect(asked[2].settings.examiningPartyRole).toBe('defendant')
  })

  it("always asks as the team's own side, whatever the request says", async () => {
    const res = await ada.post(`${interview()}/questions?side=defense`).send({ question: 'Where were you?', side: 'defense' })
    expect(res.body.interview.side).toBe('plaintiff')
    expect(asked[0].settings.examiningPartyRole).toBe('plaintiff')
    expect((await ada.get(`${interview()}?side=defense`)).body.interview.side).toBe('plaintiff')
  })

  it('starts every team with an empty interview, whatever the instructor tested', async () => {
    await prof.post(`${caseUrl()}/witnesses/${witnessId}/interview/questions?side=plaintiff`).send({ question: 'Test question?' })
    expect((await ada.get(interview())).body.interview.turns).toEqual([])
    expect((await cy.get(interview())).body.interview.turns).toEqual([])
  })

  it('starts over with an empty transcript', async () => {
    await ada.post(`${interview()}/questions`).send({ question: 'Where were you?' })
    const restarted = await bo.post(`${interview()}/restart`)
    expect(restarted.body.interview.turns).toEqual([])
    expect((await ada.get(interview())).body.interview.id).toBe(restarted.body.interview.id)
  })

  it('validates questions and witnesses', async () => {
    expect((await ada.post(`${interview()}/questions`).send({ question: '  ' })).status).toBe(400)
    expect((await ada.post(`${interview()}/questions`).send({ question: 'x'.repeat(2001) })).status).toBe(400)

    const bystander = (await prof.post(`${caseUrl()}/witnesses`).send({ name: 'Bystander' })).body.witness.id
    const view = await ada.get(`${myCaseUrl()}/witnesses/${bystander}/interview`)
    expect(view.body.interview).toMatchObject({ canAsk: false, notice: "Bystander isn't available for interviews yet." })
    expect((await ada.post(`${myCaseUrl()}/witnesses/${bystander}/interview/questions`).send({ question: 'Hi?' })).status).toBe(409)

    // Before the deposition phase, a witness only the defense can see is out of reach.
    await prof.put(`${caseUrl()}/phase`).send({ phase: 'investigate' })
    const defenseOnly = (await prof.post(`${caseUrl()}/witnesses`).send({ name: 'Secret', audience: 'defense' })).body.witness.id
    expect((await ada.get(`${myCaseUrl()}/witnesses/${defenseOnly}/interview`)).status).toBe(404)
    expect(asked).toHaveLength(0)
  })

  it('reports when the AI is not set up', async () => {
    ai.askWitness = async () => {
      const { AiNotConfiguredError } = await import('../ai/ai.ts')
      throw new AiNotConfiguredError()
    }
    const res = await ada.post(`${interview()}/questions`).send({ question: 'Where were you?' })
    expect(res.status).toBe(503)
    expect((await ada.get(interview())).body.interview.turns).toEqual([])
  })

  it('lets the instructor test it from either side, apart from the teams', async () => {
    await ada.post(`${interview()}/questions`).send({ question: 'Where were you?' })
    const test = `${caseUrl()}/witnesses/${witnessId}/interview`
    expect((await prof.get(test)).status).toBe(400)
    const asDefense = await prof.post(`${test}/questions?side=defense`).send({ question: 'Tell us your job.' })
    expect(asDefense.body.interview).toMatchObject({ side: 'defense', turns: [{ question: 'Tell us your job.', askedBy: 'Prof. Ruiz' }] })
    expect((await prof.get(`${test}?side=plaintiff`)).body.interview.turns).toEqual([])
    expect((await ada.get(interview())).body.interview.turns).toHaveLength(1)
  })

  it('keeps students out of the instructor routes', async () => {
    expect((await ada.get(`${caseUrl()}/witnesses/${witnessId}/interview?side=plaintiff`)).status).toBe(404)
    expect((await ada.get(`${caseUrl()}/materials/${files['Torres deposition.pdf']}/text`)).status).toBe(404)
  })
})

describe('witnesses by phase', () => {
  let witnessId: string
  const interview = () => `${myCaseUrl()}/witnesses/${witnessId}/interview`
  const setPhase = (phase: string) => prof.put(`${caseUrl()}/phase`).send({ phase })
  const names = async (agent: request.Agent) =>
    (await agent.get(myCaseUrl())).body.workspace.witnesses.map((w: { name: string }) => w.name)

  beforeEach(async () => {
    witnessId = (await createWitness()).id
    await launch()
  })

  it("keeps a side's witness from the other side until the deposition phase", async () => {
    for (const phase of ['introduction', 'investigate']) {
      await setPhase(phase)
      expect(await names(ada)).toEqual([])
      expect(await names(cy)).toEqual(['Elena Torres'])
      expect((await ada.get(interview())).status).toBe(404)
      expect((await ada.post(`${interview()}/questions`).send({ question: 'Where were you?' })).status).toBe(404)
    }
    // Her own side can interview her all along.
    expect((await cy.post(`${interview()}/questions`).send({ question: 'Where were you?' })).status).toBe(200)
    expect(asked[0].settings.examiningPartyRole).toBe('defendant')

    await setPhase('deposition')
    expect(await names(ada)).toEqual(['Elena Torres'])
    const deposed = await ada.post(`${interview()}/questions`).send({ question: 'Where were you?' })
    expect(deposed.status).toBe(200)
    expect(asked[1].settings).toMatchObject({ examiningPartyRole: 'plaintiff', defendingCounselName: 'Ms. Park' })

    // Stepping back hides her again; the interview is kept for later.
    await setPhase('investigate')
    expect((await ada.get(interview())).status).toBe(404)
    await setPhase('deposition')
    expect((await ada.get(interview())).body.interview.turns).toHaveLength(1)
  })

  it('always seats her lawyer for the other side, named "Defending counsel" when none is set', async () => {
    await prof.put(`${caseUrl()}/witnesses/${witnessId}`).send({
      name: 'Elena Torres',
      alignedSide: 'defense',
      depositionMaterialId: files['Torres deposition.pdf'],
      defendingCounsel: '',
    })
    await setPhase('deposition')
    await ada.post(`${interview()}/questions`).send({ question: 'Where were you?' })
    expect(asked[0].settings).toMatchObject({ examiningPartyRole: 'plaintiff', defendingCounselName: 'Defending counsel' })
    expect(buildSystemPrompt(asked[0].profile, asked[0].settings)).toContain('# Your lawyer is present')
  })
})

describe('profile helpers', () => {
  it('reads party names from the case title', () => {
    expect(partyNames('Rivera v. Thrill Park')).toEqual({ plaintiff: 'Rivera', defendant: 'Thrill Park' })
    expect(partyNames('Practice case')).toEqual({ plaintiff: 'the plaintiff', defendant: 'the defendant' })
  })

  it('formats the case date without shifting it', () => {
    expect(formatCaseDate('2024-10-01')).toBe('October 1, 2024')
  })
})
