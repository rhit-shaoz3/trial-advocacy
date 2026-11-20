import type request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ai } from '../ai/ai.ts'
import { transcriptionsSettled } from '../courses/materialText.ts'
import { pool } from '../db/pool.ts'
import { parsePracticeReply } from '../practice/turn.ts'
import { createCourseAs, resetDatabase, sampleFacts, signedInAgent, uploadCaseFile } from '../test/helpers.ts'

// A student's learning library: their own practice, and their team's
// discovery checks and planner feedback, in one list and each in full.

let prof: request.Agent
let ada: request.Agent // plaintiff
let bo: request.Agent // Ada's partner
let cy: request.Agent // defense
let course: { id: string }
let caseId: string
let teams: { id: string }[]
let users: Record<string, string>
let lin: string

const email = (n: number) => `s${n}@example.com`
const caseUrl = () => `/api/courses/${course.id}/cases/${caseId}`
const libraryUrl = () => `/api/courses/${course.id}/library`

beforeEach(async () => {
  await resetDatabase()
  prof = (await signedInAgent('instructor', 'prof@example.com', 'Prof. Ruiz')).agent
  course = await createCourseAs(prof)
  await prof.post(`/api/courses/${course.id}/roster`).send({ emails: [1, 2, 3, 4].map(email) })
  ada = (await signedInAgent('student', email(1), 'Ada Lawyer')).agent
  bo = (await signedInAgent('student', email(2), 'Bo Partner')).agent
  cy = (await signedInAgent('student', email(3), 'Cy Counsel')).agent
  users = Object.fromEntries((await pool.query<{ name: string; id: string }>('SELECT name, id FROM users')).rows.map((u) => [u.name, u.id]))
  caseId = (await prof.post(`/api/courses/${course.id}/cases`).send({ importantFacts: sampleFacts, title: 'Rivera v. Thrill Park', summary: 'A rider fell.' })).body.case.id
  await prof.post(`${caseUrl()}/teams`).send({ emails: [email(1), email(2)] })
  teams = (await prof.post(`${caseUrl()}/teams`).send({ emails: [email(3), email(4)] })).body.teams
  await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: teams[0].id, defenseTeamId: teams[1].id })
  const deposition = (await uploadCaseFile(prof, caseUrl(), 'Lin deposition.pdf', { audience: 'instructor' }, Buffer.from('Q: Did you see it? A: Yes.'))).body.material.id
  const complaint = (await uploadCaseFile(prof, caseUrl(), 'Complaint.txt', { audience: 'all' }, Buffer.from('Rivera alleges a fall.'))).body.material.id
  await prof.put(`${caseUrl()}/materials/initial`).send({ materialId: complaint })
  await transcriptionsSettled()
  lin = (await prof.post(`${caseUrl()}/witnesses`).send({ name: 'Dr. Lin', role: 'ER doctor', alignedSide: 'plaintiff', depositionMaterialId: deposition })).body.witness.id
  expect((await prof.post(`${caseUrl()}/launch`)).status).toBe(200)

  ai.practiceTurn = async (options) => {
    const reply = '<coach kind="good" quote="What did you see">Open, so the jury hears it from her.</coach>\n<witness>A boy on a gurney.</witness>'
    return { reply, blocks: parsePracticeReply(reply, options.text), model: 'fake', usage: { input_tokens: 1, output_tokens: 1 } as never }
  }
})

afterAll(async () => {
  await pool.end()
})

/** Ada's team's discovery check and planner round, Bo's check, and the defense's check. */
async function feedback() {
  const check = (hoursAgo: number, teamId: string, by: string, kind: string, tag: string, text: string, content: object | null = null) =>
    pool.query(
      `INSERT INTO discovery_checks (case_id, team_id, kind, mode, content_hash, tag, feedback, checked_by, content, created_at)
       VALUES ($1, $2, $3, 'draft', 'x', $4, $5, $6, $7, now() - make_interval(hours => $8)) RETURNING id`,
      [caseId, teamId, kind, tag, text, by, content && JSON.stringify(content), hoursAgo],
    )
  const mine = (
    await check(3, teams[0].id, users['Ada Lawyer'], 'interrogatories', 'SMALL_EDITS', 'Question 2: which day?', {
      kind: 'interrogatories',
      mode: 'draft',
      items: ['Who inspected the bar?', 'When?'],
    })
  ).rows[0].id
  await check(2, teams[0].id, users['Bo Partner'], 'subpoena', 'LOOKS_GOOD', 'Well aimed.')
  await check(2, teams[1].id, users['Cy Counsel'], 'rfas', 'NEEDS_IMPROVEMENT', 'The defense’s own.')
  const snapshot = { cards: [{ id: '00000000-0000-0000-0000-0000000000c1', parentId: null, title: 'The bar was loose.' }], gaps: [] }
  const round = (
    await pool.query(
      `INSERT INTO planner_reviews (case_id, team_id, round, asked_by, status, snapshot, labels, tag, overview, big_picture, created_at)
       VALUES ($1, $2, 1, $3, 'ready', $4, '{}', 'NEEDS_IMPROVEMENT', 'Your elements are there.', 'What is the park’s story?', now() - interval '1 hour')
       RETURNING id`,
      [caseId, teams[0].id, users['Bo Partner'], JSON.stringify(snapshot)],
    )
  ).rows[0].id
  await pool.query(`INSERT INTO planner_review_notes (review_id, position, target_kind, target_id, text) VALUES ($1, 0, 'card', $2, 'How do you know?')`, [
    round,
    snapshot.cards[0].id,
  ])
  return { mine, round }
}

