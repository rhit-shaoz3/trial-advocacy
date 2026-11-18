import { ai, AiNotConfiguredError } from '../ai/ai.ts'
import { listMaterialsFor, listMaterialTexts, listWitnesses } from '../courses/caseContent.ts'
import type { ImportantFacts, InteractionLimit } from '../courses/cases.ts'
import type { Side } from '../courses/matchups.ts'
import { finishPendingTranscriptions } from '../courses/materialText.ts'
import { pool } from '../db/pool.ts'
import { HttpError } from '../httpError.ts'
import { completeReport, layOutReport, reportRulings } from '../reviews/reportReview.ts'
import { settledFacts } from '../reviews/reviews.ts'
import { MAX_ASSIGNMENT_LENGTH, matchTitles, parseReport } from './investigate.ts'
import type { InvestigatorContext } from './prompt.ts'

// A team's requests to the case's background investigator. The team emails an
// assignment; in the background the AI writes his report, which goes to the
// instructor's review (an interview_reviews row of kind 'investigation') with
// its new facts, the case files he'd unlock, and the records and illustrative
// aids he made (new case files in the team's world, for the instructor only
// until allowed). Once the instructor has ruled,
// the AI writes the clean report the team gets, the allowed files are shared
// with the team, and the rulings bind later interviews and investigations.
// In review lite mode the report skips the instructor: its facts stand for the
// team's world and its files are allowed (marked `auto`), and the team can
// flag either for the instructor. The instructor limits how many requests
// each team (or each student) can send.

/** Who's sending: the student's team, in its case world. */
export interface InvestigationContext {
  caseId: string
  teamId: string
  matchupId: string
  side: Side
  teamNumber: number
  worldNumber: number
  userId: string
  /** How many requests the team (or each student) can send; leave out for no limit. */
  limit?: InteractionLimit
}

// Shape sent to students; matches `Investigation` in src/courses/types.ts.
export interface Investigation {
  id: string
  assignment: string
  askedBy: string | null
  /** Whether this student sent it (for a per-student limit). */
  mine: boolean
  sentAt: Date
  /** working: with the investigator or the instructor; completed: the report is back. */
  status: 'working' | 'completed'
  completedAt: Date | null
  /** The clean report, once completed. */
  report: string | null
  /** Files this report unlocked for the team (attached to it, and in the case file); `auto` when review lite allowed them. */
  unlocked: { id: string; title: string; filename: string; contentType: string; sizeBytes: number; auto: boolean }[]
  /** The facts the report turned up that stand, once completed, for flagging the ones decided automatically. */
  facts: { id: string; text: string; auto: boolean }[]
  /** Whether this student has read the report. */
  seen: boolean
}

/** The team's requests, newest first. Students never see the investigator's draft or the rulings. */
export async function teamInvestigations(caseId: string, teamId: string, userId: string): Promise<Investigation[]> {
  const { rows } = await pool.query<Investigation>(
    `SELECT r.id, r.assignment, (SELECT u.name FROM users u WHERE u.id = r.asked_by) AS "askedBy",
            r.asked_by IS NOT DISTINCT FROM $3 AS mine, r.created_at AS "sentAt",
            CASE WHEN r.status = 'completed' THEN 'completed' ELSE 'working' END AS status,
            r.completed_at AS "completedAt",
            CASE WHEN r.status = 'completed' THEN r.final_report END AS report,
            CASE WHEN r.status = 'completed' THEN coalesce((
              SELECT json_agg(json_build_object('id', m.id, 'title', coalesce(nullif(m.description, ''), m.filename),
                                                'filename', m.filename, 'contentType', m.content_type,
                                                'sizeBytes', m.size_bytes, 'auto', d.auto)
                              ORDER BY d.position)
              FROM review_documents d JOIN case_materials m ON m.id = d.material_id
              WHERE d.review_id = r.id AND d.decision = 'allow'), '[]') ELSE '[]' END AS unlocked,
            CASE WHEN r.status = 'completed' THEN coalesce((
              SELECT json_agg(json_build_object('id', f.id, 'text', f.text, 'auto', f.auto) ORDER BY f.position)
              FROM review_facts f WHERE f.review_id = r.id AND f.decision LIKE 'accept%'), '[]') ELSE '[]' END AS facts,
            EXISTS (SELECT 1 FROM review_seen s WHERE s.review_id = r.id AND s.user_id = $3) AS seen
     FROM interview_reviews r
     WHERE r.case_id = $1 AND r.team_id = $2 AND r.kind = 'investigation'
     ORDER BY r.created_at DESC`,
    [caseId, teamId, userId],
  )
  return rows
}

