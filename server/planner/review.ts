import { ai, AiNotConfiguredError } from '../ai/ai.ts'
import { modelFor } from '../ai/models.ts'
import { listMaterialsFor, listMaterialTexts } from '../courses/caseContent.ts'
import { phaseAtLeast, type CasePhase, type FeedbackLevel, type InteractionLimit } from '../courses/cases.ts'
import { finishPendingTranscriptions } from '../courses/materialText.ts'
import { pool } from '../db/pool.ts'
import { interviewTranscripts, teamPriorDiscovery } from '../exchange/discoveryChecks.ts'
import { getSettings, requestsOpen, usedCount } from '../exchange/exchange.ts'
import { HttpError } from '../httpError.ts'
import { teamFacts } from '../packets/packets.ts'
import { findTeamWorld } from '../reviews/reviews.ts'
import { splitParagraphs } from '../exhibits/exhibitFiles.ts'
import { isUuid } from '../validation.ts'
import { loadChart, MAX_TEXT_LENGTH, type PlannerChart, type PlannerTeam } from './planner.ts'
import { labelChart, nameLabels, parsePlannerReview, type Labels, type PlannerReviewContext, type PlannerTag } from './prompt.ts'

// Rounds of AI feedback on a team's planner. A student asks; the chart is
// kept as it is then, and the reviewer reads it in the background with the
// whole case file (marked with what the team can see), the round before, and
// the team's replies to it. Its questions are pinned to the cards and gaps
// they're about. Each team (or student) gets the case's number of rounds; a
// round that fails can be tried again and doesn't count.

export type ReviewStatus = 'working' | 'ready' | 'failed'
export type TargetKind = 'card' | 'gap'

// Shape sent to the client; matches `PlannerReview` in src/courses/types.ts.
export interface PlannerReview {
  id: string
  round: number
  status: ReviewStatus
  tag: PlannerTag | null
  overview: string | null
  bigPicture: string | null
  notes: { targetKind: TargetKind; targetId: string; text: string }[]
  replies: { targetKind: TargetKind; targetId: string; text: string; updatedBy: string | null }[]
  askedBy: string | null
  /** Asked by the student viewing it. */
  mine: boolean
  error: string | null
  createdAt: Date
  completedAt: Date | null
}

export interface PlannerFeedback {
  /** Oldest first. */
  reviews: PlannerReview[]
  limit: InteractionLimit
  /** The rounds counted against the limit: the team's, or the student's own when it's per student. */
  used: number
}

/** Rounds that count: everything but a failed one. */
async function roundsUsed(team: Pick<PlannerTeam, 'caseId' | 'teamId' | 'userId'>, limit: InteractionLimit) {
  const { rows } = await pool.query<{ used: number }>(
    `SELECT count(*)::int AS used FROM planner_reviews
     WHERE case_id = $1 AND team_id = $2 AND status <> 'failed' AND ($3::uuid IS NULL OR asked_by = $3)`,
    [team.caseId, team.teamId, limit.per === 'student' ? team.userId : null],
  )
  return rows[0].used
}

/** The team's rounds, oldest first, with their notes and the team's replies. */
export async function teamFeedback(
  team: Pick<PlannerTeam, 'caseId' | 'teamId'> & { userId: string | null },
  limit: InteractionLimit,
): Promise<PlannerFeedback> {
  const { rows } = await pool.query<Omit<PlannerReview, 'mine'> & { askedById: string | null }>(
    `SELECT r.id, r.round, r.status, r.tag, r.overview, r.big_picture AS "bigPicture", r.error,
            r.created_at AS "createdAt", r.completed_at AS "completedAt", u.name AS "askedBy", r.asked_by AS "askedById",
            coalesce((SELECT json_agg(json_build_object('targetKind', n.target_kind, 'targetId', n.target_id, 'text', n.text)
                                      ORDER BY n.position)
                      FROM planner_review_notes n WHERE n.review_id = r.id), '[]') AS notes,
            coalesce((SELECT json_agg(json_build_object('targetKind', p.target_kind, 'targetId', p.target_id, 'text', p.text,
                                                        'updatedBy', pu.name) ORDER BY p.updated_at)
                      FROM planner_replies p LEFT JOIN users pu ON pu.id = p.updated_by WHERE p.review_id = r.id), '[]') AS replies
     FROM planner_reviews r LEFT JOIN users u ON u.id = r.asked_by
     WHERE r.case_id = $1 AND r.team_id = $2
     ORDER BY r.created_at`,
    [team.caseId, team.teamId],
  )
  return {
    reviews: rows.map(({ askedById, ...r }) => ({ ...r, mine: askedById !== null && askedById === team.userId })),
    limit,
    used: team.userId ? await roundsUsed({ ...team, userId: team.userId }, limit) : rows.filter((r) => r.status !== 'failed').length,
  }
}

