import type { Response } from 'express'
import { ZipArchive } from 'archiver'
import { findMaterialFile, findMaterialText, listMaterialsFor, type CaseMaterial } from '../courses/caseContent.ts'
import type { CourseCase } from '../courses/cases.ts'
import type { Side } from '../courses/matchups.ts'
import { listTeams, worldLetter } from '../courses/teams.ts'
import { pool } from '../db/pool.ts'
import { listCaseRequests, type ExchangeRequest } from '../exchange/exchange.ts'
import { subpoenaNotices, teamSubpoenas, type SubpoenaNotice, type TeamSubpoena } from '../exchange/subpoenas.ts'
import { exhibitFile, findExhibitSource, type TextPart } from '../exhibits/exhibitFiles.ts'
import { investigatorFileIds, listCaseExhibits, type Exhibit, type ExhibitList, type ExhibitStatus, type WorldExhibits } from '../exhibits/exhibits.ts'
import { HttpError } from '../httpError.ts'
import { markedTranscript, type MarkedTurn } from '../reviews/reviews.ts'
import { attachmentHeader } from '../storage/shared.ts'
import { storage } from '../storage/storage.ts'
import { mergedPdf } from './packetPdf.ts'
import { TextPdf } from './textPdf.ts'

// The trial packets, the course's last step: once the case reaches final
// steps, the instructor downloads a zip with a folder for each team, and a
// team downloads its own once it has submitted its exhibit list. A packet has
// the world's exhibits, every deposition taken in the world (both teams', as
// in real litigation, with testimony resting on a denied fact marked as
// struck), and what the team itself gathered: its case file, investigator
// reports, discovery, and the facts it can rely on. A packet goes to the team,
// so it holds nothing the team couldn't see or wouldn't be served with: never
// the other team's investigator reports, prep interviews, or subpoena results,
// the AI mentor's feedback, or instructor-only files.
//
// The same packet can come as one PDF for court, holding what the team or the
// instructor chose from it, with a table of contents (see packetPdf.ts).

const SIDE_LABEL: Record<Side, string> = { plaintiff: 'Plaintiff', defense: 'Defense' }

const EXHIBIT_STATUS: Record<ExhibitStatus, string> = {
  awaiting_authenticity: 'Waiting on the other side (authenticity)',
  authenticity_review: 'Waiting on a ruling (authenticity)',
  inauthentic: 'Not authentic',
  awaiting_admission: 'Waiting on the other side (admission)',
  objection_response: 'Objected to, waiting on a response',
  admission_review: 'Waiting on a ruling (admission)',
  dropped: 'Dropped',
  admitted: 'Admitted',
  excluded: 'Excluded',
}

const REQUEST_TYPE: Record<string, string> = {
  documents: 'Documents or electronically stored information',
  tangible_things: 'Tangible things',
  inspection: 'Inspection of premises',
}

const ADMISSION = { agree: 'Admitted', disagree: 'Denied', partial: 'Admitted in part' }

const longDay = (date: Date) => date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const shortDay = (date: Date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** A name that's safe as one part of a path in the zip, on any computer. */
export function safeName(name: string) {
  const clean = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120)
    .trim()
  return clean || 'Untitled'
}

const EXTENSION = /\.[a-z0-9]{1,5}$/i
const extensionOf = (name: string) => EXTENSION.exec(name)?.[0] ?? ''

interface PacketTeam {
  id: string
  number: number
  side: Side
  members: string[]
  matchupId: string
  worldNumber: number
  opponent: { id: string; number: number }
}

/** The teams in a full case world, in world order, the plaintiff first. */
async function packetTeams(courseId: string, caseId: string): Promise<PacketTeam[]> {
  const { teams, matchups } = await listTeams(courseId, caseId)
  const out: PacketTeam[] = []
  for (const m of matchups) {
    const plaintiff = teams.find((t) => t.id === m.plaintiffTeamId)
    const defense = teams.find((t) => t.id === m.defenseTeamId)
    if (!plaintiff || !defense) continue
    for (const [team, side, opponent] of [[plaintiff, 'plaintiff', defense], [defense, 'defense', plaintiff]] as const) {
      out.push({
        id: team.id,
        number: team.number,
        side,
        members: team.members.map((s) => s.name ?? s.email),
        matchupId: m.id,
        worldNumber: m.number,
        opponent: { id: opponent.id, number: opponent.number },
      })
    }
  }
  return out
}

