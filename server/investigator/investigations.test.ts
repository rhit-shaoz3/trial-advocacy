import type request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ai } from '../ai/ai.ts'
import { pool } from '../db/pool.ts'
import { createCourseAs, resetDatabase, sampleFacts, signedInAgent, uploadCaseFile } from '../test/helpers.ts'
import type { FinalizeInput } from './finalize.ts'
import type { InvestigationInput } from './investigate.ts'
import { investigationsSettled } from './requests.ts'

let prof: request.Agent
let plaintiff: request.Agent
let defense: request.Agent
let course: { id: string }
let caseId: string
let teams: { plaintiffTeamId: string; defenseTeamId: string; matchupId: string }

const email = (n: number) => `s${n}@example.com`
const caseUrl = () => `/api/courses/${course.id}/cases/${caseId}`
const myCaseUrl = () => `/api/courses/${course.id}/my-cases/${caseId}`
const upload = (filename: string, options?: { audience?: string; description?: string }) =>
  uploadCaseFile(prof, caseUrl(), filename, options, Buffer.from(`Contents of ${filename}`))

let factPattern: string
let maintenanceLog: string
let dispatchLog: string

beforeEach(async () => {
  await resetDatabase()
  prof = (await signedInAgent('instructor', 'prof@example.com', 'Prof. Ruiz')).agent
  course = await createCourseAs(prof)
  await prof.post(`/api/courses/${course.id}/roster`).send({ emails: [1, 2, 3, 4].map(email) })
  plaintiff = (await signedInAgent('student', email(1), 'Ada Lawyer')).agent
  defense = (await signedInAgent('student', email(3), 'Cy Counsel')).agent
  caseId = (
    await prof.post(`/api/courses/${course.id}/cases`).send({ title: 'Rivera v. Northstar Transit', summary: 'A bus braked hard.', importantFacts: sampleFacts })
  ).body.case.id
  await prof.post(`${caseUrl()}/teams`).send({ emails: [email(1), email(2)] })
  const paired = (await prof.post(`${caseUrl()}/teams`).send({ emails: [email(3), email(4)] })).body.teams
  const { matchups } = (await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: paired[0].id, defenseTeamId: paired[1].id })).body
  teams = { plaintiffTeamId: paired[0].id, defenseTeamId: paired[1].id, matchupId: matchups[0].id }
  factPattern = (await upload('Fact pattern.pdf', { description: 'Fact pattern' })).body.material.id
  await prof.put(`${caseUrl()}/materials/initial`).send({ materialId: factPattern })
  maintenanceLog = (await upload('Maintenance log.pdf', { description: 'Maintenance log' })).body.material.id
  dispatchLog = (await upload('Dispatch log.pdf', { description: 'Dispatch log' })).body.material.id
  const launched = await prof.post(`${caseUrl()}/launch`)
  if (launched.status !== 200) throw new Error(JSON.stringify(launched.body))
})

afterAll(async () => {
  await pool.end()
})

const toInvestigate = () => prof.put(`${caseUrl()}/phase`).send({ phase: 'investigate' })

const REPORT = `1. I photographed the corner. [NEW FACT]
2. The maintenance log shows the brakes were serviced March 1. [NEW ACCESS: Maintenance log]
3. The dispatch log shows a call at 3:02. [NEW ACCESS: Dispatch log]

<review>
NEW FACTS
- A traffic camera is mounted on the northeast corner.
- The camera points south.
NEW ACCESS
- Maintenance log
- Dispatch log
- Fact pattern
RECORDS REQUESTED
- Northstar's dispatch audio, by subpoena.
</review>`

async function sendAndWait(agent: request.Agent, assignment: string) {
  const res = await agent.post(`${myCaseUrl()}/investigator/requests`).send({ assignment })
  await investigationsSettled()
  return res
}

const openReviews = async () => (await prof.get(`/api/courses/${course.id}/reviews`)).body.reviews

