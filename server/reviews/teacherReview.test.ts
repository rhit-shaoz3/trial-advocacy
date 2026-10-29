import type request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ai } from '../ai/ai.ts'
import { transcriptionsSettled } from '../courses/materialText.ts'
import { pool } from '../db/pool.ts'
import { createCourseAs, resetDatabase, sampleFacts, signedInAgent, uploadCaseFile } from '../test/helpers.ts'
import type { NewFactsInput } from '../witness/newFacts.ts'
import type { WitnessProfile } from '../witness/prompt.ts'
import { fileFactsSettled } from './caseFacts.ts'
import type { PendingFact } from './factsAi.ts'
import { groupingSettled } from './grouping.ts'
import { reviewsSettled } from './reviews.ts'
import type { NewFact } from '../witness/newFacts.ts'

// The instructor's side of reviewing: the running list of facts, similar facts
// from different teams grouped to rule on together, and review lite, where
// the AI's calls stand and students flag what they think is wrong.

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
/** The conversation so far that the fake AI was given with each question. */
let transcripts: { question: string; reply: string }[][]
let factInputs: NewFactsInput[]
let nextFacts: (string | NewFact)[] | Error

beforeEach(async () => {
  await resetDatabase()
  prof = (await signedInAgent('instructor', 'prof@example.com', 'Prof. Ruiz')).agent
  course = await createCourseAs(prof)
  await prof.post(`/api/courses/${course.id}/roster`).send({ emails: [1, 2, 3, 4, 5, 6, 7, 8].map(email) })
  ada = (await signedInAgent('student', email(1), 'Ada Lawyer')).agent
  bo = (await signedInAgent('student', email(2), 'Bo Partner')).agent
  eve = (await signedInAgent('student', email(5), 'Eve Advocate')).agent
  caseId = (await prof.post(`/api/courses/${course.id}/cases`).send({ title: 'Rivera v. Thrill Park', importantFacts: sampleFacts, summary: 'A test case.' })).body.case.id

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
  transcripts = []
  factInputs = []
  nextFacts = []
  ai.askWitness = async (options) => {
    profiles.push(structuredClone(options.profile))
    transcripts.push(structuredClone(options.transcript))
    return { reply: 'I was on break.', objection: null, answer: 'I was on break.', model: 'fake', usage: {} as never }
  }
  ai.findNewFacts = async (input) => {
    factInputs.push(structuredClone(input))
    if (nextFacts instanceof Error) throw nextFacts
    // A bare sentence came from the first question, and nothing built on it.
    return nextFacts.map((f) => (typeof f === 'string' ? { text: f, producedBy: [0], builtOn: [] } : f))
  }
})

afterAll(async () => {
  await pool.end()
})

/** Ada's team asks one question and ends the interview; resolves once the facts are listed. */
async function interviewAndEnd(agent = ada, facts: (string | NewFact)[] | Error = ['Torres was on break at 3:00.']) {
  nextFacts = facts
  await agent.post(`${interview()}/questions`).send({ question: 'Where were you at 3?' })
  const ended = await agent.post(`${interview()}/end`)
  await reviewsSettled()
  return ended
}

const decide = (reviewId: string, factId: string, decision: string) =>
  prof.put(`${reviewsUrl()}/${reviewId}/facts/${factId}`).send({ decision })


/** What the fake grouper was given. */
let grouped: PendingFact[][]

beforeEach(() => {
  grouped = []
  // Groups every fact about medical bills.
  ai.groupFacts = async (facts) => {
    grouped.push(facts)
    const bills = facts.filter((f) => /bill/i.test(f.text))
    return bills.length > 1
      ? [{ headline: 'Teams 1 and 3 both got medical bills from Torres.', differences: '$6,000 (Team 1) vs. $8,000 (Team 3)', fact_ids: [] as string[], factIds: bills.map((f) => f.id) }]
      : []
  }
})

const groups = async () => (await prof.get(reviewsUrl())).body.groups