// Depositions -----------------------------------------------------------------

interface Deposition {
  id: string
  witness: string
  witnessRole: string
  teamNumber: number
  side: Side
  takenAt: Date
  ended: boolean
  reviewId: string | null
  reviewStatus: string | null
}

/**
 * The depositions taken in a world: a team questioning a witness for the other
 * side, with answers. Interviews a team threw away with "Start over" aren't
 * kept: only those it ended (sent for review), or is still in.
 */
async function worldDepositions(caseId: string, teamIds: string[]) {
  const { rows } = await pool.query<Deposition>(
    `SELECT i.id, w.name AS witness, w.role AS "witnessRole", t.number AS "teamNumber", i.side,
            i.created_at AS "takenAt", i.ended_at IS NOT NULL AS ended, r.id AS "reviewId", r.status AS "reviewStatus"
     FROM interviews i
     JOIN case_witnesses w ON w.id = i.witness_id
     JOIN teams t ON t.id = i.team_id
     LEFT JOIN interview_reviews r ON r.interview_id = i.id AND r.kind = 'interview'
     WHERE w.case_id = $1 AND i.team_id = ANY($2)
       AND w.aligned_side IS NOT NULL AND w.aligned_side <> i.side
       AND EXISTS (SELECT 1 FROM interview_turns x WHERE x.interview_id = i.id)
       AND (i.ended_at IS NULL OR r.id IS NOT NULL)
     ORDER BY i.created_at`,
    [caseId, teamIds],
  )
  return rows
}

/** The turns of a deposition, marked as the rulings so far stand. */
async function depositionTurns(d: Deposition): Promise<{ turns: MarkedTurn[]; marked: boolean }> {
  if (d.reviewId) return markedTranscript(d.reviewId)
  const { rows } = await pool.query<Omit<MarkedTurn, 'struck' | 'reasons'>>(
    `SELECT t.position, t.question, t.objection, t.answer, u.name AS "askedBy"
     FROM interview_turns t LEFT JOIN users u ON u.id = t.asked_by
     WHERE t.interview_id = $1 ORDER BY t.position`,
    [d.id],
  )
  return { turns: rows.map((t) => ({ ...t, struck: null, reasons: [] })), marked: true }
}

/** The lawyer's objection, which usually starts with the word already. */
const objectionLine = (text: string) => (/^objection/i.test(text) ? text : `Objection: ${text}`)

const strikeNote = (t: MarkedTurn) =>
  t.reasons.map((r) => `Struck: ${r.kind === 'produced' ? 'states' : 'built on'} a denied fact: ${r.fact}`).join('\n')

async function depositionPdf(courseCase: CourseCase, team: PacketTeam, d: Deposition) {
  const { turns, marked } = await depositionTurns(d)
  const pdf = await TextPdf.create(`Deposition of ${d.witness} · ${courseCase.title}`)
  pdf.title(`Deposition of ${d.witness}`)
  if (d.witnessRole) pdf.text(d.witnessRole)
  pdf.text(courseCase.title).text(`Case world ${worldLetter(team.worldNumber)}`)
  pdf.text(`Taken by Team ${d.teamNumber} (${SIDE_LABEL[d.side]}) on ${longDay(d.takenAt)}`)
  if (!d.ended) pdf.text('This deposition was still open when the packet was made.', { gray: true })
  else if (d.reviewStatus !== 'completed') pdf.text("The instructor hasn't finished ruling on this deposition's new facts.", { gray: true })
  else if (!marked) pdf.text('This deposition was reviewed before exchanges were tied to rulings, so nothing is marked as struck.', { gray: true })
  if (turns.some((t) => t.struck)) pdf.text('Struck exchanges rest on a fact the instructor denied.', { gray: true })
  pdf.space(10)
  turns.forEach((t, i) => {
    pdf.text(`Q${i + 1}. ${t.question}`, { bold: true, struck: t.struck !== null })
    if (t.askedBy) pdf.text(`Asked by ${t.askedBy}`, { size: 9, gray: true, indent: 14 })
    if (t.objection) pdf.text(objectionLine(t.objection), { indent: 14 })
    pdf.text(`A. ${t.answer}`, { struck: t.struck === 'all' })
    if (t.struck) pdf.text(strikeNote(t), { size: 9.5, gray: true, indent: 14 })
    pdf.space(8)
  })
  return pdf.save()
}