describe('the investigator settings', () => {
  it('starts on as John Hastings, and can be renamed, instructed, and turned off', async () => {
    expect((await prof.get(caseUrl())).body.case.investigator).toEqual({ enabled: true, name: 'John Hastings', instructions: '' })

    const res = await prof.put(`${caseUrl()}/investigator`).send({ enabled: true, name: '  Nora Vance ', instructions: 'Be brief.' })
    expect(res.body.case.investigator).toEqual({ enabled: true, name: 'Nora Vance', instructions: 'Be brief.' })
    const blank = await prof.put(`${caseUrl()}/investigator`).send({ enabled: false, name: '', instructions: '' })
    expect(blank.body.case.investigator).toEqual({ enabled: false, name: 'John Hastings', instructions: '' })
    expect((await prof.put(`${caseUrl()}/investigator`).send({ name: 'X' })).status).toBe(400)
  })

  it('takes away the investigate phase when he is off, and can\'t be turned off during it', async () => {
    await prof.put(`${caseUrl()}/investigator`).send({ enabled: false })
    const res = await toInvestigate()
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('This case has no background investigator, so it has no investigate phase.')
    expect((await prof.put(`${caseUrl()}/phase`).send({ phase: 'deposition' })).status).toBe(200)
    expect((await plaintiff.get(myCaseUrl())).body.workspace).toMatchObject({ investigator: null, investigatorAvailable: false })

    await prof.put(`${caseUrl()}/investigator`).send({ enabled: true })
    await toInvestigate()
    const off = await prof.put(`${caseUrl()}/investigator`).send({ enabled: false })
    expect(off.status).toBe(409)
  })
})

describe('sharing case files with worlds and teams', () => {
  it('shows a file to the teams and worlds it is shared with, on top of its audience', async () => {
    const res = await prof.put(`${caseUrl()}/materials/${maintenanceLog}/shares`).send({ teamIds: [teams.plaintiffTeamId], matchupIds: [] })
    expect(res.body.material.shares).toEqual({ matchupIds: [], teamIds: [teams.plaintiffTeamId] })

    const seen = async (agent: request.Agent) => (await agent.get(myCaseUrl())).body.workspace.materials.map((m: { id: string }) => m.id)
    expect(await seen(plaintiff)).toContain(maintenanceLog)
    expect(await seen(defense)).not.toContain(maintenanceLog)
    expect((await plaintiff.get(`${myCaseUrl()}/materials/${maintenanceLog}/file`)).status).toBe(302)
    expect((await defense.get(`${myCaseUrl()}/materials/${maintenanceLog}/file`)).status).toBe(404)

    await prof.put(`${caseUrl()}/materials/${maintenanceLog}/shares`).send({ teamIds: [], matchupIds: [teams.matchupId] })
    expect(await seen(defense)).toContain(maintenanceLog)
  })

  it('only shares with worlds and teams in the case', async () => {
    const res = await prof
      .put(`${caseUrl()}/materials/${maintenanceLog}/shares`)
      .send({ teamIds: ['00000000-0000-4000-8000-000000000000'], matchupIds: [] })
    expect(res.status).toBe(400)
  })
})