describe('grouping similar facts', () => {
  it('groups the same claim from two teams, to rule on once for both worlds', async () => {
    await interviewAndEnd(ada, ['Torres says the bills were $6,000.', 'Torres smelled smoke.'])
    await groupingSettled()
    // One review alone has nothing to group with.
    expect(grouped).toEqual([])
    await interviewAndEnd(eve, ['Torres says the bills were $8,000.'])
    await groupingSettled()
    expect(grouped[0].map((f) => [f.text, f.teamNumber, f.worldNumber, f.source])).toEqual([
      ['Torres says the bills were $6,000.', 1, 1, 'Elena Torres'],
      ['Torres smelled smoke.', 1, 1, 'Elena Torres'],
      ['Torres says the bills were $8,000.', 3, 2, 'Elena Torres'],
    ])

    const [group] = await groups()
    expect(group).toMatchObject({
      headline: 'Teams 1 and 3 both got medical bills from Torres.',
      differences: '$6,000 (Team 1) vs. $8,000 (Team 3)',
      worlds: 2,
      facts: [
        { text: 'Torres says the bills were $6,000.', teamNumber: 1, worldNumber: 1, source: 'Interview of Elena Torres' },
        { text: 'Torres says the bills were $8,000.', teamNumber: 3, worldNumber: 2, source: 'Interview of Elena Torres' },
      ],
    })
    // A grouped fact is ruled with its group.
    const reviews = (await prof.get(reviewsUrl())).body.reviews
    const ada1 = reviews.find((r: { teamNumber: number }) => r.teamNumber === 1)
    expect((await decide(ada1.id, group.facts[0].id, 'accept_world')).status).toBe(409)

    // Accepted for each world: Eve's review had only that fact, so it's done; Ada's still has the smoke.
    expect((await prof.put(`${reviewsUrl()}/fact-groups/${group.id}`).send({ decision: 'accept_world' })).status).toBe(200)
    expect(await groups()).toEqual([])
    const open = (await prof.get(reviewsUrl())).body.reviews
    expect(open.map((r: { teamNumber: number }) => r.teamNumber)).toEqual([1])
    expect(open[0].facts.map((f: { decision: string | null }) => f.decision)).toEqual(['accept_world', null])

    await eve.post(`${interview()}/questions`).send({ question: 'Anything else?' })
    expect(profiles.at(-1)!.settledFacts).toEqual({ accepted: ['Torres says the bills were $8,000.'], denied: [] })
  })

  it('can be ungrouped, to rule on each fact separately, and is never grouped again', async () => {
    await interviewAndEnd(ada, ['Torres says the bills were $6,000.'])
    await interviewAndEnd(eve, ['Torres says the bills were $8,000.'])
    await groupingSettled()
    const [group] = await groups()
    expect((await prof.post(`${reviewsUrl()}/fact-groups/${group.id}/ungroup`)).status).toBe(204)
    expect(await groups()).toEqual([])

    // Another bill fact has nothing left to group with: the ungrouped ones aren't offered again.
    await interviewAndEnd(bo, ['Torres says the bills were $7,000.'])
    await groupingSettled()
    expect(grouped).toHaveLength(1)
    expect(await groups()).toEqual([])
  })
})

describe('the running list of facts', () => {
  it('lists the case files’ facts, the important facts, and what stands for all worlds and each', async () => {
    let read = 0
    ai.summarizeCaseFacts = async (input) => {
      read++
      return input.documents.map((d) => `${d.title} says something.`)
    }
    const first = (await prof.get(`${caseUrl()}/facts`)).body.facts
    expect(first.fileFacts.status).toBe('working')
    await fileFactsSettled()

    await interviewAndEnd(ada, ['World fact.', 'Case fact.'])
    const [review] = (await prof.get(reviewsUrl())).body.reviews
    await decide(review.id, review.facts[0].id, 'accept_world')
    await decide(review.id, review.facts[1].id, 'deny_case')

    const { facts } = (await prof.get(`${caseUrl()}/facts`)).body
    expect(facts).toEqual({
      fileFacts: { status: 'ready', facts: ['Accident log says something.', 'Torres deposition says something.'] },
      important: sampleFacts,
      allWorlds: { accepted: [], denied: [{ text: 'Case fact.', source: 'Interview of Elena Torres · Team 1', auto: false }] },
      worlds: [
        {
          matchupId: expect.any(String),
          number: 1,
          teams: [
            { number: 1, side: 'plaintiff' },
            { number: 2, side: 'defense' },
          ],
          accepted: [{ text: 'World fact.', source: 'Interview of Elena Torres · Team 1', auto: false }],
          denied: [],
        },
        { matchupId: expect.any(String), number: 2, teams: expect.any(Array), accepted: [], denied: [] },
      ],
    })
    // Read once; again only when the files change, or on request.
    expect(read).toBe(1)
    await prof.post(`${caseUrl()}/facts/refresh`)
    await fileFactsSettled()
    expect(read).toBe(2)
    expect((await ada.get(`${caseUrl()}/facts`)).status).toBe(404)
  })
})

