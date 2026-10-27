import type request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ai } from '../ai/ai.ts'
import { transcribeFile } from '../ai/transcribe.ts'
import { transcriptionsSettled } from '../courses/materialText.ts'
import { pool } from '../db/pool.ts'
import { docxOf } from '../test/docx.ts'
import { createCourseAs, resetDatabase, sampleFacts, signedInAgent, uploadCaseFile } from '../test/helpers.ts'
import type { SuggestInput } from './suggest.ts'
import { witnessSuggestionsSettled } from './suggestions.ts'

let prof: request.Agent
let course: { id: string }
let caseId: string
const caseUrl = () => `/api/courses/${course.id}/cases/${caseId}`
const suggestions = async () => (await prof.get(`${caseUrl()}/witness-suggestions`)).body

const complaint = 'Paige Winston rode Atlas with her friend Logan Crest. The ride operator, Elena Torres, restarted the train.'

beforeEach(async () => {
  await resetDatabase()
  prof = (await signedInAgent('instructor', 'prof@example.com', 'Prof. Ruiz')).agent
  course = await createCourseAs(prof)
  caseId = (
    await prof.post(`/api/courses/${course.id}/cases`).send({
      importantFacts: sampleFacts,
      title: 'Winston v. Thrillville',
      summary: 'A rider was hurt.',
      plaintiffName: 'Paige Winston',
      defendantName: 'Thrillville Parks',
    })
  ).body.case.id
})

afterAll(async () => {
  await pool.end()
})

describe('suggested witnesses', () => {
  it('reads them from the initial file once the parties are named, minus anyone already a witness', async () => {
    expect(await suggestions()).toEqual({ status: 'waiting', reason: 'no-file' })

    let asked: SuggestInput | undefined
    ai.suggestWitnesses = async (input) => {
      asked = input
      return [
        { name: 'Paige Winston', role: 'Rider', description: 'Hurt on Atlas.', alignedSide: 'plaintiff' },
        { name: 'Logan Crest', role: 'Friend', description: 'Rode with her.', alignedSide: 'plaintiff' },
        { name: 'Elena Torres', role: 'Ride operator', description: 'Restarted the train.', alignedSide: 'defense' },
      ]
    }
    const file = (await uploadCaseFile(prof, caseUrl(), 'Complaint.txt', { audience: 'all' }, Buffer.from(complaint))).body.material
    await prof.put(`${caseUrl()}/materials/initial`).send({ materialId: file.id })
    await transcriptionsSettled()

    expect(await suggestions()).toEqual({ status: 'waiting', reason: 'thinking' })
    await witnessSuggestionsSettled()
    expect(asked).toEqual({ caseTitle: 'Winston v. Thrillville', plaintiffName: 'Paige Winston', defendantName: 'Thrillville Parks', complaint })

    // Someone added by hand drops out of the list.
    await prof.post(`${caseUrl()}/witnesses`).send({ name: 'logan crest' })
    const ready = await suggestions()
    expect(ready.status).toBe('ready')
    expect(ready.suggestions.map((s: { name: string }) => s.name)).toEqual(['Paige Winston', 'Elena Torres'])
  })

  it('reads a Word document complaint', async () => {
    // Word documents are read locally, so the real reader runs (no client is used).
    ai.transcribe = (file) => transcribeFile(null as never, file)
    let asked: SuggestInput | undefined
    ai.suggestWitnesses = async (input) => {
      asked = input
      return [{ name: 'Elena Torres', role: 'Ride operator', description: '', alignedSide: 'defense' }]
    }
    const file = (await uploadCaseFile(prof, caseUrl(), 'Complaint.docx', { audience: 'all' }, docxOf(complaint))).body.material
    await prof.put(`${caseUrl()}/materials/initial`).send({ materialId: file.id })
    await transcriptionsSettled()
    await suggestions()
    await witnessSuggestionsSettled()
    expect(asked?.complaint).toBe(complaint)
    expect((await suggestions()).suggestions.map((s: { name: string }) => s.name)).toEqual(['Elena Torres'])
  })

  it("says so when the initial file can't be read", async () => {
    ai.transcribe = (file) => transcribeFile(null as never, file)
    const file = (await uploadCaseFile(prof, caseUrl(), 'Complaint.docx', { audience: 'all' }, Buffer.from('not a docx'))).body.material
    await prof.put(`${caseUrl()}/materials/initial`).send({ materialId: file.id })
    await transcriptionsSettled()
    const failed = await suggestions()
    expect(failed.status).toBe('failed')
    expect(failed.error).toMatch(/couldn't be read/)
  })

  it('is offered once: after adding some or skipping, they never come back', async () => {
    ai.suggestWitnesses = async () => [{ name: 'Logan Crest', role: 'Friend', description: '', alignedSide: null }]
    const file = (await uploadCaseFile(prof, caseUrl(), 'Complaint.txt', { audience: 'all' }, Buffer.from(complaint))).body.material
    await prof.put(`${caseUrl()}/materials/initial`).send({ materialId: file.id })
    await transcriptionsSettled()
    await suggestions()
    await witnessSuggestionsSettled()
    expect((await suggestions()).status).toBe('ready')

    expect((await prof.post(`${caseUrl()}/witness-suggestions/done`)).status).toBe(200)
    expect(await suggestions()).toEqual({ status: 'done' })
    // Renaming the parties doesn't bring them back.
    await prof.patch(caseUrl()).send({ title: 'Winston v. Thrillville', summary: 'x', status: 'draft', plaintiffName: 'P. Winston', defendantName: 'Thrillville' })
    expect(await suggestions()).toEqual({ status: 'done' })
  })
})

describe('reading the suggestions', () => {
  it('keeps one per name, maps the side, and trims', async () => {
    const { suggestWitnesses } = await import('./suggest.ts')
    const client = {
      messages: {
        create: async () =>
          ({
            content: [
              {
                type: 'tool_use',
                name: 'suggest_witnesses',
                input: {
                  witnesses: [
                    { name: ' Paige Winston ', role: 'Rider', description: 'Hurt.', side: 'plaintiff' },
                    { name: 'paige winston', role: 'Again', description: '', side: 'plaintiff' },
                    { name: 'The ride operator', role: 'Operator', description: 'At the controls.', side: 'none' },
                    { name: '', role: 'Nobody', description: '', side: 'defense' },
                  ],
                },
              },
            ],
          }) as never,
      },
    }
    expect(await suggestWitnesses(client, { caseTitle: 'W v. T', plaintiffName: 'W', defendantName: 'T', complaint: 'x' })).toEqual([
      { name: 'Paige Winston', role: 'Rider', description: 'Hurt.', alignedSide: 'plaintiff' },
      { name: 'The ride operator', role: 'Operator', description: 'At the controls.', alignedSide: null },
    ])
  })
})
