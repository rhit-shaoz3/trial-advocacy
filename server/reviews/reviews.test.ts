import type request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ai } from '../ai/ai.ts'
import { transcriptionsSettled } from '../courses/materialText.ts'
import { pool } from '../db/pool.ts'
import { createCourseAs, resetDatabase, sampleFacts, signedInAgent, uploadCaseFile } from '../test/helpers.ts'
import type { NewFactsInput } from '../witness/newFacts.ts'
import type { WitnessProfile } from '../witness/prompt.ts'
import { endExpiredInterviews } from '../witness/interviews.ts'
import { reviewsSettled } from './reviews.ts'

// A team ends an interview; the AI (faked) lists the new facts the witness
// added; the instructor rules on each; the rulings bind later interviews in
// that world or the whole case, and the team sees what was accepted or denied.

let prof: request.Agent
let ada: request.Agent // World A, plaintiff (with Bo)
let bo: request.Agent
let eve: request.Agent // World B, plaintiff
let course: { id: string; entryCode: string }
let caseId: string
let witnessId: string

const email = (n: number) => `s${n}@example.com`
const caseUrl = () => `/api/courses/${course.id}/cases/${caseId}`
const myCaseUrl = () => `/api/courses/${course.id}/my-cases/${caseId}`
const reviewsUrl = () => `/api/courses/${course.id}/reviews`
const interview = () => `${myCaseUrl()}/witnesses/${witnessId}/interview`

/** What the fake AI was asked, and what it answers next. */
let profiles: WitnessProfile[]
let factInputs: NewFactsInput[]
let nextFacts: string[] | Error

beforeEach(async () => {
  await resetDatabase()
  prof = (await signedInAgent('instructor', 'prof@example.com', 'Prof. Ruiz')).agent
  course = await createCourseAs(prof)
  await prof.post(`/api/courses/${course.id}/roster`).send({ emails: [1, 2, 3, 4, 5, 6, 7, 8].map(email) })
  ada = (await signedInAgent('student', email(1), 'Ada Lawyer')).agent
  bo = (await signedInAgent('student', email(2), 'Bo Partner')).agent
  eve = (await signedInAgent('student', email(5), 'Eve Advocate')).agent
  caseId = (await prof.post(`/api/courses/${course.id}/cases`).send({ title: 'Rivera v. Thrill Park', importantFacts: sampleFacts })).body.case.id

  // World A: s1+s2 v s3+s4. World B: s5+s6 v s7+s8.
  const team = async (a: number, b: number) =>
    (await prof.post(`${caseUrl()}/teams`).send({ emails: [email(a), email(b)] })).body.teams.at(-1).id as string
  const [t1, t2, t3, t4] = [await team(1, 2), await team(3, 4), await team(5, 6), await team(7, 8)]
  await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: t1, defenseTeamId: t2 })
  await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: t3, defenseTeamId: t4 })

  const upload = async (filename: string, text: string, audience = 'all') =>
    (await uploadCaseFile(prof, caseUrl(), filename, { audience, description: filename.replace(/\.\w+$/, '') }, Buffer.from(text)))
      .body.material.id as string
  const log = await upload('Accident log.txt', 'The ride stopped at 3:02.')
  await prof.put(`${caseUrl()}/materials/initial`).send({ materialId: log })
  const deposition = await upload('Torres deposition.txt', 'Q: Where were you? A: At the booth.', 'instructor')
  await transcriptionsSettled()
  witnessId = (
    await prof.post(`${caseUrl()}/witnesses`).send({
      name: 'Elena Torres',
      role: 'Ride operator',
      alignedSide: 'defense',
      depositionMaterialId: deposition,
    })
  ).body.witness.id
  await prof.post(`${caseUrl()}/launch`)
  // The witness testifies for the defense; plaintiff teams can only question her in the deposition phase.
  await prof.put(`${caseUrl()}/phase`).send({ phase: 'deposition' })

  profiles = []
  factInputs = []
  nextFacts = []
  ai.askWitness = async (options) => {
    profiles.push(structuredClone(options.profile))
    return { reply: 'I was on break.', objection: null, answer: 'I was on break.', model: 'fake', usage: {} as never }
  }
  ai.findNewFacts = async (input) => {
    factInputs.push(structuredClone(input))
    if (nextFacts instanceof Error) throw nextFacts
    return nextFacts
  }
})

afterAll(async () => {
  await pool.end()
})