describe('the learning library', () => {
  it('lists the student’s own practice and the team’s feedback, newest first, marked by who asked', async () => {
    const { mine } = await feedback()
    const practice = `/api/courses/${course.id}/my-cases/${caseId}/practice`
    const session = (await ada.post(practice).send({ witnessId: lin, type: 'direct', goal: 'Her first sight of him.' })).body.session.id
    await ada.post(`${practice}/${session}/turns`).send({ kind: 'question', text: 'What did you see?' })
    // An empty session isn't feedback yet.
    await ada.post(practice).send({ witnessId: lin, type: 'interview', goal: 'Nothing yet.' })

    const entries = (await ada.get(libraryUrl())).body.entries
    expect(entries.map((e: { kind: string; title: string; by: string | null; mine: boolean }) => [e.kind, e.title, e.by, e.mine])).toEqual([
      ['practice', 'Direct examination of Dr. Lin', null, true],
      ['planner', 'Planner feedback, round 1', 'Bo Partner', false],
      ['discovery', 'Subpoena', 'Bo Partner', false],
      ['discovery', 'Interrogatories', 'Ada Lawyer', true],
    ])
    expect(entries[0]).toMatchObject({ subkind: 'direct', caseTitle: 'Rivera v. Thrill Park', summary: 'Her first sight of him.' })
    // The partner sees the team's feedback, but not Ada's practice; the other side sees only its own.
    expect((await bo.get(libraryUrl())).body.entries.map((e: { kind: string }) => e.kind)).toEqual(['planner', 'discovery', 'discovery'])
    expect((await cy.get(libraryUrl())).body.entries.map((e: { title: string }) => e.title)).toEqual(['Requests for admission'])
    expect((await cy.get(`${libraryUrl()}/discovery/${mine}`)).status).toBe(404)
    expect((await bo.get(`${libraryUrl()}/practice/${session}`)).status).toBe(404)
  })

  it('opens each in full, and as a PDF', async () => {
    const { mine, round } = await feedback()
    const check = (await ada.get(`${libraryUrl()}/discovery/${mine}`)).body.detail
    expect(check.check).toMatchObject({ kind: 'interrogatories', tag: 'SMALL_EDITS', feedback: 'Question 2: which day?', content: { items: ['Who inspected the bar?', 'When?'] } })
    const planner = (await ada.get(`${libraryUrl()}/planner/${round}`)).body.detail
    expect(planner.review).toEqual({
      round: 1,
      tag: 'NEEDS_IMPROVEMENT',
      overview: 'Your elements are there.',
      bigPicture: 'What is the park’s story?',
      notes: [{ targetKind: 'card', title: 'The bar was loose.', text: 'How do you know?' }],
    })

    const practice = `/api/courses/${course.id}/my-cases/${caseId}/practice`
    const session = (await ada.post(practice).send({ witnessId: lin, type: 'direct', goal: 'Her first sight of him.' })).body.session.id
    await ada.post(`${practice}/${session}/turns`).send({ kind: 'question', text: 'What did you see?' })
    const detail = (await ada.get(`${libraryUrl()}/practice/${session}`)).body.detail
    expect(detail.session).toMatchObject({ type: 'direct', goal: 'Her first sight of him.', witness: { name: 'Dr. Lin' } })
    expect(detail.session.turns[0]).toMatchObject({ text: 'What did you see?', blocks: { witness: 'A boy on a gurney.', coach: [{ kind: 'good' }] } })
    expect(detail.session.turns[0].reply).toBeUndefined()
    // Turning practice off later doesn't take it out of the library.
    await prof.put(`${caseUrl()}/practice`).send({ enabled: false })
    expect((await ada.get(`${libraryUrl()}/practice/${session}`)).status).toBe(200)

    const pdf = await ada.get(`${libraryUrl()}/practice/${session}/pdf`).buffer(true)
    expect(pdf.status).toBe(200)
    expect(pdf.headers['content-type']).toBe('application/pdf')
    expect(pdf.headers['content-disposition']).toContain('Direct examination of Dr. Lin - Rivera v. Thrill Park.pdf')
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-')
    for (const [kind, id] of [
      ['discovery', mine],
      ['planner', round],
    ]) {
      expect((await ada.get(`${libraryUrl()}/${kind}/${id}/pdf`)).status).toBe(200)
    }
    expect((await ada.get(`${libraryUrl()}/nonsense/${round}`)).status).toBe(404)
  })
})