describe('review lite', () => {
  it('lets the testimony stand for the world; the team flags a fact and the instructor denies it', async () => {
    expect((await prof.put(`${caseUrl()}/review-mode`).send({ reviewMode: 'maybe' })).status).toBe(400)
    expect((await prof.put(`${caseUrl()}/review-mode`).send({ reviewMode: 'lite' })).body.case.reviewMode).toBe('lite')
    await interviewAndEnd(ada, ['Torres was on break at 3:00.', 'Torres smelled smoke.'])

    expect((await prof.get(reviewsUrl())).body.reviews).toEqual([])
    const [result] = (await ada.get(`${myCaseUrl()}/reviews`)).body.reviews
    expect(result.items).toMatchObject([
      { text: 'Torres was on break at 3:00.', accepted: true, auto: true },
      { text: 'Torres smelled smoke.', accepted: true, auto: true },
    ])
    // For this world only.
    await eve.post(`${interview()}/questions`).send({ question: 'Anything?' })
    expect(profiles.at(-1)!.settledFacts).toEqual({ accepted: [], denied: [] })

    const smoke = result.items[1]
    expect((await ada.post(`${myCaseUrl()}/flags`).send({ kind: 'fact', targetId: smoke.id, reason: '  ' })).status).toBe(400)
    expect((await eve.post(`${myCaseUrl()}/flags`).send({ kind: 'fact', targetId: smoke.id, reason: 'No.' })).status).toBe(409)
    const raised = await ada.post(`${myCaseUrl()}/flags`).send({ kind: 'fact', targetId: smoke.id, reason: 'Nothing was burning.' })
    expect(raised.body.flags).toMatchObject([{ kind: 'fact', targetId: smoke.id, status: 'open', resolution: null }])

    const [flag] = (await prof.get(reviewsUrl())).body.flags
    expect(flag).toMatchObject({
      kind: 'fact',
      factId: smoke.id,
      reason: 'Nothing was burning.',
      raisedBy: 'Ada Lawyer',
      teamNumber: 1,
      worldNumber: 1,
      review: { id: result.id, witness: { name: 'Elena Torres' } },
    })
    await prof.post(`${reviewsUrl()}/flags/${flag.id}/resolve`).send({ decision: 'deny_world' })
    expect((await prof.get(reviewsUrl())).body.flags).toEqual([])

    // Denied now: the witness won't repeat it, and the transcript strikes it.
    await ada.post(`${interview()}/questions`).send({ question: 'Anything?' })
    expect(profiles.at(-1)!.settledFacts).toEqual({ accepted: ['Torres was on break at 3:00.'], denied: ['Torres smelled smoke.'] })
    const { turns } = (await ada.get(`${myCaseUrl()}/reviews/${result.id}/transcript`)).body
    expect(turns[0].struck).toBe('all')
    const { flags } = (await ada.get(`${myCaseUrl()}/flags`)).body
    expect(flags).toMatchObject([{ status: 'resolved', resolution: 'changed', seen: false }])
    await ada.post(`${myCaseUrl()}/flags/seen`)
    expect((await ada.get(`${myCaseUrl()}/flags`)).body.flags[0].seen).toBe(true)
  })

  it("leaves what was already waiting for the instructor, and doesn't group anything", async () => {
    await interviewAndEnd(ada, ['Torres says the bills were $6,000.'])
    await prof.put(`${caseUrl()}/review-mode`).send({ reviewMode: 'lite' })
    await interviewAndEnd(eve, ['Torres says the bills were $8,000.'])
    await groupingSettled()
    expect(grouped).toEqual([])
    expect((await prof.get(reviewsUrl())).body.reviews.map((r: { teamNumber: number }) => r.teamNumber)).toEqual([1])
  })
})