/** Asks for the next round of feedback on the team's chart as it is now. */
export async function requestReview(team: PlannerTeam, limit: InteractionLimit) {
  const chart = await loadChart(team)
  if (!chart.cards.some((c) => !c.parentId && c.title.trim())) {
    throw new HttpError(400, 'Write at least one fact of consequence before you ask for feedback.')
  }
  if ((await roundsUsed(team, limit)) >= limit.max) {
    throw new HttpError(
      409,
      limit.per === 'student'
        ? `You've used your ${limit.max} ${limit.max === 1 ? 'round' : 'rounds'} of feedback.`
        : `Your team has used its ${limit.max} ${limit.max === 1 ? 'round' : 'rounds'} of feedback.`,
    )
  }
  const { rows: previous } = await pool.query<{ labels: Labels }>(
    `SELECT labels FROM planner_reviews WHERE team_id = $1 AND case_id = $2 ORDER BY created_at DESC LIMIT 1`,
    [team.teamId, team.caseId],
  )
  const labels = labelChart(chart, previous[0]?.labels)
  try {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO planner_reviews (case_id, team_id, round, asked_by, snapshot, labels)
       VALUES ($1, $2, (SELECT count(*) + 1 FROM planner_reviews WHERE team_id = $2 AND case_id = $1 AND status <> 'failed'), $3, $4, $5)
       RETURNING id`,
      [team.caseId, team.teamId, team.userId, JSON.stringify(chart), JSON.stringify(labels)],
    )
    queuePlannerReview(rows[0].id)
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new HttpError(409, 'Your team is already waiting on feedback. It has to come back first.')
    }
    throw err
  }
}

/** Tries a failed round again. */
export async function retryReview(team: PlannerTeam, reviewId: string) {
  if (!isUuid(reviewId)) throw new HttpError(404, 'That round is gone.')
  try {
    const { rowCount } = await pool.query(
      `UPDATE planner_reviews SET status = 'working', error = NULL WHERE id = $1 AND team_id = $2 AND case_id = $3 AND status = 'failed'`,
      [reviewId, team.teamId, team.caseId],
    )
    if (!rowCount) throw new HttpError(409, 'Only a round that failed can be tried again.')
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new HttpError(409, 'Your team is already waiting on feedback. It has to come back first.')
    }
    throw err
  }
  queuePlannerReview(reviewId)
}

/** Saves the team's reply to a round's question on a card or gap (empty deletes it). */
export async function saveReply(team: PlannerTeam, reviewId: string, targetKind: string, targetId: string, body: unknown) {
  const text = (body as Record<string, unknown> | undefined)?.text
  if (typeof text !== 'string') throw new HttpError(400, 'Write your reply as text.')
  if (text.length > MAX_TEXT_LENGTH) throw new HttpError(400, `Keep your reply to ${MAX_TEXT_LENGTH} characters.`)
  if (!isUuid(reviewId) || !isUuid(targetId) || (targetKind !== 'card' && targetKind !== 'gap')) {
    throw new HttpError(404, 'That question is gone.')
  }
  const { rows } = await pool.query(
    `SELECT 1 FROM planner_review_notes n JOIN planner_reviews r ON r.id = n.review_id
     WHERE r.id = $1 AND r.team_id = $2 AND r.case_id = $3 AND n.target_kind = $4 AND n.target_id = $5`,
    [reviewId, team.teamId, team.caseId, targetKind, targetId],
  )
  if (!rows[0]) throw new HttpError(404, 'That question is gone.')
  if (!text.trim()) {
    await pool.query('DELETE FROM planner_replies WHERE review_id = $1 AND target_kind = $2 AND target_id = $3', [reviewId, targetKind, targetId])
    return
  }
  await pool.query(
    `INSERT INTO planner_replies (review_id, target_kind, target_id, text, updated_by) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (review_id, target_kind, target_id) DO UPDATE SET text = $4, updated_by = $5, updated_at = now()`,
    [reviewId, targetKind, targetId, text, team.userId],
  )
}

// Running a round -----------------------------------------------------------------

const running = new Map<string, Promise<void>>()

export function queuePlannerReview(id: string) {
  if (running.has(id)) return
  running.set(
    id,
    runReview(id).finally(() => running.delete(id)),
  )
}

/** Picks up rounds the server was running when it stopped. */
export async function resumePlannerReviews() {
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM planner_reviews WHERE status = 'working'`)
  for (const r of rows) queuePlannerReview(r.id)
}