/** Ada's team asks one question and ends the interview; resolves once the facts are listed. */
async function interviewAndEnd(agent = ada, facts: string[] | Error = ['Torres was on break at 3:00.']) {
  nextFacts = facts
  await agent.post(`${interview()}/questions`).send({ question: 'Where were you at 3?' })
  const ended = await agent.post(`${interview()}/end`)
  await reviewsSettled()
  return ended
}

const openReviews = async () => (await prof.get(reviewsUrl())).body.reviews
const decide = (reviewId: string, factId: string, decision: string) =>
  prof.put(`${reviewsUrl()}/${reviewId}/facts/${factId}`).send({ decision })

describe('sending an interview for review', () => {
  it('lists the new facts the witness added, against the case files and earlier rulings', async () => {
    const ended = await interviewAndEnd(ada, ['Torres was on break at 3:00.', 'Torres smelled smoke.'])
    expect(ended.status).toBe(200)
    expect(ended.body.sentForReview).toBe(true)
    expect(ended.body.interview.turns).toEqual([])

    expect(factInputs[0]).toMatchObject({
      caseName: 'Rivera v. Thrill Park',
      witnessName: 'Elena Torres',
      settled: { accepted: [], denied: [] },
      transcript: [{ question: 'Where were you at 3?', answer: 'I was on break.' }],
    })
    expect(factInputs[0].documents.map((d) => d.title)).toEqual(['Accident log', 'Torres deposition'])

    const [review] = await openReviews()
    expect(review).toMatchObject({
      caseTitle: 'Rivera v. Thrill Park',
      witness: { name: 'Elena Torres', role: 'Ride operator' },
      worldNumber: 1,
      teamNumber: 1,
      side: 'plaintiff',
      team: ['Ada Lawyer', 'Bo Partner'],
      status: 'open',
      facts: [
        { id: expect.any(String), text: 'Torres was on break at 3:00.', decision: null },
        { id: expect.any(String), text: 'Torres smelled smoke.', decision: null },
      ],
    })
    expect((await prof.get(`/api/courses/${course.id}/home`)).body.reviewCount).toBe(1)
  })

  it("doesn't send empty interviews or ones started over, and finishes reviews with nothing new", async () => {
    const empty = await ada.post(`${interview()}/end`)
    expect(empty.body.sentForReview).toBe(false)

    await ada.post(`${interview()}/questions`).send({ question: 'Hello?' })
    await ada.post(`${interview()}/restart`)
    expect(await openReviews()).toEqual([])

    await interviewAndEnd(ada, [])
    expect(await openReviews()).toEqual([])
    const [done] = (await prof.get(`${reviewsUrl()}?status=completed`)).body.reviews
    expect(done).toMatchObject({ status: 'completed', facts: [] })
  })

  it("never sends the instructor's own test interviews", async () => {
    const test = `${caseUrl()}/witnesses/${witnessId}/interview`
    await prof.post(`${test}/questions?side=plaintiff`).send({ question: 'Where were you?' })
    await prof.post(`${test}/restart?side=plaintiff`)
    await reviewsSettled()
    expect(await openReviews()).toEqual([])
  })

  it('marks a review that could not be summarized, and retries it', async () => {
    await interviewAndEnd(ada, new Error('boom'))
    const [failed] = await openReviews()
    expect(failed).toMatchObject({ status: 'failed', error: 'Could not list the new facts in this conversation. Try again.' })

    nextFacts = ['Torres was on break at 3:00.']
    const retried = await prof.post(`${reviewsUrl()}/${failed.id}/retry`)
    expect(retried.body.review.status).toBe('summarizing')
    await reviewsSettled()
    expect((await openReviews())[0]).toMatchObject({ status: 'open', facts: [{ text: 'Torres was on break at 3:00.' }] })
    expect((await prof.post(`${reviewsUrl()}/${failed.id}/retry`)).status).toBe(409)
  })
})