// Exhibits --------------------------------------------------------------------

const exhibitName = (x: Exhibit) => `${SIDE_LABEL[x.offeredBy]}${x.label ? ` ${x.label}` : ''}`

/** The joint exhibit list: every exhibit in the world, where it ended up, and why. */
async function exhibitListPdf(courseCase: CourseCase, team: PacketTeam, world: WorldExhibits) {
  const pdf = await TextPdf.create(`Joint exhibit list · ${courseCase.title}`)
  pdf.title('Joint exhibit list').text(courseCase.title)
  pdf.text(`Case world ${worldLetter(team.worldNumber)}: Team ${world.teams.plaintiff} (Plaintiff) v. Team ${world.teams.defense} (Defense)`)
  pdf.text(world.finalizedAt ? `Final as of ${longDay(world.finalizedAt)}` : 'Not final yet: some exhibits are still open.', { gray: true })
  for (const side of ['plaintiff', 'defense'] as const) {
    const exhibits = world.exhibits.filter((x) => x.offeredBy === side && !x.supersededBy)
    pdf.heading(`${SIDE_LABEL[side]}’s exhibits`)
    if (exhibits.length === 0) pdf.text('None.', { gray: true })
    for (const x of exhibits) {
      pdf.text(`${x.label ? `${x.label}. ` : ''}${x.title}${x.joint ? ' (joint)' : ''}`, { bold: true })
      pdf.text(`${EXHIBIT_STATUS[x.status]}${x.redacted ? ', with a redaction' : ''}`, { indent: 14 })
      const notes = [
        ['Authenticity challenge', x.authenticityNote],
        ['Ruling on authenticity', x.authenticityRulingNote],
        ['Objection', x.objection],
        ['Response', x.response],
        ['Ruling', x.rulingNote],
        ['Redaction', x.redaction],
      ] as const
      for (const [label, note] of notes) if (note) pdf.text(`${label}: ${note}`, { indent: 14, size: 10 })
      pdf.space(5)
    }
  }
  return pdf.save()
}

/** The team's own list, until the other side's is in: no exhibits exist yet, and the other side's list stays private. */
async function teamListPdf(courseCase: CourseCase, team: PacketTeam, list: ExhibitList) {
  const pdf = await TextPdf.create(`Exhibit list · ${courseCase.title}`)
  pdf.title(`Team ${team.number}’s exhibit list`).text(courseCase.title)
  pdf.text(`${SIDE_LABEL[team.side]}, case world ${worldLetter(team.worldNumber)}`)
  pdf.text(`Submitted ${longDay(list.submittedAt!)}. The other side’s list isn’t in yet, so nothing has been exchanged or ruled on.`, { gray: true }).space(10)
  if (list.items.length === 0) pdf.text('None.', { gray: true })
  list.items.forEach((item, i) => pdf.text(`${i + 1}. ${item.title}`))
  return pdf.save()
}

/** An exhibit that's text: a transcript's turns, or a report's or text file's paragraphs, as admitted. */
async function excerptPdf(courseCase: CourseCase, x: Exhibit) {
  const pdf = await TextPdf.create(`${exhibitName(x)} · ${courseCase.title}`)
  pdf.title(`${exhibitName(x)}: ${x.title}`)
  if (x.redacted) pdf.text('Admitted with a redaction.', { gray: true })
  pdf.space(10)
  for (const part of (x.excerpt ?? []) as TextPart[]) {
    if (part.question !== undefined) {
      pdf.text(`Q. ${part.question}`, { bold: true })
      if (part.objection) pdf.text(objectionLine(part.objection), { indent: 14 })
      pdf.text(`A. ${part.text}`)
    } else pdf.text(part.text)
    pdf.space(8)
  }
  return pdf.save()
}

/** A file that isn't a PDF or a picture, printed from its text (a Word file's, say). */
async function textFilePdf(courseCase: CourseCase, title: string, text: string) {
  const pdf = await TextPdf.create(`${title} · ${courseCase.title}`)
  pdf.title(title).text(text)
  return pdf.save()
}

/** PDFs and the pictures a PDF can hold go in the single PDF as they are. */
const PRINTS_AS_IS = /^(application\/pdf|image\/(png|jpe?g))/i
/** Other pictures, audio, and video have no pages, and a transcript of one isn't the file. */
const NO_PAGES = /^(image|audio|video)\//i

