import type request from 'supertest'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ai, AiNotConfiguredError } from '../ai/ai.ts'
import { transcriptionsSettled } from '../courses/materialText.ts'
import { pool } from '../db/pool.ts'
import { reviewsSettled } from '../reviews/reviews.ts'
import { createCourseAs, resetDatabase, sampleFacts, signedInAgent, uploadCaseFile } from '../test/helpers.ts'
import type { ClaimsInput } from './claims.ts'
import { claimsSettled, resumeClaims, testimonyMemory } from './memory.ts'
import type { NewFact } from './newFacts.ts'

// Each answer in a team's interview becomes claims (Claude is faked here).
// They stay in the witness's memory for the case world while rulings are
// pending, and a denied fact takes out the claims in the exchanges it struck.

let prof: request.Agent
let ada: request.Agent // World A, plaintiff
let cy: request.Agent // World A, defense
let eve: request.Agent // World B, plaintiff
let course: { id: string; entryCode: string }
let caseId: string
let witnessId: string
let worldA: string
let worldB: string
let claimInputs: ClaimsInput[]
let nextFacts: NewFact[]

const email = (n: number) => `s${n}@example.com`
const caseUrl = () => `/api/courses/${course.id}/cases/${caseId}`
const interview = () => `/api/courses/${course.id}/my-cases/${caseId}/witnesses/${witnessId}/interview`
const reviewsUrl = () => `/api/courses/${course.id}/reviews`

beforeEach(async () => {
  await resetDatabase()
  prof = (await signedInAgent('instructor', 'prof@example.com', 'Prof. Ruiz')).agent
  course = await createCourseAs(prof)
  await prof.post(`/api/courses/${course.id}/roster`).send({ emails: [1, 2, 3, 4].map(email) })
  ada = (await signedInAgent('student', email(1), 'Ada Lawyer')).agent
  cy = (await signedInAgent('student', email(2), 'Cy Counsel')).agent
  eve = (await signedInAgent('student', email(3), 'Eve Advocate')).agent
  caseId = (await prof.post(`/api/courses/${course.id}/cases`).send({ title: 'Rivera v. Thrill Park', importantFacts: sampleFacts, summary: 'A test case.' })).body.case.id

  const team = async (n: number) => (await prof.post(`${caseUrl()}/teams`).send({ emails: [email(n)] })).body.teams.at(-1).id as string
  const [t1, t2, t3, t4] = [await team(1), await team(2), await team(3), await team(4)]
  await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: t1, defenseTeamId: t2 })
  await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: t3, defenseTeamId: t4 })
  const { rows } = await pool.query<{ id: string }>('SELECT id FROM matchups WHERE case_id = $1 ORDER BY number', [caseId])
  ;[worldA, worldB] = rows.map((r) => r.id)

  const upload = async (filename: string, text: string, audience = 'all') =>
    (await uploadCaseFile(prof, caseUrl(), filename, { audience, description: filename.replace(/\.\w+$/, '') }, Buffer.from(text))).body.material.id as string
  const log = await upload('Accident log.txt', 'The ride stopped at 3:02.')
  await prof.put(`${caseUrl()}/materials/initial`).send({ materialId: log })
  const deposition = await upload('Torres deposition.txt', 'Q: Where were you? A: At the booth.', 'instructor')
  await transcriptionsSettled()
  witnessId = (
    await prof.post(`${caseUrl()}/witnesses`).send({ name: 'Elena Torres', role: 'Ride operator', alignedSide: 'defense', depositionMaterialId: deposition })
  ).body.witness.id
  await prof.post(`${caseUrl()}/launch`)
  await prof.put(`${caseUrl()}/phase`).send({ phase: 'deposition' })

  claimInputs = []
  nextFacts = []
  ai.askWitness = async (options) => {
    const answer = `Answer to: ${options.question}`
    return { reply: answer, objection: null, answer, model: 'fake', usage: {} as never }
  }
  // One claim per answer, repeating the question, so a test can tell them apart.
  ai.findClaims = async (input) => {
    claimInputs.push(input)
    return [{ kind: 'statement', text: `Claim: ${input.question}` }]
  }
  ai.findNewFacts = async () => nextFacts
})

afterAll(async () => {
  await pool.end()
})

async function ask(agent: request.Agent, ...questions: string[]) {
  for (const question of questions) await agent.post(`${interview()}/questions`).send({ question })
  await claimsSettled()
}

async function end(agent: request.Agent, facts: NewFact[] = []) {
  nextFacts = facts
  await agent.post(`${interview()}/end`)
  await reviewsSettled()
  await claimsSettled()
}

const remembered = async (world = worldA, current: string | null = null) => (await testimonyMemory(witnessId, world, current)).map((c) => c.text)

const onlyReview = async () => (await prof.get(reviewsUrl())).body.reviews[0]
const rule = (reviewId: string, factId: string, decision: string) => prof.put(`${reviewsUrl()}/${reviewId}/facts/${factId}`).send({ decision })