describe('asking the investigator', () => {
  it('opens in the investigate phase, for a matched team', async () => {
    const early = await plaintiff.post(`${myCaseUrl()}/investigator/requests`).send({ assignment: 'Check the corner.' })
    expect(early.status).toBe(409)
    expect(early.body.error).toBe('The background investigator becomes available in the investigate phase.')
    await toInvestigate()
    expect((await plaintiff.get(myCaseUrl())).body.workspace).toMatchObject({
      investigator: { name: 'John Hastings', avatarUrl: '/investigator.png' },
      investigatorAvailable: true,
    })
    expect((await plaintiff.post(`${myCaseUrl()}/investigator/requests`).send({ assignment: '  ' })).status).toBe(400)
  })

  it('sends the case file, what the team has, and the facts that stand', async () => {
    await toInvestigate()
    let sent: InvestigationInput | undefined
    ai.investigate = async (input) => {
      sent = structuredClone(input)
      return 'Nothing more to report.\n<review>\nNEW FACTS\nnone\nNEW ACCESS\nnone\nRECORDS REQUESTED\nnone\n</review>'
    }
    await prof.put(`${caseUrl()}/investigator`).send({ enabled: true, name: 'Nora Vance', instructions: 'Be brief.' })

    await sendAndWait(plaintiff, 'Check the corner.')

    expect(sent!.assignment).toBe('Check the corner.')
    expect(sent!.context).toMatchObject({ investigatorName: 'Nora Vance', instructions: 'Be brief.', side: 'plaintiff', teamNumber: 1 })
    expect(sent!.context.documents.map((d) => [d.title, d.teamHasAccess])).toEqual([
      ['Fact pattern', true],
      ['Maintenance log', false],
      ['Dispatch log', false],
    ])
    // Nothing to rule on, so the report came straight back to the team.
    const [done] = (await plaintiff.get(`${myCaseUrl()}/investigator`)).body.investigations
    expect(done).toMatchObject({ status: 'completed', report: 'Nothing more to report.', unlocked: [], seen: false })
  })

  it('goes to the instructor, who rules on facts and files; the team gets a clean report and the allowed file', async () => {
    await toInvestigate()
    ai.investigate = async () => REPORT
    let edit: FinalizeInput | undefined
    ai.finalizeReport = async (input) => {
      edit = input
      return '1. I photographed the corner.\n2. The maintenance log shows the brakes were serviced March 1.'
    }

    const sent = await sendAndWait(plaintiff, 'Check the corner and the bus records.')
    expect(sent.status).toBe(201)
    // Students never see the draft.
    const [pending] = (await plaintiff.get(`${myCaseUrl()}/investigator`)).body.investigations
    expect(pending).toMatchObject({ assignment: 'Check the corner and the bus records.', status: 'working', report: null, askedBy: 'Ada Lawyer' })
    const again = await plaintiff.post(`${myCaseUrl()}/investigator/requests`).send({ assignment: 'And another thing.' })
    expect(again.status).toBe(409)

    const [review] = await openReviews()
    expect(review).toMatchObject({
      kind: 'investigation',
      witness: null,
      status: 'open',
      teamNumber: 1,
      assignment: 'Check the corner and the bus records.',
      askedBy: 'Ada Lawyer',
      recordsRequested: ["Northstar's dispatch audio, by subpoena."],
    })
    expect(review.report).not.toContain('<review>')
    expect(review.facts.map((f: { text: string }) => f.text)).toEqual([
      'A traffic camera is mounted on the northeast corner.',
      'The camera points south.',
    ])
    // The fact pattern is already the team's, so only the two new files are proposed.
    expect(review.documents).toEqual([
      { materialId: maintenanceLog, title: 'Maintenance log', decision: null },
      { materialId: dispatchLog, title: 'Dispatch log', decision: null },
    ])

    const reviewUrl = `/api/courses/${course.id}/reviews/${review.id}`
    await prof.put(`${reviewUrl}/facts/${review.facts[0].id}`).send({ decision: 'accept_world' })
    await prof.put(`${reviewUrl}/facts/${review.facts[1].id}`).send({ decision: 'deny_case' })
    await prof.put(`${reviewUrl}/documents/${maintenanceLog}`).send({ decision: 'allow' })
    const early = await prof.post(`${reviewUrl}/complete`)
    expect(early.body.error).toBe('Decide on every file first.')
    await prof.put(`${reviewUrl}/documents/${dispatchLog}`).send({ decision: 'deny' })
    const finished = await prof.post(`${reviewUrl}/complete`)
    expect(finished.body.review.status).toBe('finalizing')
    await investigationsSettled()

    expect(edit).toMatchObject({ deniedFacts: ['The camera points south.'], deniedTitles: ['Dispatch log'] })
    const [done] = (await plaintiff.get(`${myCaseUrl()}/investigator`)).body.investigations
    expect(done).toMatchObject({
      status: 'completed',
      report: '1. I photographed the corner.\n2. The maintenance log shows the brakes were serviced March 1.',
      unlocked: [{ id: maintenanceLog, title: 'Maintenance log' }],
      seen: false,
    })
    const materials = (await plaintiff.get(myCaseUrl())).body.workspace.materials.map((m: { id: string }) => m.id)
    expect(materials).toContain(maintenanceLog)
    expect(materials).not.toContain(dispatchLog)
    expect((await defense.get(myCaseUrl())).body.workspace.materials.map((m: { id: string }) => m.id)).not.toContain(maintenanceLog)

    // The student is told, until they read it.
    const home = async () => (await plaintiff.get(`/api/courses/${course.id}/home`)).body.newReviewResults
    expect(await home()).toBe(1)
    await plaintiff.post(`${myCaseUrl()}/investigator/seen`)
    expect(await home()).toBe(0)

    // The rulings now bind: the next request carries the accepted fact, the denied one, and this report.
    let next: InvestigationInput | undefined
    ai.investigate = async (input) => {
      next = structuredClone(input)
      return 'Nothing new.'
    }
    await sendAndWait(plaintiff, 'Follow up.')
    expect(next!.context.settled).toEqual({
      accepted: ['A traffic camera is mounted on the northeast corner.'],
      denied: ['The camera points south.'],
    })
    expect(next!.history).toEqual([{ assignment: 'Check the corner and the bus records.', report: done.report }])
    expect(next!.context.documents.find((d) => d.title === 'Maintenance log')!.teamHasAccess).toBe(true)
  })

  it('can be retried when the AI fails, at whichever step failed', async () => {
    await toInvestigate()
    ai.investigate = async () => {
      throw new Error('boom')
    }
    await sendAndWait(plaintiff, 'Check the corner.')
    const [failed] = await openReviews()
    expect(failed).toMatchObject({ status: 'failed', error: 'Could not get the investigator’s report. Try again.' })

    ai.investigate = async () => REPORT
    await prof.post(`/api/courses/${course.id}/reviews/${failed.id}/retry`)
    await investigationsSettled()
    const [open] = await openReviews()
    expect(open.status).toBe('open')
  })
})