/** How an admitted exhibit goes in the packet: only what was admitted of it, never the whole source. */
async function admittedExhibit(courseCase: CourseCase, matchupId: string, x: Exhibit) {
  const source = await findExhibitSource(x.id, { matchupId })
  if (!source.materialId || (x.excerpt && !source.admittedKey)) return { extension: '.pdf', load: () => excerptPdf(courseCase, x), print: undefined }
  const file = await exhibitFile(source)
  const { textContent } = source
  // The source's text is the whole file, so it can't stand in for a redacted copy.
  const whole = !source.admittedKey && !source.offeredKey
  const print = PRINTS_AS_IS.test(file.contentType)
    ? undefined
    : whole && textContent && !NO_PAGES.test(file.contentType)
      ? () => textFilePdf(courseCase, `${exhibitName(x)}: ${x.title}`, textContent)
      : null
  return { extension: extensionOf(file.filename), load: file.read, print }
}

// What the team gathered --------------------------------------------------------

interface Report {
  id: string
  assignment: string
  askedBy: string | null
  report: string
  completedAt: Date | null
  createdAt: Date
}

async function teamReports(caseId: string, teamId: string) {
  const { rows } = await pool.query<Report>(
    `SELECT r.id, r.assignment, u.name AS "askedBy", r.final_report AS report, r.completed_at AS "completedAt", r.created_at AS "createdAt"
     FROM interview_reviews r LEFT JOIN users u ON u.id = r.asked_by
     WHERE r.case_id = $1 AND r.team_id = $2 AND r.kind = 'investigation' AND r.status = 'completed' AND r.final_report IS NOT NULL
     ORDER BY r.created_at`,
    [caseId, teamId],
  )
  return rows
}

async function reportPdf(courseCase: CourseCase, r: Report, n: number) {
  const pdf = await TextPdf.create(`${courseCase.investigator.name}’s report · ${courseCase.title}`)
  pdf.title(`${courseCase.investigator.name}’s report ${n}`).text(courseCase.title)
  pdf.text(`Returned ${longDay(r.completedAt ?? r.createdAt)}`, { gray: true })
  pdf.heading('The assignment')
  if (r.askedBy) pdf.text(`From ${r.askedBy}`, { gray: true, size: 10 })
  pdf.text(r.assignment ?? '')
  pdf.heading('The report').text(r.report)
  return pdf.save()
}

async function requestPdf(courseCase: CourseCase, r: ExchangeRequest, title: string) {
  const pdf = await TextPdf.create(`${title} · ${courseCase.title}`)
  pdf.title(title).text(courseCase.title)
  pdf.text(`Sent ${longDay(r.sentAt)}${r.sentBy ? ` by ${r.sentBy}` : ''}, due ${longDay(r.dueAt)}`, { gray: true })
  pdf.text(r.respondedAt ? `Answered ${longDay(r.respondedAt)}${r.respondedBy ? ` by ${r.respondedBy}` : ''}` : 'Not answered.', { gray: true }).space(10)
  r.items.forEach((item, i) => {
    pdf.text(`${i + 1}. ${item.text}`, { bold: true })
    if (r.respondedAt && r.kind === 'rfas') {
      if (item.admission) pdf.text(`Response: ${ADMISSION[item.admission]}`, { indent: 14 })
      if (item.agreePart) pdf.text(`Admitted: ${item.agreePart}`, { indent: 14 })
      if (item.disagreePart) pdf.text(`Denied: ${item.disagreePart}`, { indent: 14 })
    } else if (r.respondedAt) pdf.text(`${item.objection ? 'Objection' : 'Answer'}: ${item.answer ?? ''}`, { indent: 14 })
    pdf.space(8)
  })
  return pdf.save()
}

async function subpoenaPdf(courseCase: CourseCase, s: TeamSubpoena) {
  const pdf = await TextPdf.create(`Subpoena to ${s.recipient} · ${courseCase.title}`)
  pdf.title(`Subpoena to ${s.recipient}`).text(courseCase.title)
  pdf.text(`Served ${longDay(s.sentAt)}${s.sentBy ? ` by ${s.sentBy}` : ''}`, { gray: true })
  if (s.recipientDescription) pdf.heading('The recipient').text(s.recipientDescription)
  pdf.heading('What it asks for').text(REQUEST_TYPE[s.requestType] ?? s.requestType, { bold: true }).text(s.records)
  pdf.heading('Justification').text(s.justification)
  pdf.heading('The answer')
  if (!s.outcome) pdf.text('Not answered.', { gray: true })
  else if (s.outcome === 'denied') pdf.text('Denied.').text(s.response ?? '')
  else {
    if (s.documents.length > 0) pdf.text(`Files produced (in the case file): ${s.documents.map((d) => d.title).join('; ')}`)
    if (s.response) pdf.text(s.response)
  }
  return pdf.save()
}