/** How many requests count against the limit: the team's, or for a per-student limit this student's. */
async function requestsUsed(ctx: InvestigationContext, limit: InteractionLimit) {
  const { rows } = await pool.query<{ used: number }>(
    `SELECT count(*)::int AS used FROM interview_reviews
     WHERE case_id = $1 AND team_id = $2 AND kind = 'investigation' AND ($3::uuid IS NULL OR asked_by = $3)`,
    [ctx.caseId, ctx.teamId, limit.per === 'student' ? ctx.userId : null],
  )
  return rows[0].used
}

/**
 * Sends the team's assignment to the investigator. One at a time: the last
 * must be back first. (That also keeps partners from both sending the last
 * one the limit allows.)
 */
export async function sendInvestigation(ctx: InvestigationContext, body: unknown) {
  const raw = (body as { assignment?: unknown } | undefined)?.assignment
  const assignment = typeof raw === 'string' ? raw.trim() : ''
  if (!assignment) throw new HttpError(400, 'Write the assignment for the investigator.')
  if (assignment.length > MAX_ASSIGNMENT_LENGTH) {
    throw new HttpError(400, `Keep the assignment to ${MAX_ASSIGNMENT_LENGTH} characters.`)
  }
  if (ctx.limit && (await requestsUsed(ctx, ctx.limit)) >= ctx.limit.max) {
    const times = ctx.limit.max === 1 ? 'request' : `${ctx.limit.max} requests`
    throw new HttpError(
      409,
      ctx.limit.per === 'student' ? `You've used your ${times} to the investigator.` : `Your team has used its ${times} to the investigator.`,
    )
  }
  try {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO interview_reviews
         (kind, case_id, team_id, matchup_id, team_number, world_number, side, assignment, asked_by)
       VALUES ('investigation', $1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [ctx.caseId, ctx.teamId, ctx.matchupId, ctx.teamNumber, ctx.worldNumber, ctx.side, assignment, ctx.userId],
    )
    queueInvestigation(rows[0].id)
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new HttpError(409, 'Your team is still waiting on its last request. Its report has to come back first.')
    }
    throw err
  }
  return teamInvestigations(ctx.caseId, ctx.teamId, ctx.userId)
}

const running = new Map<string, Promise<void>>()

/** Starts an investigation's next step in the background: investigating, or writing the team's report. */
export function queueInvestigation(id: string) {
  if (running.has(id)) return
  const run = advance(id).finally(() => running.delete(id))
  running.set(id, run)
}