/** For tests: waits for every round in progress. */
export async function plannerReviewsSettled() {
  while (running.size) await Promise.all(running.values())
}

const NO_USER = '00000000-0000-0000-0000-000000000000'

/** The tools the team can use now, in the case's phase and setup, in plain words. */
async function availableTools(caseId: string, phase: CasePhase, side: string, investigator: boolean, exchangeReady: boolean) {
  const tools = ['interview your own witnesses']
  const { rows } = await pool.query(
    'SELECT 1 FROM case_witnesses WHERE case_id = $1 AND is_client AND aligned_side = $2 AND NOT hidden LIMIT 1',
    [caseId, side],
  )
  if (rows[0]) tools.push('email your client')
  if (investigator && phaseAtLeast(phase, 'investigate')) tools.push('the background investigator')
  if (exchangeReady && requestsOpen(phase)) {
    const settings = await getSettings(caseId)
    if (settings.subpoenas.enabled) tools.push('subpoenas')
    if (settings.interrogatories.enabled) tools.push('interrogatories')
    if (settings.rfas.enabled) tools.push('requests for admission')
  }
  if (phaseAtLeast(phase, 'deposition')) tools.push('depositions of the other side’s witnesses')
  return tools
}

/** Everything the reviewer reads for one round. */
async function reviewContext(id: string): Promise<PlannerReviewContext> {
  const { rows } = await pool.query<{
    caseId: string
    teamId: string
    round: number
    askedBy: string | null
    snapshot: PlannerChart
    labels: Labels
    createdAt: Date
  }>(
    `SELECT case_id AS "caseId", team_id AS "teamId", round, asked_by AS "askedBy", snapshot, labels, created_at AS "createdAt"
     FROM planner_reviews WHERE id = $1`,
    [id],
  )
  const r = rows[0]
  const world = await findTeamWorld(r.teamId)
  if (!world) throw new Error('The team is no longer in a case world.')
  const { rows: cases } = await pool.query<{
    title: string
    summary: string
    inWorldDate: string | null
    parties: { plaintiff: string; defendant: string }
    phase: CasePhase
    importantFacts: { plaintiff: string[]; defense: string[] }
    investigator: boolean
    exchangeReady: boolean
    level: FeedbackLevel
  }>(
    `SELECT title, summary, to_char(in_world_date, 'YYYY-MM-DD') AS "inWorldDate", phase,
            json_build_object('plaintiff', plaintiff_name, 'defendant', defendant_name) AS parties,
            json_build_object('plaintiff', plaintiff_key_facts, 'defense', defense_key_facts) AS "importantFacts",
            investigator_enabled AS investigator, planner_feedback_level AS level,
            EXISTS (SELECT 1 FROM information_exchange ie WHERE ie.case_id = cases.id AND ie.setup_completed_at IS NOT NULL) AS "exchangeReady"
     FROM cases WHERE id = $1`,
    [r.caseId],
  )
  const c = cases[0]
  let texts = await listMaterialTexts(r.caseId, world.matchupId)
  if (texts.some((m) => m.textStatus === 'pending')) {
    await finishPendingTranscriptions(texts)
    texts = await listMaterialTexts(r.caseId, world.matchupId)
  }
  const [visible, transcripts, reports, facts, prior, settings, served, witnesses, previous] = await Promise.all([
    listMaterialsFor(r.caseId, { side: world.side, teamId: r.teamId, matchupId: world.matchupId }),
    interviewTranscripts(r.caseId, r.teamId),
    pool.query<{ kind: string; report: string; subject: string | null; name: string }>(
      `SELECT r.kind, r.final_report AS report, r.subject, c.investigator_name AS name
       FROM interview_reviews r JOIN cases c ON c.id = r.case_id
       WHERE r.case_id = $1 AND r.team_id = $2 AND r.kind IN ('investigation', 'client_email') AND r.status = 'completed'
         AND r.final_report IS NOT NULL
       ORDER BY r.created_at`,
      [r.caseId, r.teamId],
    ),
    teamFacts(r.caseId, { id: r.teamId, matchupId: world.matchupId }),
    teamPriorDiscovery(r.caseId, r.teamId, r.askedBy ?? NO_USER),
    getSettings(r.caseId),
    usedCount(r.caseId, r.teamId, 'interrogatories'),
    pool.query<{ id: string; name: string; role: string; side: string | null; hidden: boolean }>(
      'SELECT id, name, role, aligned_side AS side, hidden FROM case_witnesses WHERE case_id = $1 ORDER BY created_at',
      [r.caseId],
    ),
    pool.query<{ id: string; raw: string; labels: Labels }>(
      `SELECT id, raw, labels FROM planner_reviews
       WHERE team_id = $1 AND case_id = $2 AND status = 'ready' AND created_at < $3
       ORDER BY created_at DESC LIMIT 1`,
      [r.teamId, r.caseId, r.createdAt],
    ),
  ])
  const canSee = new Set(visible.map((m) => m.id))
  const last = previous.rows[0]
  const lastLabel = new Map(Object.entries(last?.labels ?? {}).map(([label, t]) => [`${t.kind}:${t.id}`, label]))
  const replies = last
    ? (
        await pool.query<{ kind: string; targetId: string; text: string }>(
          'SELECT target_kind AS kind, target_id AS "targetId", text FROM planner_replies WHERE review_id = $1 ORDER BY updated_at',
          [last.id],
        )
      ).rows.flatMap((p) => {
        const label = lastLabel.get(`${p.kind}:${p.targetId}`)
        return label ? [{ label, text: p.text }] : []
      })
    : []
  const learned = facts.filter((f) => f.accepted).map((f) => f.text)
  return {
    caseTitle: c.title,
    parties: c.parties,
    caseSummary: c.summary,
    inWorldDate: c.inWorldDate,
    side: world.side,
    availableTools: await availableTools(r.caseId, c.phase, world.side, c.investigator, c.exchangeReady),
    interrogatoryLimit: c.exchangeReady && settings.interrogatories.enabled ? settings.interrogatories.limit : null,
    interrogatoriesServed: served,
    chart: r.snapshot,
    witnessNames: Object.fromEntries(witnesses.rows.map((w) => [w.id, w.name])),
    labels: r.labels,
    round: r.round,
    level: c.level,
    previousFeedback: last?.raw ?? null,
    teamReplies: replies,
    documents: [
      // The whole case file, so the reviewer understands the case; it's told never to let what the team can't see show.
      ...texts
        .filter((m) => m.textStatus === 'ready' && m.text)
        .map((m) => ({ title: m.description || m.filename, teamHasAccess: canSee.has(m.id), content: m.text! })),
      ...transcripts.map((t) => ({ title: t.title, teamHasAccess: true, content: t.content })),
      ...reports.rows.map((p) => ({
        title: p.kind === 'investigation' ? `${p.name}'s report to your team` : `Your client's reply: ${p.subject || 'no subject'}`,
        teamHasAccess: true,
        content: splitParagraphs(p.report).join('\n\n'),
      })),
    ],
    witnesses: witnesses.rows
      .filter((w) => !w.hidden)
      .map((w) => ({ name: w.name, title: w.role, side: w.side === 'defense' ? 'defense' : w.side === 'plaintiff' ? 'plaintiff' : 'neither' })),
    facts: [
      ...[...c.importantFacts.plaintiff, ...c.importantFacts.defense].filter((f) => !learned.includes(f)).map((fact) => ({ fact, teamCanSee: false })),
      ...learned.map((fact) => ({ fact, teamCanSee: true })),
    ],
    priorDiscovery: prior,
  }
}