async function noticesPdf(courseCase: CourseCase, notices: SubpoenaNotice[]) {
  const pdf = await TextPdf.create(`Subpoena notices · ${courseCase.title}`)
  pdf.title('Notices of the other side’s subpoenas').text(courseCase.title).space(10)
  for (const n of notices) {
    pdf.text(`To ${n.recipient}, served by Team ${n.teamNumber} on ${longDay(n.sentAt)}`, { bold: true })
    pdf.text(REQUEST_TYPE[n.requestType] ?? n.requestType, { indent: 14 }).text(n.records, { indent: 14 }).space(8)
  }
  return pdf.save()
}

interface RuledFact {
  text: string
  accepted: boolean
  source: string
}

/**
 * The facts a team can rely on: those ruled for every world, and in its own
 * world those from its own interviews and investigator or from a deposition
 * the other team took. The other team's investigator and prep interviews
 * stay out, though they're settled for the world too.
 */
async function teamFacts(caseId: string, team: PacketTeam) {
  const { rows } = await pool.query<RuledFact>(
    `SELECT f.text, f.decision LIKE 'accept%' AS accepted,
            CASE WHEN f.decision LIKE '%\\_case' AND r.matchup_id IS DISTINCT FROM $2 THEN 'Ruled for all worlds'
                 WHEN r.kind = 'investigation' THEN 'Investigation, Team ' || r.team_number
                 WHEN w.aligned_side <> r.side THEN 'Deposition of ' || w.name || ', Team ' || r.team_number
                 ELSE 'Interview of ' || coalesce(w.name, 'a witness') || ', Team ' || r.team_number END AS source
     FROM review_facts f
     JOIN interview_reviews r ON r.id = f.review_id
     LEFT JOIN case_witnesses w ON w.id = r.witness_id
     WHERE r.case_id = $1 AND r.status = 'completed' AND f.decision IS NOT NULL
       AND (f.decision LIKE '%\\_case'
            OR (r.matchup_id = $2 AND (r.team_id = $3 OR (r.kind = 'interview' AND w.aligned_side <> r.side))))
     ORDER BY r.completed_at, f.position`,
    [caseId, team.matchupId, team.id],
  )
  return rows
}

async function factsPdf(courseCase: CourseCase, team: PacketTeam, facts: RuledFact[]) {
  const pdf = await TextPdf.create(`Ruled facts · ${courseCase.title}`)
  pdf.title('Ruled facts').text(courseCase.title).text(`Case world ${worldLetter(team.worldNumber)}`).space(4)
  pdf.text('New facts from the depositions and investigation, as the instructor ruled on them.', { gray: true })
  for (const [heading, accepted] of [['Accepted', true], ['Denied', false]] as const) {
    const list = facts.filter((f) => f.accepted === accepted)
    if (list.length === 0) continue
    pdf.heading(heading)
    for (const f of list) pdf.text(f.text).text(f.source, { size: 9.5, gray: true, indent: 14 }).space(4)
  }
  return pdf.save()
}

// The packet ------------------------------------------------------------------

interface Entry {
  /** Stays the same from one download to the next, so a team's choices keep. */
  id: string
  /** Where it's listed in the single PDF. */
  section: string
  title: string
  /** Within the team's folder. */
  path: string
  load(): Promise<Uint8Array>
  /** Its pages in the single PDF; null when it has none, like a video. */
  print: (() => Promise<Uint8Array>) | null
}

interface Packet {
  team: PacketTeam
  folder: string
  entries: Entry[]
  counts: { exhibits: number; depositions: number; files: number; reports: number; discovery: number }
  warnings: string[]
  /** The top of the first page: whose packet it is, and what isn't finished. */
  cover(pdf: TextPdf, unreadable: string[]): void
  contents(unreadable: string[]): Promise<Uint8Array>
}

