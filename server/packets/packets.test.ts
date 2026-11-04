import type request from 'supertest'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { transcriptionsSettled } from '../courses/materialText.ts'
import { pool } from '../db/pool.ts'
import { storage } from '../storage/storage.ts'
import { createCourseAs, resetDatabase, sampleFacts, signedInAgent, uploadCaseFile } from '../test/helpers.ts'
import { safeName } from './packets.ts'

let prof: request.Agent
let ada: request.Agent // plaintiff, Team 1
let cy: request.Agent // defense, Team 2
let course: { id: string }
let caseId: string
let teams: { id: string }[]
let complaint: string
let tom: string // a defense witness
let paige: string // a plaintiff witness

const email = (n: number) => `s${n}@example.com`
const caseUrl = () => `/api/courses/${course.id}/cases/${caseId}`
const exhibitsUrl = () => `/api/courses/${course.id}/my-cases/${caseId}/exhibits`
const FOLDER_1 = 'World A - Team 1 (Plaintiff)'
const FOLDER_2 = 'World A - Team 2 (Defense)'

async function upload(filename: string, audience: string, data?: Buffer) {
  const id = (await uploadCaseFile(prof, caseUrl(), filename, { audience }, data)).body.material.id as string
  await transcriptionsSettled()
  return id
}