describe('ruling on the facts', () => {
  it('records each ruling, and completes the review once every fact has one', async () => {
    await interviewAndEnd(ada, ['On break at 3:00.', 'Smelled smoke.'])
    const [review] = await openReviews()
    const [first, second] = review.facts

    expect((await decide(review.id, first.id, 'maybe')).body.error).toBe('Choose a ruling for this fact.')
    expect((await decide(review.id, first.id, 'accept_world')).body.review.facts[0].decision).toBe('accept_world')

    const early = await prof.post(`${reviewsUrl()}/${review.id}/complete`)
    expect(early.status).toBe(409)
    expect(early.body.error).toBe('Rule on every fact first.')

    await decide(review.id, second.id, 'deny_case')
    const done = await prof.post(`${reviewsUrl()}/${review.id}/complete`)
    expect(done.body.review).toMatchObject({ status: 'completed', completedAt: expect.any(String) })

    expect(await openReviews()).toEqual([])
    expect((await prof.get(`${reviewsUrl()}?status=completed`)).body.reviews[0].facts.map((f: { decision: string }) => f.decision))
      .toEqual(['accept_world', 'deny_case'])
    expect((await decide(review.id, first.id, 'deny_world')).status).toBe(409)
    expect((await prof.get(`/api/courses/${course.id}/home`)).body.reviewCount).toBe(0)
  })

  it('shows the conversation behind a review', async () => {
    await interviewAndEnd()
    const [review] = await openReviews()
    const { turns } = (await prof.get(`${reviewsUrl()}/${review.id}/transcript`)).body
    expect(turns).toEqual([{ question: 'Where were you at 3?', objection: null, answer: 'I was on break.', askedBy: 'Ada Lawyer' }])
  })

  it("is only for the course's instructor", async () => {
    await interviewAndEnd()
    const [review] = await openReviews()
    const other = (await signedInAgent('instructor', 'other@example.com')).agent
    expect((await other.get(`/api/courses/${course.id}/reviews`)).status).toBe(404)
    expect((await ada.get(`/api/courses/${course.id}/reviews`)).status).toBe(404)
    expect((await ada.put(`${reviewsUrl()}/${review.id}/facts/${review.facts[0].id}`).send({ decision: 'accept_case' })).status).toBe(404)
    expect((await prof.get(`${reviewsUrl()}/00000000-0000-4000-8000-000000000000/transcript`)).status).toBe(404)
  })
})

describe('rulings bind later interviews', () => {
  it('in the same world, or in every world for whole-case rulings, once completed', async () => {
    await interviewAndEnd(ada, ['World fact.', 'World lie.', 'Case fact.', 'Case lie.'])
    const [review] = await openReviews()
    const decisions = ['accept_world', 'deny_world', 'accept_case', 'deny_case']
    for (const [i, fact] of review.facts.entries()) await decide(review.id, fact.id, decisions[i])

    // Not yet completed: nothing binds the witness.
    await ada.post(`${interview()}/questions`).send({ question: 'Anything else?' })
    expect(profiles.at(-1)!.settledFacts).toEqual({ accepted: [], denied: [] })

    await prof.post(`${reviewsUrl()}/${review.id}/complete`)
    await ada.post(`${interview()}/questions`).send({ question: 'Anything else?' })
    expect(profiles.at(-1)!.settledFacts).toEqual({ accepted: ['World fact.', 'Case fact.'], denied: ['World lie.', 'Case lie.'] })

    // Eve is in World B: only the whole-case rulings reach her.
    await eve.post(`${interview()}/questions`).send({ question: 'Anything else?' })
    expect(profiles.at(-1)!.settledFacts).toEqual({ accepted: ['Case fact.'], denied: ['Case lie.'] })

    // The next summary checks against what's settled for that world.
    await eve.post(`${interview()}/end`)
    await reviewsSettled()
    expect(factInputs.at(-1)!.settled).toEqual({ accepted: ['Case fact.'], denied: ['Case lie.'] })
  })
})