/** Adds an entry under its own path (two files can share a name). It prints as it loads unless `print` says otherwise. */
function addEntry(
  entries: Entry[],
  path: string,
  load: Entry['load'],
  { print = load, ...item }: Pick<Entry, 'id' | 'section' | 'title'> & { print?: Entry['print'] },
) {
  const extension = extensionOf(path)
  const base = path.slice(0, path.length - extension.length)
  let unique = path
  for (let n = 2; entries.some((e) => e.path.toLowerCase() === unique.toLowerCase()); n++) unique = `${base} (${n})${extension}`
  entries.push({ ...item, path: unique, load, print })
}

async function materialBytes(caseId: string, id: string) {
  const file = await findMaterialFile(caseId, id)
  if (!file) throw new Error('The file is gone.')
  return file.storageKey ? storage.read(file.storageKey) : file.data!
}

/** Which folder of the case file a file goes in. */
function fileFolder(m: CaseMaterial, fromInvestigator: Set<string>) {
  if (m.source === 'subpoena') return '3 Case file/Subpoena responses'
  return fromInvestigator.has(m.id) ? '3 Case file/From the investigator' : '3 Case file'
}

/** How a case file prints: as it is, from its text, or not at all. */
function filePrint(courseCase: CourseCase, m: CaseMaterial, load: Entry['load']): Entry['print'] {
  if (PRINTS_AS_IS.test(m.contentType)) return load
  if (NO_PAGES.test(m.contentType) || m.textStatus !== 'ready') return null
  return async () => textFilePdf(courseCase, m.filename, (await findMaterialText(courseCase.id, m.id))?.text ?? '')
}

interface Shared {
  worlds: Map<string, WorldExhibits>
  requests: ExchangeRequest[]
}

