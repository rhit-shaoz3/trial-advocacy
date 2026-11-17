import { ai, AiNotConfiguredError } from '../ai/ai.ts'
import { listMaterialsFor, listMaterialTexts, listWitnesses, type Witness } from '../courses/caseContent.ts'
import type { ImportantFacts, InteractionLimit } from '../courses/cases.ts'
import type { Side } from '../courses/matchups.ts'
import { finishPendingTranscriptions } from '../courses/materialText.ts'
import { pool } from '../db/pool.ts'
import { HttpError } from '../httpError.ts'
import { matchTitles } from '../investigator/investigate.ts'
import { extractMadeFiles, type MadeFile } from '../investigator/records.ts'
import { completeReport, layOutReport, reportRulings } from '../reviews/reportReview.ts'
import { settledFacts } from '../reviews/reviews.ts'
import type { ClientContext, ClientDocument, PriorEmail } from './prompt.ts'

// A team's emails to its clients: the witnesses the instructor marked as its
// side's clients, who answer together as one client. The team writes; in the
// background the AI writes the clients' reply, attaching files they have and
// writing out documents they'd really keep that the case file didn't. The
// reply is reviewed like an investigator's report (an interview_reviews row
// of kind 'client_email'), and the team gets the clean copy with the files
// the instructor allowed. In review lite it comes straight back. The
// instructor limits how many emails each team (or student) can send.

export const MAX_SUBJECT_LENGTH = 200
export const MAX_BODY_LENGTH = 4000

/** Who's writing: the student's team, in its case world. */
export interface ClientEmailContext {
  caseId: string
  teamId: string
  matchupId: string
  side: Side
  teamNumber: number
  worldNumber: number
  userId: string
  /** How many emails the team (or each student) can send. */
  limit: InteractionLimit
}

// Shape sent to students; matches `ClientEmail` in src/courses/types.ts.
export interface ClientEmail {
  id: string
  /** The clients it went to, by name. */
  to: string[]
  subject: string
  body: string
  /** The student who sent it. */
  from: string | null
  /** Whether this student sent it (for a per-student limit). */
  mine: boolean
  sentAt: Date
  /** working: with the clients or the instructor; completed: the reply is back. */
  status: 'working' | 'completed'
  repliedAt: Date | null
  /** The clean reply, once completed. */
  reply: string | null
  /** Files the reply attached (also in the team's case file); `auto` when review lite allowed them. */
  attachments: { id: string; title: string; filename: string; contentType: string; sizeBytes: number; auto: boolean }[]
  /** The facts the reply stated that stand, once completed, for flagging the ones decided automatically. */
  facts: { id: string; text: string; auto: boolean }[]
  /** Whether this student has read the reply. */
  seen: boolean
}

/** The side's clients: witnesses marked as clients who testify for it (and that students can see). */
export const clientsOf = (witnesses: Witness[], side: Side) =>
  witnesses.filter((w) => w.isClient && !w.hidden && w.alignedSide === side)

