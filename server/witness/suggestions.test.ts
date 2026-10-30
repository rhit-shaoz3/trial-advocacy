import type request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ai } from '../ai/ai.ts'
import { transcribeFile } from '../ai/transcribe.ts'
import { transcriptionsSettled } from '../courses/materialText.ts'
import { pool } from '../db/pool.ts'
import { docxOf } from '../test/docx.ts'
import { createCourseAs, resetDatabase, sampleFacts, signedInAgent, uploadCaseFile } from '../test/helpers.ts'
import type { CaseSuggestions, SuggestInput, WitnessSuggestion } from './suggest.ts'
import { witnessSuggestionsSettled } from './suggestions.ts'

let prof: request.Agent
let course: { id: string }
let caseId: string
const caseUrl = () => `/api/courses/${course.id}/cases/${caseId}`
const suggestions = async () => (await prof.get(`${caseUrl()}/witness-suggestions`)).body

const noContent: CaseSuggestions = { disputedIssues: '', investigatorNotes: '', instructorNote: '', tasks: [] }
const content = async () => (await prof.get(`${caseUrl()}/content-suggestions`)).body
/** The AI's one read of the complaint, with these witnesses (and what it was asked, in `asked`). */
function fakeSuggest(witnesses: WitnessSuggestion[], fields: CaseSuggestions = noContent, asked: SuggestInput[] = []) {
  ai.suggestFromComplaint = async (input) => {
    asked.push(input)
    return { witnesses, content: fields }
  }
  return asked
}

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

    const asked = fakeSuggest([
      { name: 'Paige Winston', role: 'Rider', description: 'Hurt on Atlas.', alignedSide: 'plaintiff' },
      { name: 'Logan Crest', role: 'Friend', description: 'Rode with her.', alignedSide: 'plaintiff' },
      { name: 'Elena Torres', role: 'Ride operator', description: 'Restarted the train.', alignedSide: 'defense' },
    ])
    const file = (await uploadCaseFile(prof, caseUrl(), 'Complaint.txt', { audience: 'all' }, Buffer.from(complaint))).body.material
    await prof.put(`${caseUrl()}/materials/initial`).send({ materialId: file.id })
    await transcriptionsSettled()

    expect(await suggestions()).toEqual({ status: 'waiting', reason: 'thinking' })
    await witnessSuggestionsSettled()
    expect(asked).toEqual([{ caseTitle: 'Winston v. Thrillville', plaintiffName: 'Paige Winston', defendantName: 'Thrillville Parks', complaint }])

    // Someone added by hand drops out of the list.
    await prof.post(`${caseUrl()}/witnesses`).send({ name: 'logan crest' })
    const ready = await suggestions()
    expect(ready.status).toBe('ready')
    expect(ready.suggestions.map((s: { name: string }) => s.name)).toEqual(['Paige Winston', 'Elena Torres'])
  })

  it('reads a Word document complaint', async () => {
    // Word documents are read locally, so the real reader runs (no client is used).
    ai.transcribe = (file) => transcribeFile(null as never, file)
    const asked = fakeSuggest([{ name: 'Elena Torres', role: 'Ride operator', description: '', alignedSide: 'defense' }])
    const file = (await uploadCaseFile(prof, caseUrl(), 'Complaint.docx', { audience: 'all' }, docxOf(complaint))).body.material
    await prof.put(`${caseUrl()}/materials/initial`).send({ materialId: file.id })
    await transcriptionsSettled()
    await suggestions()
    await witnessSuggestionsSettled()
    expect(asked[0]?.complaint).toBe(complaint)
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
    fakeSuggest([{ name: 'Logan Crest', role: 'Friend', description: '', alignedSide: null }])
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

describe('suggested text for the case', () => {
  const fields: CaseSuggestions = {
    disputedIssues: 'Whether Elena Torres checked the lap bars; how long the train was stopped',
    investigatorNotes: 'Focus on the restart. Talk to the other riders.',
    instructorNote: 'Focus on what the operator knew before the restart.',
    tasks: [{ title: 'Outline Elena Torres’s deposition', description: 'List the topics and exhibits.' }],
  }

  it('comes from the same single read of the complaint as the witnesses, made again when the file changes', async () => {
    expect(await content()).toEqual({ status: 'none' })
    const asked = fakeSuggest([{ name: 'Elena Torres', role: 'Ride operator', description: '', alignedSide: 'defense' }], fields)
    const file = (await uploadCaseFile(prof, caseUrl(), 'Complaint.txt', { audience: 'all' }, Buffer.from(complaint))).body.material
    await prof.put(`${caseUrl()}/materials/initial`).send({ materialId: file.id })
    await transcriptionsSettled()
    expect(await content()).toEqual({ status: 'waiting' })
    await witnessSuggestionsSettled()
    expect(await content()).toEqual({ status: 'ready', suggestions: fields })
    expect((await suggestions()).suggestions.map((s: { name: string }) => s.name)).toEqual(['Elena Torres'])
    // One call made both, and asking again doesn't call again.
    await content()
    await suggestions()
    await witnessSuggestionsSettled()
    expect(asked).toHaveLength(1)

    // Renaming the parties doesn't read the complaint again.
    await prof.patch(caseUrl()).send({ title: 'Winston v. Thrillville', summary: 'x', status: 'draft', plaintiffName: 'P. Winston', defendantName: 'Thrillville' })
    expect(await content()).toEqual({ status: 'ready', suggestions: fields })
    await witnessSuggestionsSettled()
    expect(asked).toHaveLength(1)

    // Done with the witnesses, the fields' suggestions stay.
    await prof.post(`${caseUrl()}/witness-suggestions/done`)
    expect(await content()).toEqual({ status: 'ready', suggestions: fields })

    // A new initial file: read again, once.
    const other = (await uploadCaseFile(prof, caseUrl(), 'Amended.txt', { audience: 'all' }, Buffer.from('An amended complaint.'))).body.material
    await prof.put(`${caseUrl()}/materials/initial`).send({ materialId: other.id })
    await transcriptionsSettled()
    expect(await content()).toEqual({ status: 'waiting' })
    await witnessSuggestionsSettled()
    expect(asked).toHaveLength(2)
    expect(asked[1].complaint).toBe('An amended complaint.')

    await prof.put(`${caseUrl()}/materials/initial`).send({ materialId: null })
    expect(await content()).toEqual({ status: 'none' })
  })

  it('gives nothing when the AI fails, and never reaches students', async () => {
    ai.suggestFromComplaint = async () => {
      throw new Error('overloaded')
    }
    const file = (await uploadCaseFile(prof, caseUrl(), 'Complaint.txt', { audience: 'all' }, Buffer.from(complaint))).body.material
    await prof.put(`${caseUrl()}/materials/initial`).send({ materialId: file.id })
    await transcriptionsSettled()
    await content()
    await witnessSuggestionsSettled()
    expect(await content()).toEqual({ status: 'none' })
    expect((await suggestions()).status).toBe('failed')

    const student = (await signedInAgent('student', 's1@example.com', 'Ada Lawyer')).agent
    expect((await student.get(`${caseUrl()}/content-suggestions`)).status).toBe(404)
  })
})

describe('reading the suggestions', () => {
  it('keeps one witness per name, maps the side, trims, and keeps each field within its limit', async () => {
    const { suggestFromComplaint } = await import('./suggest.ts')
    const client = {
      messages: {
        create: async () =>
          ({
            content: [
              {
                type: 'tool_use',
                name: 'suggest_case_setup',
                input: {
                  disputedIssues: ' x '.repeat(1500),
                  investigatorNotes: ' Talk to the riders. ',
                  instructorNote: 'Focus on the restart.',
                  tasks: [1, 2, 3, 4].map((n) => ({ title: `Task ${n}`, description: 'Do it.' })).concat({ title: '', description: 'No title.' }),
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
    const result = await suggestFromComplaint(client, { caseTitle: 'W v. T', plaintiffName: 'W', defendantName: 'T', complaint: 'x' })
    expect(result.witnesses).toEqual([
      { name: 'Paige Winston', role: 'Rider', description: 'Hurt.', alignedSide: 'plaintiff' },
      { name: 'The ride operator', role: 'Operator', description: 'At the controls.', alignedSide: null },
    ])
    // The case's fields, each within what it holds.
    expect(result.content.disputedIssues.length).toBeLessThanOrEqual(2000)
    expect(result.content.investigatorNotes).toBe('Talk to the riders.')
    expect(result.content.tasks.map((t) => t.title)).toEqual(['Task 1', 'Task 2', 'Task 3'])
  })
})