async function runReview(id: string) {
  try {
    const context = await reviewContext(id)
    const raw = await ai.reviewPlanner(context)
    const parsed = parsePlannerReview(raw)
    // What the students read names their cards, not the reviewer's ids for them.
    const named = (text: string) => nameLabels(text, context.labels, context.chart)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      // A note on a card or gap the chart doesn't have goes in the overview, so nothing is lost.
      const stray: string[] = []
      let position = 0
      for (const note of parsed.notes) {
        const target = context.labels[note.label]
        if (!target || target.kind !== note.kind) {
          stray.push(named(note.text))
          continue
        }
        await client.query(
          'INSERT INTO planner_review_notes (review_id, position, target_kind, target_id, text) VALUES ($1, $2, $3, $4, $5)',
          [id, position++, target.kind, target.id, named(note.text)],
        )
      }
      await client.query(
        `UPDATE planner_reviews SET status = 'ready', tag = $2, overview = $3, big_picture = $4, raw = $5, model = $6,
           completed_at = now()
         WHERE id = $1`,
        [id, parsed.tag, [named(parsed.overview), ...stray].filter(Boolean).join('\n\n'), named(parsed.bigPicture), raw, modelFor('planner')],
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    if (!(err instanceof AiNotConfiguredError)) console.error('Planner review failed:', err)
    await pool.query(`UPDATE planner_reviews SET status = 'failed', error = $2 WHERE id = $1`, [
      id,
      err instanceof AiNotConfiguredError ? err.message : 'The feedback couldn’t be written. Try again.',
    ])
  }
}