/** The team's emails, newest first. Students never see the clients' draft or the rulings. */
export async function teamClientEmails(caseId: string, teamId: string, userId: string): Promise<ClientEmail[]> {
  const { rows } = await pool.query<ClientEmail>(
    `SELECT r.id,
            coalesce((SELECT array_agg(w.name ORDER BY w.created_at) FROM case_witnesses w
                      WHERE w.id = ANY(r.to_witness_ids)), '{}') AS "to",
            coalesce(r.subject, '') AS subject, r.assignment AS body,
            (SELECT u.name FROM users u WHERE u.id = r.asked_by) AS "from",
            r.asked_by IS NOT DISTINCT FROM $3 AS mine, r.created_at AS "sentAt",
            CASE WHEN r.status = 'completed' THEN 'completed' ELSE 'working' END AS status,
            r.completed_at AS "repliedAt",
            CASE WHEN r.status = 'completed' THEN r.final_report END AS reply,
            CASE WHEN r.status = 'completed' THEN coalesce((
              SELECT json_agg(json_build_object('id', m.id, 'title', coalesce(nullif(m.description, ''), m.filename),
                                                'filename', m.filename, 'contentType', m.content_type,
                                                'sizeBytes', m.size_bytes, 'auto', d.auto)
                              ORDER BY d.position)
              FROM review_documents d JOIN case_materials m ON m.id = d.material_id
              WHERE d.review_id = r.id AND d.decision = 'allow'), '[]') ELSE '[]' END AS attachments,
            CASE WHEN r.status = 'completed' THEN coalesce((
              SELECT json_agg(json_build_object('id', f.id, 'text', f.text, 'auto', f.auto) ORDER BY f.position)
              FROM review_facts f WHERE f.review_id = r.id AND f.decision LIKE 'accept%'), '[]') ELSE '[]' END AS facts,
            EXISTS (SELECT 1 FROM review_seen s WHERE s.review_id = r.id AND s.user_id = $3) AS seen
     FROM interview_reviews r
     WHERE r.case_id = $1 AND r.team_id = $2 AND r.kind = 'client_email'
     ORDER BY r.created_at DESC`,
    [caseId, teamId, userId],
  )
  return rows
}

/** How many emails count against the limit: the team's, or for a per-student limit this student's. */
async function emailsUsed(ctx: ClientEmailContext) {
  const { rows } = await pool.query<{ used: number }>(
    `SELECT count(*)::int AS used FROM interview_reviews
     WHERE case_id = $1 AND team_id = $2 AND kind = 'client_email' AND ($3::uuid IS NULL OR asked_by = $3)`,
    [ctx.caseId, ctx.teamId, ctx.limit.per === 'student' ? ctx.userId : null],
  )
  return rows[0].used
}

function readEmail(body: unknown, clients: Witness[]) {
  const fields = (body ?? {}) as Record<string, unknown>
  const subject = typeof fields.subject === 'string' ? fields.subject.trim() : ''
  const text = typeof fields.body === 'string' ? fields.body.trim() : ''
  if (!subject) throw new HttpError(400, 'Give the email a subject.')
  if (subject.length > MAX_SUBJECT_LENGTH) throw new HttpError(400, `Keep the subject to ${MAX_SUBJECT_LENGTH} characters.`)
  if (!text) throw new HttpError(400, 'Write your email first.')
  if (text.length > MAX_BODY_LENGTH) throw new HttpError(400, `Keep the email to ${MAX_BODY_LENGTH} characters.`)
  const to = fields.to ?? []
  if (!Array.isArray(to) || to.some((id) => !clients.some((c) => c.id === id))) {
    throw new HttpError(400, 'Choose whom to send it to from your clients.')
  }
  // To no one in particular means all of them.
  return { subject, text, to: to.length ? [...new Set(to as string[])] : clients.map((c) => c.id) }
}

/**
 * Sends the team's email `{ to, subject, body }` to its clients. One at a
 * time: the last reply must be back first. (That also keeps partners from
 * both sending the last one the limit allows.)
 */
export async function sendClientEmail(ctx: ClientEmailContext, body: unknown) {
  const clients = clientsOf(await listWitnesses(ctx.caseId), ctx.side)
  if (clients.length === 0) throw new HttpError(409, 'Your side has no client to email in this case.')
  const email = readEmail(body, clients)
  if ((await emailsUsed(ctx)) >= ctx.limit.max) {
    const times = ctx.limit.max === 1 ? 'email' : `${ctx.limit.max} emails`
    throw new HttpError(
      409,
      ctx.limit.per === 'student' ? `You've used your ${times} to your client.` : `Your team has used its ${times} to your client.`,
    )
  }
  try {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO interview_reviews
         (kind, case_id, team_id, matchup_id, team_number, world_number, side, assignment, subject, to_witness_ids, asked_by)
       VALUES ('client_email', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [ctx.caseId, ctx.teamId, ctx.matchupId, ctx.teamNumber, ctx.worldNumber, ctx.side, email.text, email.subject, email.to, ctx.userId],
    )
    queueClientEmail(rows[0].id)
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new HttpError(409, 'Your team is still waiting on a reply to its last email. It has to come back first.')
    }
    throw err
  }
  return teamClientEmails(ctx.caseId, ctx.teamId, ctx.userId)
}