/** Picks up investigations a server restart interrupted (the work runs in memory). */
export async function resumeInvestigations() {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM interview_reviews WHERE kind = 'investigation' AND status IN ('summarizing', 'finalizing')`,
  )
  for (const { id } of rows) queueInvestigation(id)
}

/** Resolves once every investigation running now has finished (for tests). */
export async function investigationsSettled() {
  while (running.size) await Promise.all(running.values())
}

async function advance(id: string) {
  const { rows } = await pool.query<{ status: string }>(
    `SELECT status FROM interview_reviews WHERE id = $1 AND kind = 'investigation'`,
    [id],
  )
  if (rows[0]?.status === 'summarizing') {
    // In review lite the report goes straight on to the team.
    if ((await investigateRequest(id)) === 'finalizing') await finalizeRequest(id)
  } else if (rows[0]?.status === 'finalizing') await finalizeRequest(id)
}

interface RequestRow {
  caseId: string
  teamId: string | null
  matchupId: string | null
  side: Side
  teamNumber: number
  assignment: string
  caseTitle: string
  parties: { plaintiff: string; defendant: string }
  summary: string
  disputedIssues: string
  importantFacts: ImportantFacts
  investigatorName: string
  instructions: string
  lite: boolean
}

async function loadRequest(id: string) {
  const { rows } = await pool.query<RequestRow>(
    `SELECT r.case_id AS "caseId", r.team_id AS "teamId", r.matchup_id AS "matchupId", r.side,
            r.team_number AS "teamNumber", r.assignment,
            c.title AS "caseTitle", c.summary,
            json_build_object('plaintiff', c.plaintiff_name, 'defendant', c.defendant_name) AS parties,
            c.disputed_issues AS "disputedIssues",
            json_build_object('plaintiff', c.plaintiff_key_facts, 'defense', c.defense_key_facts) AS "importantFacts",
            c.investigator_name AS "investigatorName", c.investigator_instructions AS instructions,
            c.review_mode = 'lite' AS lite
     FROM interview_reviews r JOIN cases c ON c.id = r.case_id
     WHERE r.id = $1`,
    [id],
  )
  return rows[0] ?? null
}

/** Everything the investigator gets for one team's request: the case file, the facts that stand, and who's asking. */
async function investigatorContext(request: RequestRow): Promise<InvestigatorContext> {
  let materials = await listMaterialTexts(request.caseId, request.matchupId)
  if (materials.some((m) => m.textStatus === 'pending')) {
    await finishPendingTranscriptions(materials)
    materials = await listMaterialTexts(request.caseId, request.matchupId)
  }
  const [visible, witnesses, settled] = await Promise.all([
    listMaterialsFor(request.caseId, { side: request.side, teamId: request.teamId, matchupId: request.matchupId }),
    listWitnesses(request.caseId),
    settledFacts(request.caseId, request.matchupId),
  ])
  const canSee = new Set(visible.map((m) => m.id))
  return {
    investigatorName: request.investigatorName,
    instructions: request.instructions,
    caseTitle: request.caseTitle,
    parties: request.parties,
    caseSummary: request.summary,
    // The case runs on the real date.
    inWorldDate: null,
    disputedIssues: request.disputedIssues,
    side: request.side,
    teamNumber: request.teamNumber,
    documents: materials
      .filter((m) => m.textStatus === 'ready' && m.text)
      .map((m) => ({ id: m.id, title: m.description || m.filename, teamHasAccess: canSee.has(m.id), content: m.text! })),
    // A witness the instructor is keeping from students isn't the investigator's to reveal.
    witnesses: witnesses.filter((w) => !w.hidden).map((w) => ({ name: w.name, role: w.role, side: w.alignedSide })),
    importantFacts: request.importantFacts,
    settled,
  }
}

/** The team's earlier requests and the reports they got back, oldest first (the investigator remembers them). */
async function history(teamId: string | null, before: string) {
  if (!teamId) return []
  const { rows } = await pool.query<{ assignment: string; report: string }>(
    `SELECT assignment, final_report AS report FROM interview_reviews
     WHERE team_id = $1 AND kind = 'investigation' AND status = 'completed' AND final_report IS NOT NULL AND id <> $2
     ORDER BY created_at`,
    [teamId, before],
  )
  return rows
}

async function fail(id: string, err: unknown, what: string) {
  if (!(err instanceof AiNotConfiguredError)) console.error(`Could not ${what} for investigation ${id}:`, err)
  const error = err instanceof AiNotConfiguredError ? err.message : `Could not ${what}. Try again.`
  await pool.query(`UPDATE interview_reviews SET status = 'failed', error = $2 WHERE id = $1`, [id, error]).catch(() => {})
}

/**
 * Asks the investigator for his report and lays it out for the instructor's
 * review, or in review lite rules on it at once; returns the review's new
 * status. Never throws.
 */
async function investigateRequest(id: string): Promise<'open' | 'finalizing' | null> {
  try {
    const request = await loadRequest(id)
    if (!request) return null // deleted meanwhile
    const context = await investigatorContext(request)
    const text = await ai.investigate({
      context,
      history: await history(request.teamId, id),
      assignment: request.assignment,
    })
    const parsed = parseReport(text)
    // Only files the team doesn't have yet are his to unlock.
    const unlock = matchTitles(parsed.accessTitles, context.documents.filter((d) => !d.teamHasAccess))
    return await layOutReport(id, {
      caseId: request.caseId,
      matchupId: request.matchupId,
      teamNumber: request.teamNumber,
      lite: request.lite,
      body: parsed.body,
      facts: parsed.facts,
      unlockIds: unlock.map((d) => d.id),
      made: parsed.made,
      madeBy: request.investigatorName,
      by: 'investigator',
      source: 'investigator',
      recordsRequested: parsed.records,
      reviewBlockMissing: !parsed.hasReviewBlock,
    })
  } catch (err) {
    await fail(id, err, 'get the investigator’s report')
    return null
  }
}

/** Writes the team's clean report, shares the allowed files, and completes the review; never throws. */
async function finalizeRequest(id: string) {
  try {
    const [rulings, { rows }] = await Promise.all([
      reportRulings(id),
      pool.query<{ investigatorName: string }>(
        `SELECT c.investigator_name AS "investigatorName"
         FROM interview_reviews r JOIN cases c ON c.id = r.case_id WHERE r.id = $1`,
        [id],
      ),
    ])
    if (!rulings || !rows[0]) return
    const finalReport = await ai.finalizeReport({
      author: rows[0].investigatorName,
      body: rulings.report,
      deniedFacts: rulings.deniedFacts,
      deniedTitles: rulings.deniedTitles,
    })
    await completeReport(id, rulings.teamId, finalReport)
  } catch (err) {
    await fail(id, err, 'write the team’s report')
  }
}