async function buildPacket(courseCase: CourseCase, team: PacketTeam, viewerId: string, { worlds, requests }: Shared): Promise<Packet> {
  const caseId = courseCase.id
  const [depositions, materials, investigatorFiles, reports, subpoenas, notices, facts] = await Promise.all([
    worldDepositions(caseId, [team.id, team.opponent.id]),
    listMaterialsFor(caseId, { side: team.side, teamId: team.id, matchupId: team.matchupId }),
    investigatorFileIds(pool, team.id),
    teamReports(caseId, team.id),
    teamSubpoenas(caseId, team.id, viewerId),
    subpoenaNotices(caseId, team.id, viewerId),
    teamFacts(caseId, team),
  ])
  const entries: Entry[] = []

  const world = worlds.get(team.matchupId)
  const admitted = world?.exhibits.filter((x) => x.status === 'admitted' && !x.supersededBy) ?? []
  const myList = world?.[team.side]
  if (world && myList?.submittedAt && !world[team.side === 'plaintiff' ? 'defense' : 'plaintiff'].submittedAt) {
    addEntry(entries, '1 Exhibits/Team exhibit list.pdf', () => teamListPdf(courseCase, team, myList), {
      id: 'exhibit-list',
      section: 'Exhibits',
      title: `Team ${team.number}’s exhibit list`,
    })
  }
  if (world && world.exhibits.length > 0) {
    addEntry(entries, '1 Exhibits/Joint exhibit list.pdf', () => exhibitListPdf(courseCase, team, world), {
      id: 'exhibit-list',
      section: 'Exhibits',
      title: 'Joint exhibit list',
    })
    for (const x of admitted) {
      const { extension, load, print } = await admittedExhibit(courseCase, team.matchupId, x)
      addEntry(entries, `1 Exhibits/${safeName(`${exhibitName(x)} - ${x.title.replace(EXTENSION, '')}`)}${extension}`, load, {
        id: `exhibit:${x.id}`,
        section: 'Exhibits',
        title: `${exhibitName(x)}: ${x.title}`,
        print,
      })
    }
  }

  for (const d of depositions) {
    const name = safeName(`${d.witness} - Team ${d.teamNumber} - ${shortDay(d.takenAt)}`)
    addEntry(entries, `2 Depositions/${name}.pdf`, () => depositionPdf(courseCase, team, d), {
      id: `deposition:${d.id}`,
      section: 'Depositions',
      title: `${d.witness}, taken by Team ${d.teamNumber} on ${longDay(d.takenAt)}`,
    })
  }

  for (const m of materials) {
    const load = () => materialBytes(caseId, m.id)
    addEntry(entries, `${fileFolder(m, investigatorFiles)}/${safeName(m.filename)}`, load, {
      id: `file:${m.id}`,
      section: 'Case file',
      title: m.filename,
      print: filePrint(courseCase, m, load),
    })
  }

  reports.forEach((r, i) => {
    const returned = r.completedAt ?? r.createdAt
    addEntry(entries, `4 Investigator reports/Report ${i + 1} - ${shortDay(returned)}.pdf`, () => reportPdf(courseCase, r, i + 1), {
      id: `report:${r.id}`,
      section: 'Investigator reports',
      title: `Report ${i + 1}, returned ${longDay(returned)}`,
    })
  })

  const sets = requests
    .filter((r) => r.fromTeam.id === team.id || r.toTeam.id === team.id)
    .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())
  for (const r of sets) {
    const title = `${r.kind === 'rfas' ? 'Requests for admission' : 'Interrogatories'} from Team ${r.fromTeam.number} to Team ${r.toTeam.number}`
    addEntry(entries, `5 Discovery/${title}.pdf`, () => requestPdf(courseCase, r, title), { id: `request:${r.id}`, section: 'Discovery', title })
  }
  for (const s of [...subpoenas].reverse()) {
    const title = `Subpoena to ${s.recipient}`
    addEntry(entries, `5 Discovery/${safeName(title)}.pdf`, () => subpoenaPdf(courseCase, s), { id: `subpoena:${s.id}`, section: 'Discovery', title })
  }
  if (notices.length > 0) {
    addEntry(entries, '5 Discovery/Notices of the other side’s subpoenas.pdf', () => noticesPdf(courseCase, notices), {
      id: 'notices',
      section: 'Discovery',
      title: 'Notices of the other side’s subpoenas',
    })
  }

  if (facts.length > 0) addEntry(entries, '6 Ruled facts.pdf', () => factsPdf(courseCase, team, facts), { id: 'facts', section: 'Ruled facts', title: 'Ruled facts' })

  const underReview = depositions.filter((d) => !d.ended || d.reviewStatus !== 'completed').length
  const warnings = [
    ...(courseCase.exhibitListEnabled && !world?.finalizedAt ? ['The joint exhibit list isn’t final.'] : []),
    ...(underReview > 0 ? [`${underReview} ${underReview === 1 ? 'deposition is' : 'depositions are'} still open or under review.`] : []),
  ]

  const cover: Packet['cover'] = (pdf, unreadable) => {
    pdf.title('Trial packet').text(courseCase.title, { bold: true })
    pdf.text(`Team ${team.number} (${SIDE_LABEL[team.side]}), case world ${worldLetter(team.worldNumber)}, against Team ${team.opponent.number}`)
    if (team.members.length > 0) pdf.text(team.members.join(', '))
    pdf.text(`Made ${longDay(new Date())}`, { gray: true })
    if (warnings.length > 0 || unreadable.length > 0) {
      pdf.heading('Not finished')
      for (const w of warnings) pdf.text(w)
      for (const path of unreadable) pdf.text(`Couldn’t be included: ${path}`)
    }
  }

  return {
    team,
    folder: safeName(`World ${worldLetter(team.worldNumber)} - Team ${team.number} (${SIDE_LABEL[team.side]})`),
    entries,
    counts: {
      exhibits: admitted.length,
      depositions: depositions.length,
      files: materials.length,
      reports: reports.length,
      discovery: sets.length + subpoenas.length,
    },
    warnings,
    cover,
    async contents(unreadable) {
      const pdf = await TextPdf.create(`Trial packet · ${courseCase.title}`)
      cover(pdf, unreadable)
      pdf.heading('What’s in this packet')
      for (const e of entries) if (!unreadable.includes(e.path)) pdf.text(e.path, { size: 10 })
      return pdf.save()
    },
  }
}

async function buildPackets(courseId: string, courseCase: CourseCase, viewerId: string, teamId?: string) {
  const teams = await packetTeams(courseId, courseCase.id)
  const chosen = teamId ? teams.filter((t) => t.id === teamId) : teams
  if (teamId && chosen.length === 0) throw new HttpError(404, 'Team not found.')
  const [worlds, requests] = await Promise.all([listCaseExhibits(courseCase.id), listCaseRequests(courseCase.id)])
  const shared = { worlds: new Map(worlds.map((w) => [w.matchupId, w])), requests }
  return Promise.all(chosen.map((t) => buildPacket(courseCase, t, viewerId, shared)))
}