describe('the team sees the results', () => {
  it('as accepted or denied, with a notice until they open them', async () => {
    await interviewAndEnd(ada, ['World fact.', 'World lie.', 'Case fact.', 'Case lie.'])
    const [review] = await openReviews()
    const decisions = ['accept_world', 'deny_world', 'accept_case', 'deny_case']
    for (const [i, fact] of review.facts.entries()) await decide(review.id, fact.id, decisions[i])

    // Nothing until the instructor finishes.
    expect((await ada.get(`${myCaseUrl()}/reviews`)).body.reviews).toEqual([])
    await prof.post(`${reviewsUrl()}/${review.id}/complete`)

    const { reviews } = (await bo.get(`${myCaseUrl()}/reviews`)).body
    expect(reviews).toEqual([
      {
        id: review.id,
        witness: { id: witnessId, name: 'Elena Torres', avatarUrl: null },
        completedAt: expect.any(String),
        accepted: ['World fact.', 'Case fact.'],
        denied: ['World lie.', 'Case lie.'],
        seen: false,
      },
    ])
    expect(JSON.stringify(reviews)).not.toMatch(/accept_|deny_/)
    expect((await bo.get(`/api/courses/${course.id}/home`)).body.newReviewResults).toBe(1)

    expect((await bo.post(`${myCaseUrl()}/reviews/seen`)).status).toBe(204)
    expect((await bo.get(`/api/courses/${course.id}/home`)).body.newReviewResults).toBe(0)
    expect((await bo.get(`${myCaseUrl()}/reviews`)).body.reviews[0].seen).toBe(true)
    // Seen is per student: Ada still has it to read.
    expect((await ada.get(`/api/courses/${course.id}/home`)).body.newReviewResults).toBe(1)

    // Other teams never see it.
    expect((await eve.get(`${myCaseUrl()}/reviews`)).body.reviews).toEqual([])
    expect((await eve.get(`/api/courses/${course.id}/home`)).body.newReviewResults).toBe(0)
  })
})

describe('the one-hour limit', () => {
  /** Moves the open interview's questions `minutes` into the past. */
  const backdate = (minutes: number) =>
    pool.query(
      `UPDATE interview_turns t SET created_at = now() - make_interval(mins => $1)
       FROM interviews i WHERE i.id = t.interview_id AND i.ended_at IS NULL`,
      [minutes],
    )

  it('starts the clock at the first question, an hour long', async () => {
    expect((await ada.get(interview())).body.interview.endsAt).toBeNull()
    const asked = await ada.post(`${interview()}/questions`).send({ question: 'Where were you?' })
    const endsAt = new Date(asked.body.interview.endsAt).getTime()
    expect(endsAt - Date.now()).toBeGreaterThan(59 * 60 * 1000)
    expect(endsAt - Date.now()).toBeLessThanOrEqual(60 * 60 * 1000)
    // Partners see the same clock.
    expect((await bo.get(interview())).body.interview.endsAt).toBe(asked.body.interview.endsAt)
  })

  it('ends the interview and sends it for review once the hour is up', async () => {
    nextFacts = ['Torres was on break at 3:00.']
    await ada.post(`${interview()}/questions`).send({ question: 'Where were you?' })
    await backdate(61)

    const late = await ada.post(`${interview()}/questions`).send({ question: 'Anything else?' })
    expect(late.status).toBe(409)
    expect(late.body.error).toBe('This interview reached its 1-hour limit and was sent to your instructor for review.')
    await reviewsSettled()
    expect(await openReviews()).toMatchObject([{ status: 'open', facts: [{ text: 'Torres was on break at 3:00.' }] }])

    // The next visit starts a fresh interview with a fresh hour.
    const fresh = (await ada.get(interview())).body.interview
    expect(fresh).toMatchObject({ turns: [], endsAt: null, canAsk: true })
  })

  it('opening an expired interview ends it and opens a fresh one', async () => {
    nextFacts = ['Torres was on break at 3:00.']
    await ada.post(`${interview()}/questions`).send({ question: 'Where were you?' })
    await backdate(61)
    expect((await bo.get(interview())).body.interview.turns).toEqual([])
    await reviewsSettled()
    expect(await openReviews()).toHaveLength(1)
  })

  it('times out interviews nobody comes back to, but never instructor tests', async () => {
    nextFacts = ['Torres was on break at 3:00.']
    await ada.post(`${interview()}/questions`).send({ question: 'Where were you?' })
    await eve.post(`${interview()}/questions`).send({ question: 'Where were you?' })
    const test = `${caseUrl()}/witnesses/${witnessId}/interview`
    await prof.post(`${test}/questions?side=plaintiff`).send({ question: 'Where were you?' })
    expect((await prof.get(`${test}?side=plaintiff`)).body.interview.endsAt).toBeNull()

    expect(await endExpiredInterviews()).toBe(0)
    await backdate(61)
    // Ada's and Eve's team interviews end; the instructor's test doesn't.
    expect(await endExpiredInterviews()).toBe(2)
    await reviewsSettled()
    expect(await openReviews()).toHaveLength(2)
    expect((await prof.get(`${test}?side=plaintiff`)).body.interview.turns).toHaveLength(1)
    expect(await endExpiredInterviews()).toBe(0)
  })
})

