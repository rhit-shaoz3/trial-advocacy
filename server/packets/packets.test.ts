import type request from 'supertest'
import { PDFArray, PDFDict, PDFDocument, PDFName, degrees } from 'pdf-lib'
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

/** The body of a download, as bytes. */
const bytes = (req: request.Test) =>
  req.buffer(true).parse((r, done) => {
    const chunks: Buffer[] = []
    r.on('data', (c: Buffer) => chunks.push(c))
    r.on('end', () => done(null, Buffer.concat(chunks)))
  })

async function download(path = 'download') {
  const res = await bytes(prof.get(`${caseUrl()}/packets/${path}`))
  return { res, files: res.status === 200 ? readZip(res.body as Buffer) : new Map<string, Buffer>() }
}

/** A PDF that can be opened, with `pages` pages. */
async function realPdf(pages = 1, rotate = 0) {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]).setRotation(degrees(rotate))
  return Buffer.from(await doc.save())
}

const myPacketUrl = () => `/api/courses/${course.id}/my-cases/${caseId}/packet`

/** Takes the case to final steps with a final joint exhibit list. */
async function finishList() {
  await toFinalSteps()
  await ada.post(`${exhibitsUrl()}/list/submit`).send({ items: [] })
  await cy.post(`${exhibitsUrl()}/list/submit`).send({ items: [] })
  await pool.query('UPDATE exhibit_lists SET finalized_at = now()')
}

interface PacketItem {
  id: string
  title: string
  printable: boolean
}