/** What each team's packet holds so far. Matches `TrialPacket` in src/courses/types.ts. */
export async function packetOverview(courseId: string, courseCase: CourseCase, viewerId: string) {
  const packets = await buildPackets(courseId, courseCase, viewerId)
  return packets.map((p) => ({
    teamId: p.team.id,
    teamNumber: p.team.number,
    side: p.team.side,
    worldNumber: p.team.worldNumber,
    members: p.team.members,
    ...p.counts,
    warnings: p.warnings,
  }))
}

/** Whether a team has submitted its exhibit list, which opens its packet to it. */
export async function packetOpen(matchupId: string, side: Side) {
  const { rowCount } = await pool.query('SELECT 1 FROM exhibit_lists WHERE matchup_id = $1 AND side = $2 AND submitted_at IS NOT NULL', [matchupId, side])
  return Boolean(rowCount)
}

/** What can go in a team's PDF. Matches `PacketContents` in src/courses/types.ts. */
export async function packetContents(courseId: string, courseCase: CourseCase, viewerId: string, teamId: string) {
  const [[packet], { rows }] = await Promise.all([
    buildPackets(courseId, courseCase, viewerId, teamId),
    pool.query<{ leftOut: string[] }>('SELECT packet_left_out AS "leftOut" FROM teams WHERE id = $1', [teamId]),
  ])
  return {
    items: packet.entries.map((e) => ({ id: e.id, section: e.section, title: e.title, printable: e.print !== null })),
    leftOut: rows[0]?.leftOut ?? [],
    warnings: packet.warnings,
  }
}

/** Keeps what a team left out of its PDF. */
export async function savePacketChoices(teamId: string, leftOut: string[]) {
  await pool.query('UPDATE teams SET packet_left_out = $2 WHERE id = $1', [teamId, leftOut])
}

/** One team's packet as a single PDF, without what's in `leftOut`. */
export async function sendPacketPdf(res: Response, courseId: string, courseCase: CourseCase, viewerId: string, teamId: string, leftOut: string[]) {
  const [packet] = await buildPackets(courseId, courseCase, viewerId, teamId)
  const out = new Set(leftOut)
  const parts = packet.entries.flatMap((e) => (e.print && !out.has(e.id) ? [{ section: e.section, title: e.title, print: e.print }] : []))
  if (parts.length === 0) throw new HttpError(400, 'Choose at least one thing for the PDF.')
  const pdf = await mergedPdf(`Trial packet · ${courseCase.title}`, parts, packet.cover)
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': attachmentHeader(`${safeName(courseCase.title)} - ${packet.folder} - Trial packet.pdf`),
  })
  res.send(Buffer.from(pdf))
}

/**
 * Streams the packets as a zip, one file at a time so the largest case file
 * is all that's held in memory. A file that can't be read is left out and
 * named in the packet's contents, so one bad file doesn't cost the rest.
 */
export async function sendPackets(res: Response, courseId: string, courseCase: CourseCase, viewerId: string, teamId?: string) {
  const packets = await buildPackets(courseId, courseCase, viewerId, teamId)
  if (packets.length === 0) throw new HttpError(409, 'This case has no case worlds yet.')
  const name = teamId ? `${packets[0].folder} - Trial packet.zip` : 'Trial packets.zip'
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': attachmentHeader(`${safeName(courseCase.title)} - ${name}`) })

  // Case files are PDFs, pictures, and video, already compressed.
  const zip = new ZipArchive({ store: true })
  let gone = false
  const closed = new Promise<void>((resolve) => {
    res.once('close', () => {
      gone = true
      resolve()
    })
  })
  zip.on('error', (err) => res.destroy(err))
  zip.pipe(res)

  /** Adds a file, waiting until it's written so the next one isn't read too soon. */
  const add = (path: string, data: Uint8Array) =>
    new Promise<void>((resolve) => {
      zip.once('entry', () => resolve())
      void closed.then(resolve)
      zip.append(Buffer.from(data), { name: path })
    })

  for (const packet of packets) {
    const unreadable: string[] = []
    for (const entry of packet.entries) {
      if (gone) return void zip.abort()
      try {
        await add(`${packet.folder}/${entry.path}`, await entry.load())
      } catch (err) {
        console.error(`Could not add ${entry.path} to a trial packet:`, err)
        unreadable.push(entry.path)
      }
    }
    await add(`${packet.folder}/Contents.pdf`, await packet.contents(unreadable))
  }
  await zip.finalize()
}