async function addWitness(name: string, side: string) {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO case_witnesses (case_id, name, aligned_side) VALUES ($1, $2, $3) RETURNING id`,
    [caseId, name, side],
  )
  return rows[0].id
}

/** An interview with `answers`, ended (and sent for review) unless `discarded` or `open`. */
async function addInterview(witnessId: string, team: number, side: string, answers: string[], how: 'reviewed' | 'discarded' | 'open' = 'reviewed') {
  const { rows: [interview] } = await pool.query<{ id: string }>(
    `INSERT INTO interviews (witness_id, team_id, side, ended_at) VALUES ($1, $2, $3, $4) RETURNING id`,
    [witnessId, teams[team - 1].id, side, how === 'open' ? null : new Date()],
  )
  for (const [position, answer] of answers.entries()) {
    await pool.query(
      `INSERT INTO interview_turns (interview_id, position, question, reply, answer, model) VALUES ($1, $2, $3, $4, $4, 'test')`,
      [interview.id, position, `Question about ${answer}`, answer],
    )
  }
  if (how !== 'reviewed') return { interview: interview.id, review: null }
  const { rows: [review] } = await pool.query<{ id: string; matchup_id: string }>(
    `INSERT INTO interview_reviews (case_id, interview_id, witness_id, team_id, team_number, world_number, matchup_id, side, status, completed_at)
     SELECT $1, $2, $3, $4, $5, 1, mt.matchup_id, $6, 'completed', now() FROM matchup_teams mt WHERE mt.team_id = $4
     RETURNING id`,
    [caseId, interview.id, witnessId, teams[team - 1].id, team, side],
  )
  return { interview: interview.id, review: review.id }
}

async function addFact(review: string, text: string, decision: string, links: unknown = null) {
  await pool.query(`INSERT INTO review_facts (review_id, position, text, decision, links) VALUES ($1, 0, $2, $3, $4)`, [review, text, decision, links])
}

/** An investigator report for team 2, with a fact ruled for the world. */
async function addReport(text: string, fact?: string) {
  const { rows: [r] } = await pool.query<{ id: string }>(
    `INSERT INTO interview_reviews (case_id, team_id, team_number, world_number, matchup_id, side, kind, status, assignment, final_report, completed_at)
     SELECT $1, $2, 2, 1, mt.matchup_id, 'defense', 'investigation', 'completed', 'Look into the plaintiff.', $3, now()
     FROM matchup_teams mt WHERE mt.team_id = $2 RETURNING id`,
    [caseId, teams[1].id, text],
  )
  if (fact) await addFact(r.id, fact, 'accept_world')
}

/** The files in a zip of stored (uncompressed) entries, by path. */
function readZip(zip: Buffer) {
  let end = zip.length - 22
  while (zip.readUInt32LE(end) !== 0x06054b50) end--
  let at = zip.readUInt32LE(end + 16)
  const files = new Map<string, Buffer>()
  for (let n = zip.readUInt16LE(end + 10); n > 0; n--) {
    const size = zip.readUInt32LE(at + 24)
    const nameLength = zip.readUInt16LE(at + 28)
    const extra = zip.readUInt16LE(at + 30)
    const comment = zip.readUInt16LE(at + 32)
    const offset = zip.readUInt32LE(at + 42)
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength)
    const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28)
    files.set(name, zip.subarray(start, start + size))
    at += 46 + nameLength + extra + comment
  }
  return files
}

async function pdfText(data: Buffer) {
  const doc = await getDocument({ data: new Uint8Array(data), useSystemFonts: true }).promise
  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const { items } = await (await doc.getPage(i)).getTextContent()
    pages.push(items.map((item) => ('str' in item ? item.str : '')).join(' '))
  }
  return pages.join('\n')
}

async function download(path = 'download') {
  const res = await prof
    .get(`${caseUrl()}/packets/${path}`)
    .buffer(true)
    .parse((r, done) => {
      const chunks: Buffer[] = []
      r.on('data', (c: Buffer) => chunks.push(c))
      r.on('end', () => done(null, Buffer.concat(chunks)))
    })
  return { res, files: res.status === 200 ? readZip(res.body as Buffer) : new Map<string, Buffer>() }
}

const paths = (files: Map<string, Buffer>, folder: string) =>
  [...files.keys()].filter((p) => p.startsWith(`${folder}/`)).map((p) => p.slice(folder.length + 1)).sort()

const toFinalSteps = () => prof.put(`${caseUrl()}/phase`).send({ phase: 'final_steps' })

beforeEach(async () => {
  await resetDatabase()
  prof = (await signedInAgent('instructor', 'prof@example.com', 'Prof. Ruiz')).agent
  course = await createCourseAs(prof)
  await prof.post(`/api/courses/${course.id}/roster`).send({ emails: [1, 2, 3, 4].map(email) })
  ada = (await signedInAgent('student', email(1), 'Ada Lawyer')).agent
  cy = (await signedInAgent('student', email(3), 'Cy Counsel')).agent
  caseId = (
    await prof.post(`/api/courses/${course.id}/cases`).send({ title: 'Ramirez v. Thrillville', summary: 'A harness opened.', importantFacts: sampleFacts })
  ).body.case.id
  await prof.post(`${caseUrl()}/teams`).send({ emails: [email(1), email(2)] })
  teams = (await prof.post(`${caseUrl()}/teams`).send({ emails: [email(3), email(4)] })).body.teams
  await prof.post(`${caseUrl()}/matchups`).send({ plaintiffTeamId: teams[0].id, defenseTeamId: teams[1].id })
  complaint = await upload('Amended complaint.pdf', 'all')
  await prof.put(`${caseUrl()}/materials/initial`).send({ materialId: complaint })
  const launched = await prof.post(`${caseUrl()}/launch`)
  if (launched.status !== 200) throw new Error(JSON.stringify(launched.body))
  tom = await addWitness('Tom Becker', 'defense')
  paige = await addWitness('Paige Turner', 'plaintiff')
})

afterAll(async () => {
  await pool.end()
})

describe('who can get trial packets', () => {
  it('opens in the final steps phase', async () => {
    expect((await prof.get(`${caseUrl()}/packets`)).status).toBe(409)
    expect((await prof.get(`${caseUrl()}/packets/download`)).status).toBe(409)
    expect((await toFinalSteps()).status).toBe(200)
    expect((await prof.get(`${caseUrl()}/packets`)).status).toBe(200)
  })

  it('is for the instructor who teaches the course', async () => {
    await toFinalSteps()
    const other = (await signedInAgent('instructor', 'other@example.com')).agent
    expect((await ada.get(`${caseUrl()}/packets/download`)).status).toBe(404)
    expect((await other.get(`${caseUrl()}/packets/download`)).status).toBe(404)
  })
})

describe('what a packet holds', () => {
  it('gives each team both teams’ depositions, but not prep interviews or ones thrown away', async () => {
    await addInterview(tom, 1, 'plaintiff', ['the red light'])
    await addInterview(paige, 2, 'defense', ['the waiver'], 'open')
    await addInterview(tom, 1, 'plaintiff', ['a false start'], 'discarded')
    await addInterview(paige, 1, 'plaintiff', ['our own prep'])
    await toFinalSteps()

    const { res, files } = await download()
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/zip')
    for (const folder of [FOLDER_1, FOLDER_2]) {
      const depositions = paths(files, folder).filter((p) => p.startsWith('2 Depositions/'))
      expect(depositions).toEqual([
        expect.stringMatching(/^2 Depositions\/Paige Turner - Team 2 - /),
        expect.stringMatching(/^2 Depositions\/Tom Becker - Team 1 - /),
      ])
    }
    const transcript = await pdfText(files.get(`${FOLDER_2}/${paths(files, FOLDER_2).find((p) => p.includes('Tom Becker'))}`)!)
    expect(transcript).toContain('Deposition of Tom Becker')
    expect(transcript).toContain('Taken by Team 1 (Plaintiff)')
    expect(transcript).toContain('the red light')
  })

  it('marks testimony resting on a denied fact as struck, and says why', async () => {
    const { review } = await addInterview(tom, 1, 'plaintiff', ['the light was red', 'he was on his phone'])
    await addFact(review!, 'The operator was on his phone.', 'deny_world', { producedBy: [1], builtOn: [] })
    await toFinalSteps()

    const { files } = await download()
    const name = paths(files, FOLDER_1).find((p) => p.includes('Tom Becker'))!
    const transcript = await pdfText(files.get(`${FOLDER_1}/${name}`)!)
    expect(transcript).toContain('he was on his phone')
    expect(transcript).toContain('Struck: states a denied fact: The operator was on his phone.')
  })

  it('gives a team the files it can see, and no one else’s', async () => {
    await upload('Medical records.pdf', 'plaintiff')
    await upload('Incident report.pdf', 'defense')
    await upload('Secret deposition.pdf', 'instructor')
    await toFinalSteps()

    const { files } = await download()
    expect(paths(files, FOLDER_1).filter((p) => p.startsWith('3 '))).toEqual(['3 Case file/Amended complaint.pdf', '3 Case file/Medical records.pdf'])
    expect(paths(files, FOLDER_2).filter((p) => p.startsWith('3 '))).toEqual(['3 Case file/Amended complaint.pdf', '3 Case file/Incident report.pdf'])
    expect(files.get(`${FOLDER_1}/3 Case file/Amended complaint.pdf`)!.toString()).toBe('%PDF-1.7 test')
  })

  it('keeps a team’s investigator reports, and the facts from them, from the other team', async () => {
    await addReport('The plaintiff skipped the safety video.', 'She skipped the video.')
    const { review } = await addInterview(tom, 1, 'plaintiff', ['the light was red'])
    await addFact(review!, 'The light was red.', 'accept_world')
    await toFinalSteps()

    const { files } = await download()
    expect(paths(files, FOLDER_1).some((p) => p.startsWith('4 '))).toBe(false)
    const report = paths(files, FOLDER_2).find((p) => p.startsWith('4 Investigator reports/'))!
    expect(await pdfText(files.get(`${FOLDER_2}/${report}`)!)).toContain('skipped the safety video')

    const plaintiffFacts = await pdfText(files.get(`${FOLDER_1}/6 Ruled facts.pdf`)!)
    expect(plaintiffFacts).toContain('The light was red.')
    expect(plaintiffFacts).not.toContain('She skipped the video.')
    const defenseFacts = await pdfText(files.get(`${FOLDER_2}/6 Ruled facts.pdf`)!)
    expect(defenseFacts).toContain('The light was red.')
    expect(defenseFacts).toContain('She skipped the video.')
  })

  it('includes the discovery a team sent and received, without the AI mentor’s feedback', async () => {
    await prof.put(`${caseUrl()}/exchange`).send({
      disclosures: { enabled: false },
      interrogatories: { enabled: true, limit: 5, days: 7, aiFeedback: { enabled: false, rounds: 2 } },
      rfas: { enabled: false, limit: 5, days: 7 },
      subpoenas: { enabled: false, limit: 5, days: 7 },
      firms: { plaintiff: { firm: 'A', partner: 'B' }, defense: { firm: 'C', partner: 'D' } },
    })
    await prof.post(`${caseUrl()}/exchange/complete`)
    await prof.put(`${caseUrl()}/phase`).send({ phase: 'information_exchange' })
    const sent = await ada.post(`/api/courses/${course.id}/my-cases/${caseId}/exchange/requests`).send({ kind: 'interrogatories', items: ['Who ran the ride?'] })
    expect(sent.status).toBe(201)
    await pool.query(`UPDATE exchange_requests SET check_tag = 'NEEDS_IMPROVEMENT', check_feedback = 'Mentor secret', check_current = true`)
    const { rows: [set] } = await pool.query<{ id: string }>('SELECT id FROM exchange_requests')
    const answered = await cy
      .post(`/api/courses/${course.id}/my-cases/${caseId}/exchange/requests/${set.id}/responses`)
      .send({ responses: [{ position: 1, answer: 'Tom Becker did.' }] })
    expect(answered.status).toBe(200)
    await toFinalSteps()

    const { files } = await download()
    for (const folder of [FOLDER_1, FOLDER_2]) {
      const text = await pdfText(files.get(`${folder}/5 Discovery/Interrogatories from Team 1 to Team 2.pdf`)!)
      expect(text).toContain('Who ran the ride?')
      expect(text).toContain('Answer: Tom Becker did.')
      expect(text).not.toContain('Mentor secret')
    }
  })

  it('holds the admitted exhibits and the joint list, not what was kept out', async () => {
    await toFinalSteps()
    const item = { kind: 'material', id: complaint, parts: null }
    expect((await ada.post(`${exhibitsUrl()}/list/submit`).send({ items: [item] })).status).toBe(200)
    expect((await cy.post(`${exhibitsUrl()}/list/submit`).send({ items: [item] })).status).toBe(200)

    const { files } = await download()
    const exhibits = paths(files, FOLDER_2).filter((p) => p.startsWith('1 Exhibits/'))
    expect(exhibits).toEqual(['1 Exhibits/Joint exhibit list.pdf', '1 Exhibits/Plaintiff 1 - Amended complaint.pdf'])
    const list = await pdfText(files.get(`${FOLDER_2}/1 Exhibits/Joint exhibit list.pdf`)!)
    expect(list).toContain('Amended complaint')
    expect(list).toContain('Admitted')
  })

  it('renders an excerpt of a text exhibit, never the whole source', async () => {
    await addInterview(tom, 1, 'plaintiff', ['the light was red', 'keep this out'])
    await toFinalSteps()
    const plaintiff = (await ada.get(exhibitsUrl())).body.exhibits
    const deposition = plaintiff.options.find((o: { kind: string }) => o.kind === 'deposition')
    await ada.post(`${exhibitsUrl()}/list/submit`).send({ items: [{ kind: 'deposition', id: deposition.id, parts: [0] }] })
    await cy.post(`${exhibitsUrl()}/list/submit`).send({ items: [] })
    await pool.query(`UPDATE exhibits SET status = 'admitted'`)

    const { files } = await download()
    const name = paths(files, FOLDER_1).find((p) => p.startsWith('1 Exhibits/Plaintiff'))!
    const text = await pdfText(files.get(`${FOLDER_1}/${name}`)!)
    expect(text).toContain('the light was red')
    expect(text).not.toContain('keep this out')
  })
})

describe('downloading', () => {
  it('gives one team’s packet on its own', async () => {
    await toFinalSteps()
    const { res, files } = await download(`${teams[0].id}/download`)
    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toContain('World A - Team 1 (Plaintiff) - Trial packet.zip')
    expect(paths(files, FOLDER_1)).toContain('Contents.pdf')
    expect(paths(files, FOLDER_2)).toEqual([])
  })

  it('404s for a team that isn’t in the case', async () => {
    await toFinalSteps()
    expect((await download('00000000-0000-4000-8000-000000000000/download')).res.status).toBe(404)
    expect((await download('nope/download')).res.status).toBe(404)
  })

  it('leaves out a file it can’t read and says so, keeping the rest', async () => {
    await upload('Medical records.pdf', 'plaintiff')
    const { rows: [lost] } = await pool.query<{ storage_key: string }>(`SELECT storage_key FROM case_materials WHERE filename = 'Medical records.pdf'`)
    await storage.delete([lost.storage_key])
    await toFinalSteps()

    const { files } = await download()
    expect(paths(files, FOLDER_1)).toContain('3 Case file/Amended complaint.pdf')
    expect(paths(files, FOLDER_1)).not.toContain('3 Case file/Medical records.pdf')
    expect(await pdfText(files.get(`${FOLDER_1}/Contents.pdf`)!)).toContain('included: 3 Case file/Medical records.pdf')
  })

  it('tells the instructor what isn’t finished', async () => {
    await addInterview(paige, 2, 'defense', ['the waiver'], 'open')
    await toFinalSteps()
    const { packets } = (await prof.get(`${caseUrl()}/packets`)).body
    expect(packets.map((p: { teamNumber: number; side: string }) => `${p.teamNumber} ${p.side}`)).toEqual(['1 plaintiff', '2 defense'])
    expect(packets[0]).toMatchObject({ worldNumber: 1, depositions: 1, files: 1, exhibits: 0, members: ['Ada Lawyer', email(2)] })
    expect(packets[0].warnings).toEqual(['The joint exhibit list isn’t final.', '1 deposition is still open or under review.'])
  })
})

describe('safeName', () => {
  it('keeps a name inside its folder', () => {
    expect(safeName('../../etc/passwd')).toBe('etc passwd')
    expect(safeName('C:\\files\\a?.pdf')).toBe('C files a .pdf')
    expect(safeName('...')).toBe('Untitled')
  })
})