const itemId = (items: PacketItem[], title: string) => items.find((i) => i.title.startsWith(title))!.id

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

  it('holds a disputed exhibit, marked for the judge at trial', async () => {
    await addInterview(tom, 1, 'plaintiff', ['the light was red'])
    await toFinalSteps()
    const deposition = (await ada.get(exhibitsUrl())).body.exhibits.options.find((o: { kind: string }) => o.kind === 'deposition')
    await ada.post(`${exhibitsUrl()}/list/submit`).send({ items: [{ kind: 'deposition', id: deposition.id, parts: [0] }] })
    await cy.post(`${exhibitsUrl()}/list/submit`).send({ items: [] })
    await pool.query(`UPDATE exhibits SET status = 'disputed', label = '1'`)

    const { files } = await download()
    const name = paths(files, FOLDER_1).find((p) => p.startsWith('1 Exhibits/Plaintiff 1'))!
    expect(name).toContain('(disputed)')
    expect(await pdfText(files.get(`${FOLDER_1}/${name}`)!)).toContain('Disputed: the judge rules on it at trial.')
    expect(await pdfText(files.get(`${FOLDER_1}/1 Exhibits/Joint exhibit list.pdf`)!)).toContain('Disputed, for the judge at trial')
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

describe('the single PDF', () => {
  const contentsOf = async (team = 0) => (await prof.get(`${caseUrl()}/packets/${teams[team].id}/contents`)).body.contents
  const pdfOf = (leftOut: string[] = [], team = 0) =>
    bytes(prof.get(`${caseUrl()}/packets/${teams[team].id}/pdf`).query(leftOut.length ? { leftOut: leftOut.join(',') } : {}))

  it('holds what was chosen behind a table of contents, numbered through the whole PDF', async () => {
    await upload('Waiver.pdf', 'all', await realPdf(3))
    await upload('Medical records.pdf', 'plaintiff', await realPdf(2))
    await addInterview(tom, 1, 'plaintiff', ['the light was red'])
    await pool.query(`DELETE FROM case_materials WHERE id = $1`, [complaint])
    await toFinalSteps()

    const { items } = await contentsOf()
    const res = await pdfOf([itemId(items, 'Medical records')])
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/pdf')
    expect(res.headers['content-disposition']).toContain('World A - Team 1 (Plaintiff) - Trial packet.pdf')

    const text = await pdfText(res.body as Buffer)
    expect(text).toContain('Table of contents')
    expect(text).toContain('Waiver.pdf')
    expect(text).toContain('Tom Becker, taken by Team 1')
    expect(text).toContain('the light was red')
    expect(text).not.toContain('Medical records')
    // The first page, the deposition, and the three pages of the waiver.
    const doc = await PDFDocument.load(res.body as Buffer)
    expect(doc.getPageCount()).toBe(5)
    expect(text).toContain('Packet page 5 of 5')
    const [, waiverLine] = /Waiver\.pdf[ .]*(\d+)/.exec(text)!
    expect(waiverLine).toBe('3')
  })

  it('links each line of the table of contents to its page', async () => {
    await upload('Waiver.pdf', 'all', await realPdf(2))
    await pool.query(`DELETE FROM case_materials WHERE id = $1`, [complaint])
    await toFinalSteps()

    const doc = await PDFDocument.load((await pdfOf()).body as Buffer)
    const [first, target] = doc.getPages()
    const annots = first.node.Annots()!
    expect(annots.size()).toBe(1)
    const link = doc.context.lookup(annots.get(0), PDFDict)
    expect(link.lookup(PDFName.of('Dest'), PDFArray).get(0)).toBe(target.ref)
  })

  it('stamps a turned page along the foot its reader sees', async () => {
    await upload('Sideways.pdf', 'all', await realPdf(1, 90))
    await pool.query(`DELETE FROM case_materials WHERE id = $1`, [complaint])
    await toFinalSteps()

    const doc = await getDocument({ data: new Uint8Array((await pdfOf()).body as Buffer), useSystemFonts: true }).promise
    const page = await doc.getPage(2)
    const { items } = await page.getTextContent()
    const stamp = items.find((i) => 'str' in i && i.str.startsWith('Packet page'))
    if (!stamp || !('transform' in stamp)) throw new Error('No stamp.')
    // Read upright: the page's own x axis runs up the turned page.
    const [, , , , x] = stamp.transform as number[]
    expect(x).toBeGreaterThan(590)
  })

  it('puts a picture on a page, prints a text file, and keeps video to the zip', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    )
    await upload('Scene.png', 'all', png)
    await upload('Notes.docx', 'all', Buffer.from('word'))
    await upload('Ride.mp4', 'all', Buffer.from('video'))
    await pool.query(`DELETE FROM case_materials WHERE id = $1`, [complaint])
    await pool.query(
      `UPDATE case_materials SET content_type = CASE filename WHEN 'Scene.png' THEN 'image/png' WHEN 'Ride.mp4' THEN 'video/mp4' ELSE content_type END`,
    )
    await pool.query(`UPDATE case_materials SET text_status = 'ready', text_content = 'The operator skipped the checklist.' WHERE filename <> 'Scene.png'`)
    await toFinalSteps()

    const { items } = await contentsOf()
    expect(items.map((i: PacketItem) => [i.title, i.printable])).toEqual([
      ['Scene.png', true],
      ['Notes.docx', true],
      ['Ride.mp4', false],
    ])
    const res = await pdfOf()
    const text = await pdfText(res.body as Buffer)
    expect(text).toContain('The operator skipped the checklist.')
    expect(text).not.toContain('Ride.mp4')
    expect((await PDFDocument.load(res.body as Buffer)).getPageCount()).toBe(3)
  })

  it('prints a redacted copy, never the whole file’s text', async () => {
    await upload('Notes.docx', 'all', Buffer.from('word'))
    await pool.query(`UPDATE case_materials SET text_status = 'ready', text_content = 'The secret part.' WHERE filename = 'Notes.docx'`)
    const { rows: [notes] } = await pool.query<{ id: string }>(`SELECT id FROM case_materials WHERE filename = 'Notes.docx'`)
    await toFinalSteps()
    await ada.post(`${exhibitsUrl()}/list/submit`).send({ items: [{ kind: 'material', id: notes.id, parts: null }] })
    await cy.post(`${exhibitsUrl()}/list/submit`).send({ items: [] })
    // A copy of a kind that can't be printed, so all that's left to print is the source's text.
    await pool.query(
      `UPDATE exhibits x SET status = 'admitted', admitted_key = m.storage_key, admitted_content_type = 'application/octet-stream'
       FROM case_materials m WHERE m.id = x.material_id`,
    )
    await pool.query(`DELETE FROM case_materials WHERE id = $1`, [complaint])

    const { items } = await contentsOf()
    const exhibit = items.find((i: PacketItem) => i.id.startsWith('exhibit:'))
    expect(exhibit.printable).toBe(false)
    const out = items.filter((i: PacketItem) => i.id === 'exhibit-list' || i.id.startsWith('file:')).map((i: PacketItem) => i.id)
    expect((await pdfOf(out)).status).toBe(400)
  })

  it('leaves out a file it can’t read and names it on the first page', async () => {
    // The complaint from `beforeEach` isn't a real PDF.
    await upload('Waiver.pdf', 'all', await realPdf(1))
    await toFinalSteps()
    const text = await pdfText((await pdfOf()).body as Buffer)
    expect(text).toContain('included: Amended complaint.pdf')
    expect(text).toContain('Waiver.pdf')
  })

  it('needs something in it', async () => {
    await toFinalSteps()
    const { items } = await contentsOf()
    expect((await pdfOf(items.map((i: PacketItem) => i.id))).status).toBe(400)
  })
})