describe('reading testimony', () => {
  it('stores each answer as claims, tied to its turn, and reads it once', async () => {
    await ask(ada, 'Where were you?', 'Who saw you?')
    await end(ada)
    expect(claimInputs.map((c) => c.question)).toEqual(['Where were you?', 'Who saw you?'])
    expect(claimInputs[0]).toMatchObject({ witnessName: 'Elena Torres', answer: 'Answer to: Where were you?' })
    const { rows } = await pool.query('SELECT position, number, kind, text FROM testimony_claims ORDER BY position')
    expect(rows).toEqual([
      { position: 0, number: 0, kind: 'statement', text: 'Claim: Where were you?' },
      { position: 1, number: 0, kind: 'statement', text: 'Claim: Who saw you?' },
    ])
  })

  it('leaves out the instructor’s tests', async () => {
    await prof.post(`${caseUrl()}/witnesses/${witnessId}/interview/questions?side=plaintiff`).send({ question: 'Test question?' })
    await claimsSettled()
    await resumeClaims()
    expect(claimInputs).toEqual([])
    expect(await remembered()).toEqual([])
  })

  it('needs no call for an answer that was only an objection', async () => {
    ai.askWitness = async () => ({ reply: 'Objection.', objection: { speaker: 'Ms. Ray', text: 'Objection.' }, answer: '', model: 'fake', usage: {} as never })
    await ask(ada, 'Isn’t that a lie?')
    expect(claimInputs).toEqual([])
    const { rows } = await pool.query('SELECT claims_read_at FROM interview_turns')
    expect(rows[0].claims_read_at).not.toBeNull()
  })

  it('picks up unread answers after a failure, and only those', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const working = ai.findClaims
    await ask(ada, 'First?')
    ai.findClaims = async () => {
      throw new Error('overloaded')
    }
    await ask(ada, 'Second?')
    expect(await remembered()).toEqual(['Claim: First?'])
    expect(log).toHaveBeenCalled()
    log.mockRestore()

    ai.findClaims = working
    claimInputs = []
    await resumeClaims()
    expect(claimInputs.map((c) => c.question)).toEqual(['Second?'])
    expect(await remembered()).toEqual(['Claim: First?', 'Claim: Second?'])
  })

  it('waits quietly when AI isn’t set up', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    ai.findClaims = async () => {
      throw new AiNotConfiguredError()
    }
    await ask(ada, 'Where were you?')
    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
    const { rows } = await pool.query('SELECT claims_read_at FROM interview_turns')
    expect(rows[0].claims_read_at).toBeNull()
  })
})

describe('what the witness remembers', () => {
  it('keeps testimony while its ruling is pending, from either side of the world', async () => {
    await ask(ada, 'Open interview?')
    await ask(cy, 'Other side?')
    expect(await testimonyMemory(witnessId, worldA)).toEqual(
      expect.arrayContaining([
        { kind: 'statement', text: 'Claim: Open interview?', settled: false },
        { kind: 'statement', text: 'Claim: Other side?', settled: false },
      ]),
    )
  })

  it('stays in its case world', async () => {
    await ask(ada, 'World A?')
    await ask(eve, 'World B?')
    expect(await remembered(worldA)).toEqual(['Claim: World A?'])
    expect(await remembered(worldB)).toEqual(['Claim: World B?'])
  })

  it('leaves out the interview under way, which is already in the conversation', async () => {
    await ask(ada, 'Current?')
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM interviews')
    expect(await remembered(worldA, rows[0].id)).toEqual([])
  })

  it('forgets an interview ended with Start over', async () => {
    await ask(ada, 'Practice run?')
    expect(await remembered()).toEqual(['Claim: Practice run?'])
    await ada.post(`${interview()}/restart`)
    expect(await remembered()).toEqual([])
  })

  it('keeps an ended interview, and marks it settled once its review is done', async () => {
    await ask(ada, 'Nothing new?')
    await end(ada) // no new facts, so the review finishes at once
    expect(await testimonyMemory(witnessId, worldA)).toEqual([{ kind: 'statement', text: 'Claim: Nothing new?', settled: true }])
  })
})

describe('rulings', () => {
  const fact: NewFact = { text: 'Torres was on break.', producedBy: [0], builtOn: [] }

  it('drops a denied fact’s claims at once, even with the rest of the review pending', async () => {
    await ask(ada, 'Denied?', 'Stands?')
    await end(ada, [fact, { text: 'Torres smelled smoke.', producedBy: [1], builtOn: [] }])
    const review = await onlyReview()
    expect(await remembered()).toEqual(['Claim: Denied?', 'Claim: Stands?'])

    await rule(review.id, review.facts[0].id, 'deny_world')
    expect((await onlyReview()).status).toBe('open')
    expect(await testimonyMemory(witnessId, worldA)).toEqual([{ kind: 'statement', text: 'Claim: Stands?', settled: false }])
  })

  it('keeps an accepted fact’s claims', async () => {
    await ask(ada, 'Accepted?')
    await end(ada, [fact])
    const review = await onlyReview()
    await rule(review.id, review.facts[0].id, 'accept_world')
    expect(await testimonyMemory(witnessId, worldA)).toEqual([{ kind: 'statement', text: 'Claim: Accepted?', settled: true }])
  })

  it('brings the claims back when the ruling changes', async () => {
    await ask(ada, 'Changed?')
    await end(ada, [fact])
    const review = await onlyReview()
    await rule(review.id, review.facts[0].id, 'deny_world')
    expect(await remembered()).toEqual([])
    await rule(review.id, review.facts[0].id, 'accept_world')
    expect(await remembered()).toEqual(['Claim: Changed?'])
  })

  it('drops later answers that relied on the fact, but not ones that stand on their own', async () => {
    await ask(ada, 'Stated?', 'Relied?', 'Stood alone?')
    await end(ada, [
      {
        ...fact,
        builtOn: [
          { turn: 1, answer: true },
          { turn: 2, answer: false },
        ],
      },
    ])
    const review = await onlyReview()
    await rule(review.id, review.facts[0].id, 'deny_world')
    expect(await remembered()).toEqual(['Claim: Stood alone?'])
  })

  it('reads the stored ruling, so it counts however the ruling was made', async () => {
    await ask(ada, 'Grouped?')
    await end(ada, [fact])
    const review = await onlyReview()
    await pool.query(`UPDATE review_facts SET decision = 'deny_case', decided_at = now() WHERE id = $1`, [review.facts[0].id])
    expect(await remembered()).toEqual([])
  })
})