const running = new Map<string, Promise<void>>()

/** Starts an email's next step in the background: the clients' reply, or the team's clean copy. Does nothing for other reviews. */
export function queueClientEmail(id: string) {
  if (running.has(id)) return
  const run = advance(id).finally(() => running.delete(id))
  running.set(id, run)
}

/** Picks up emails a server restart interrupted (the work runs in memory). */
export async function resumeClientEmails() {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM interview_reviews WHERE kind = 'client_email' AND status IN ('summarizing', 'finalizing')`,
  )
  for (const { id } of rows) queueClientEmail(id)
}

/** Resolves once every email running now has finished (for tests). */
export async function clientEmailsSettled() {
  while (running.size) await Promise.all(running.values())
}

async function advance(id: string) {
  const { rows } = await pool.query<{ status: string }>(
    `SELECT status FROM interview_reviews WHERE id = $1 AND kind = 'client_email'`,
    [id],
  )
  if (rows[0]?.status === 'summarizing') {
    // In review lite the reply goes straight on to the team.
    if ((await writeReply(id)) === 'finalizing') await finalizeEmail(id)
  } else if (rows[0]?.status === 'finalizing') await finalizeEmail(id)
}

interface EmailRow {
  caseId: string
  teamId: string | null
  matchupId: string | null
  side: Side
  teamNumber: number
  subject: string
  body: string
  toIds: string[]
  sentAt: Date
  caseTitle: string
  parties: { plaintiff: string; defendant: string }
  summary: string
  disputedIssues: string
  importantFacts: ImportantFacts
  lite: boolean
}

async function loadEmail(id: string) {
  const { rows } = await pool.query<EmailRow>(
    `SELECT r.case_id AS "caseId", r.team_id AS "teamId", r.matchup_id AS "matchupId", r.side,
            r.team_number AS "teamNumber", coalesce(r.subject, '') AS subject, r.assignment AS body,
            r.to_witness_ids AS "toIds", r.created_at AS "sentAt",
            c.title AS "caseTitle", c.summary,
            json_build_object('plaintiff', c.plaintiff_name, 'defendant', c.defendant_name) AS parties,
            c.disputed_issues AS "disputedIssues",
            json_build_object('plaintiff', c.plaintiff_key_facts, 'defense', c.defense_key_facts) AS "importantFacts",
            c.review_mode = 'lite' AS lite
     FROM interview_reviews r JOIN cases c ON c.id = r.case_id
     WHERE r.id = $1`,
    [id],
  )
  return rows[0] ?? null
}

/** The students on the team, by name, for the reply's To line. */
async function attorneyNames(teamId: string | null) {
  if (!teamId) return []
  const { rows } = await pool.query<{ name: string }>(
    `SELECT coalesce(u.name, m.email) AS name
     FROM team_members m LEFT JOIN users u ON lower(u.email) = lower(m.email)
     WHERE m.team_id = $1 ORDER BY m.added_at`,
    [teamId],
  )
  return rows.map((r) => r.name)
}

/** The team's earlier emails and the clean replies, oldest first (the clients remember them). */
async function priorEmails(teamId: string | null, before: string): Promise<PriorEmail[]> {
  if (!teamId) return []
  const { rows } = await pool.query<{
    sentAt: Date
    repliedAt: Date
    subject: string
    body: string
    reply: string
    from: string | null
    to: string[]
  }>(
    `SELECT r.created_at AS "sentAt", r.completed_at AS "repliedAt", coalesce(r.subject, '') AS subject,
            r.assignment AS body, r.final_report AS reply,
            (SELECT u.name FROM users u WHERE u.id = r.asked_by) AS "from",
            coalesce((SELECT array_agg(w.name ORDER BY w.created_at) FROM case_witnesses w
                      WHERE w.id = ANY(r.to_witness_ids)), '{}') AS "to"
     FROM interview_reviews r
     WHERE r.team_id = $1 AND r.kind = 'client_email' AND r.status = 'completed' AND r.final_report IS NOT NULL AND r.id <> $2
     ORDER BY r.created_at`,
    [teamId, before],
  )
  return rows.flatMap((r) => [
    { date: r.sentAt, from: r.from ? `${r.from} (your attorney)` : 'Your attorneys', to: r.to.join(', '), subject: r.subject, body: r.body },
    { date: r.repliedAt, from: r.to.join(', '), to: 'Your attorneys', subject: `Re: ${r.subject}`, body: r.reply },
  ])
}

/**
 * Everything the clients get for one email: who they are, the case file with
 * what they know and have, the facts that stand, and the earlier emails.
 */
async function clientContext(email: EmailRow, id: string, clients: Witness[]): Promise<ClientContext> {
  let materials = await listMaterialTexts(email.caseId, email.matchupId)
  if (materials.some((m) => m.textStatus === 'pending')) {
    await finishPendingTranscriptions(materials)
    materials = await listMaterialTexts(email.caseId, email.matchupId)
  }
  const [visible, settled, names, prior] = await Promise.all([
    listMaterialsFor(email.caseId, { side: email.side, teamId: email.teamId, matchupId: email.matchupId }),
    settledFacts(email.caseId, email.matchupId),
    attorneyNames(email.teamId),
    priorEmails(email.teamId, id),
  ])
  const canSee = new Set(visible.map((m) => m.id))
  const clientIds = new Set(clients.map((c) => c.id))
  const known = new Set(clients.flatMap((c) => [...c.knownMaterialIds, ...(c.depositionMaterialId ? [c.depositionMaterialId] : [])]))
  const documents: ClientDocument[] = materials
    .filter((m) => m.textStatus === 'ready' && m.text)
    .map((m) => {
      const ownedByClient = m.owner.kind === 'witness' && m.owner.witnessId !== null && clientIds.has(m.owner.witnessId)
      // A world file the clients wrote out before is theirs too.
      const clientHas = ownedByClient || m.owner.kind === email.side
      return {
        id: m.id,
        title: m.description || m.filename,
        teamHasAccess: canSee.has(m.id),
        clientKnows: known.has(m.id) || clientHas,
        clientHas,
        content: m.text!,
      }
    })
  return {
    caseTitle: email.caseTitle,
    parties: email.parties,
    caseSummary: email.summary,
    disputedIssues: email.disputedIssues,
    side: email.side,
    attorneyNames: names,
    contacts: clients.map((c) => ({
      id: c.id,
      name: c.name,
      role: c.role,
      isOrganization: c.speaksForOrganization,
      personaNotes: c.personaNotes,
    })),
    documents,
    importantFacts: email.importantFacts,
    settled,
    priorEmails: prior,
  }
}

export interface ParsedClientReply {
  /** The email, without its tag lines, written-out documents, or review block. */
  body: string
  /** Who signed it, from its From line; null if it has none. */
  from: string | null
  /** Titles of case files it attached. */
  existingTitles: string[]
  /** Documents the clients wrote out. */
  made: MadeFile[]
  facts: string[]
  hasReviewBlock: boolean
}

const TAG_LINE = /^\s*(EXISTING_DOCUMENT|NEW_DOCUMENT)\s*:\s*(.+?)\s*$/gim

/** Splits the reply into its tag lines, the email, the documents written out, and the review block's new facts. */
export function parseClientReply(text: string): ParsedClientReply {
  const match = text.match(/<review>([\s\S]*?)(<\/review>|$)/i)
  const beforeReview = (match ? text.slice(0, match.index) : text).trim()
  const existingTitles: string[] = []
  for (const tag of beforeReview.matchAll(TAG_LINE)) {
    if (tag[1].toUpperCase() === 'EXISTING_DOCUMENT') existingTitles.push(tag[2])
  }
  const { body, files: made } = extractMadeFiles(beforeReview.replace(TAG_LINE, ''))
  const facts: string[] = []
  let inFacts = false
  for (const raw of (match?.[1] ?? '').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (/^NEW FACTS:?$/i.test(line.replace(/[*_#]/g, '').trim())) {
      inFacts = true
      continue
    }
    const item = line.replace(/^[-*•]\s*/, '').trim()
    if (inFacts && item && !/^none\.?$/i.test(item)) facts.push(item)
  }
  const from = /^\s*From:\s*(.+?)\s*$/im.exec(body)?.[1] ?? null
  return { body: body.trim(), from, existingTitles, made, facts, hasReviewBlock: Boolean(match) }
}

async function fail(id: string, err: unknown, what: string) {
  if (!(err instanceof AiNotConfiguredError)) console.error(`Could not ${what} for client email ${id}:`, err)
  const error = err instanceof AiNotConfiguredError ? err.message : `Could not ${what}. Try again.`
  await pool.query(`UPDATE interview_reviews SET status = 'failed', error = $2 WHERE id = $1`, [id, error]).catch(() => {})
}

/**
 * Asks the clients for their reply and lays it out for the instructor's
 * review, or in review lite rules on it at once; returns the review's new
 * status. Never throws.
 */
async function writeReply(id: string): Promise<'open' | 'finalizing' | null> {
  try {
    const email = await loadEmail(id)
    if (!email) return null // deleted meanwhile
    const clients = clientsOf(await listWitnesses(email.caseId), email.side)
    if (clients.length === 0) throw new Error('The side has no clients any more.')
    const context = await clientContext(email, id, clients)
    const to = clients.filter((c) => email.toIds.includes(c.id)).map((c) => c.name)
    const text = await ai.emailClient({ context, email: { to: to.length ? to : clients.map((c) => c.name), subject: email.subject, body: email.body } })
    const parsed = parseClientReply(text)
    // Only files the clients have, and the team doesn't yet, are theirs to hand over.
    const unlock = matchTitles(parsed.existingTitles, context.documents.filter((d) => d.clientHas && !d.teamHasAccess))
    const signer = clients.find((c) => parsed.from && parsed.from.toLowerCase().includes(c.name.toLowerCase())) ?? clients[0]
    return await layOutReport(id, {
      caseId: email.caseId,
      matchupId: email.matchupId,
      teamNumber: email.teamNumber,
      lite: email.lite,
      body: parsed.body,
      facts: parsed.facts,
      unlockIds: unlock.map((d) => d.id),
      made: parsed.made,
      madeBy: signer.name,
      by: 'client',
      source: 'client',
      // What the clients hand over is their side's.
      owner: { kind: email.side, witnessId: null },
      recordsRequested: [],
      reviewBlockMissing: !parsed.hasReviewBlock,
    })
  } catch (err) {
    await fail(id, err, 'get your client’s reply')
    return null
  }
}

/** Writes the team's clean reply, shares the allowed files, and completes the review; never throws. */
async function finalizeEmail(id: string) {
  try {
    const rulings = await reportRulings(id)
    if (!rulings) return
    const from = /^\s*From:\s*(.+?)\s*$/im.exec(rulings.report)?.[1] ?? 'the client'
    const reply = await ai.finalizeReport({
      author: from,
      kind: 'email',
      body: rulings.report,
      deniedFacts: rulings.deniedFacts,
      deniedTitles: rulings.deniedTitles,
    })
    await completeReport(id, rulings.teamId, reply)
  } catch (err) {
    await fail(id, err, 'write your client’s reply')
  }
}