describe('a team’s own packet', () => {
  it('opens once the team submits its list, before the other side does', async () => {
    await toFinalSteps()
    expect((await ada.get(myPacketUrl())).body.contents).toBeNull()
    expect((await ada.get(`${myPacketUrl()}/download`)).status).toBe(409)
    expect((await ada.get(`${myPacketUrl()}/pdf`)).status).toBe(409)
    expect((await ada.put(`${myPacketUrl()}/choices`).send({ leftOut: [] })).status).toBe(409)

    await ada.post(`${exhibitsUrl()}/list/submit`).send({ items: [{ kind: 'material', id: complaint, parts: null }] })
    const { contents } = (await ada.get(myPacketUrl())).body
    expect(contents.warnings).toContain('The joint exhibit list isn’t final.')
    expect((await bytes(ada.get(`${myPacketUrl()}/download`))).status).toBe(200)
    expect((await cy.get(myPacketUrl())).body.contents).toBeNull()
    expect((await cy.get(`${myPacketUrl()}/download`)).status).toBe(409)
  })

  it('holds the team’s own list until the other side’s is in, then the joint list', async () => {
    const waiver = await upload('Waiver.pdf', 'all', await realPdf(1))
    await toFinalSteps()
    await ada.post(`${exhibitsUrl()}/list/submit`).send({ items: [{ kind: 'material', id: complaint, parts: null }] })
    await cy.put(`${exhibitsUrl()}/list`).send({ items: [{ kind: 'material', id: waiver, parts: null }] })

    const zip = readZip((await bytes(ada.get(`${myPacketUrl()}/download`))).body as Buffer)
    expect(paths(zip, FOLDER_1).filter((p) => p.startsWith('1 Exhibits/'))).toEqual(['1 Exhibits/Team exhibit list.pdf'])
    const list = await pdfText(zip.get(`${FOLDER_1}/1 Exhibits/Team exhibit list.pdf`)!)
    expect(list).toContain('Amended complaint')
    expect(list).not.toContain('Waiver')

    await cy.post(`${exhibitsUrl()}/list/submit`).send({ items: [{ kind: 'material', id: waiver, parts: null }] })
    const after = readZip((await bytes(ada.get(`${myPacketUrl()}/download`))).body as Buffer)
    expect(paths(after, FOLDER_1)).toContain('1 Exhibits/Joint exhibit list.pdf')
    expect(paths(after, FOLDER_1)).not.toContain('1 Exhibits/Team exhibit list.pdf')
  })

  it('gives each team its own, as a zip', async () => {
    await addReport('The plaintiff skis.')
    await finishList()
    const zip = async (agent: request.Agent) => readZip((await bytes(agent.get(`${myPacketUrl()}/download`))).body as Buffer)
    const mine = await zip(ada)
    expect(paths(mine, FOLDER_1)).toContain('Contents.pdf')
    expect(paths(mine, FOLDER_2)).toEqual([])
    expect(paths(mine, FOLDER_1).some((p) => p.startsWith('4 Investigator reports'))).toBe(false)
    expect(paths(await zip(cy), FOLDER_2).some((p) => p.startsWith('4 Investigator reports'))).toBe(true)
  })

  it('keeps out students who aren’t on a team in the case', async () => {
    await finishList()
    const stranger = (await signedInAgent('student', 'stranger@example.com', 'Stranger')).agent
    expect((await stranger.get(`${myPacketUrl()}/pdf`)).status).toBe(409)
  })

  it('remembers what the team left out, for teammates and the instructor', async () => {
    await upload('Waiver.pdf', 'all', await realPdf(1))
    await finishList()
    const { items } = (await ada.get(myPacketUrl())).body.contents
    const waiver = itemId(items, 'Waiver')
    expect((await ada.put(`${myPacketUrl()}/choices`).send({ leftOut: [waiver] })).status).toBe(204)

    const teammate = (await signedInAgent('student', email(2), 'Ben Brief')).agent
    expect((await teammate.get(myPacketUrl())).body.contents.leftOut).toEqual([waiver])
    expect((await prof.get(`${caseUrl()}/packets/${teams[0].id}/contents`)).body.contents.leftOut).toEqual([waiver])
    expect((await cy.get(myPacketUrl())).body.contents.leftOut).toEqual([])
  })

  it('doesn’t take junk for choices, or save on a closed case', async () => {
    await finishList()
    expect((await ada.put(`${myPacketUrl()}/choices`).send({ leftOut: 'all' })).status).toBe(400)
    await pool.query(`UPDATE cases SET status = 'closed' WHERE id = $1`, [caseId])
    expect((await ada.put(`${myPacketUrl()}/choices`).send({ leftOut: [] })).status).toBe(409)
    expect((await ada.get(myPacketUrl())).body.contents).not.toBeNull()
  })
})

describe('safeName', () => {
  it('keeps a name inside its folder', () => {
    expect(safeName('../../etc/passwd')).toBe('etc passwd')
    expect(safeName('C:\\files\\a?.pdf')).toBe('C files a .pdf')
    expect(safeName('...')).toBe('Untitled')
  })
})
