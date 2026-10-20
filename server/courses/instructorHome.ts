import { pool } from '../db/pool.ts'
import type { CasePhase } from './cases.ts'
import { launchChecks } from './workspace.ts'

// What the instructor's course home shows, unlike a student's: how the course
// is doing, every case and how ready it is for its next step, what is waiting
// on the instructor, upcoming deadlines with how many teams finished them, and
// what teams have been doing.

const WEEK = 7 * 24 * 60 * 60 * 1000
const MAX_DEADLINES = 5
const MAX_ACTIVITY = 8

// Shapes sent to the client; match `InstructorHome` in src/workspace/types.ts.
export interface CaseMonitor {
  id: string
  title: string
  status: 'draft' | 'active' | 'closed'
  phase: CasePhase
  worldCount: number
  /** Drafts: launch checklist items met, of the total, and the first one still missing. */
  launch: { ready: number; total: number; next: string | null } | null
  /**
   * Active cases: of the teams in a case world, how many have finished every
   * task due so far (`due` is how many tasks that is), and how many have
   * finished every task assigned.
   */
  tasks: { due: number; teamsDoneDue: number; assigned: number; teamsDoneAll: number; teams: number } | null
}

export type AttentionTarget = { page: 'review' } | { page: 'manage' } | { page: 'case'; caseId: string; tab?: 'materials' }

export interface AttentionItem {
  id: string
  kind: 'reviews' | 'failedReviews' | 'transcription' | 'roster' | 'launch'
  text: string
  target: AttentionTarget
}

export interface DeadlineProgress {
  id: string
  title: string
  caseId: string
  caseTitle: string
  dueAt: Date
  /** Teams that have marked it done, of the teams it's assigned to. */
  teamsDone: number
  teams: number
}

export interface InstructorActivity {
  id: string
  kind: 'interview' | 'task' | 'review' | 'join'
  actor: string | null
  action: string
  caseTitle: string | null
  at: Date
}

export interface InstructorHome {
  stats: {
    studentsJoined: number
    studentsOnRoster: number
    activeCases: number
    draftCases: number
    /** Questions teams asked AI witnesses in the last 7 days (instructor test runs left out). */
    questionsThisWeek: number
    reviewsWaiting: number
  }
  cases: CaseMonitor[]
  attention: AttentionItem[]
  deadlines: DeadlineProgress[]
  activity: InstructorActivity[]
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export async function instructorHome(courseId: string, now = new Date()): Promise<InstructorHome> {
  const [stats, cases, problems, deadlines, activity] = await Promise.all([
    courseStats(courseId, now),
    caseMonitors(courseId, now),
    fileProblems(courseId),
    upcomingDeadlines(courseId, now),
    recentActivity(courseId),
  ])
  return { stats, cases, attention: attentionItems(stats, cases, problems), deadlines, activity }
}

async function courseStats(courseId: string, now: Date): Promise<InstructorHome['stats']> {
  const { rows } = await pool.query<InstructorHome['stats']>(
    `SELECT
       (SELECT count(*)::int FROM enrollments WHERE course_id = $1 AND user_id IS NOT NULL) AS "studentsJoined",
       (SELECT count(*)::int FROM enrollments WHERE course_id = $1) AS "studentsOnRoster",
       (SELECT count(*)::int FROM cases WHERE course_id = $1 AND status = 'active') AS "activeCases",
       (SELECT count(*)::int FROM cases WHERE course_id = $1 AND status = 'draft') AS "draftCases",
       (SELECT count(*)::int FROM interview_turns t
          JOIN interviews i ON i.id = t.interview_id
          JOIN case_witnesses w ON w.id = i.witness_id
          JOIN cases c ON c.id = w.case_id
        WHERE c.course_id = $1 AND i.team_id IS NOT NULL AND t.created_at > $2) AS "questionsThisWeek",
       (SELECT count(*)::int FROM interview_reviews r JOIN cases c ON c.id = r.case_id
        WHERE c.course_id = $1 AND r.status = 'open') AS "reviewsWaiting"`,
    [courseId, new Date(now.getTime() - WEEK)],
  )
  return rows[0]
}

/**
 * Every case: drafts first (they need setting up), then active, then closed.
 * For active cases, each matched team's tasks are the ones for everyone or its side.
 */
async function caseMonitors(courseId: string, now: Date): Promise<CaseMonitor[]> {
  const { rows } = await pool.query<{
    id: string
    title: string
    status: CaseMonitor['status']
    phase: CasePhase
    worldCount: number
    due: number
    teamsDoneDue: number
    assigned: number
    teamsDoneAll: number
    teams: number
  }>(
    `WITH team_tasks AS (
       SELECT mt.case_id, mt.team_id,
              count(k.id)::int AS assigned,
              count(k.id) FILTER (WHERE k.due_at <= $2)::int AS due,
              count(tc.task_id)::int AS done,
              count(tc.task_id) FILTER (WHERE k.due_at <= $2)::int AS done_due
       FROM matchup_teams mt
       LEFT JOIN case_tasks k ON k.case_id = mt.case_id AND k.audience IN ('all', mt.side)
       LEFT JOIN task_completions tc ON tc.task_id = k.id AND tc.team_id = mt.team_id
       GROUP BY mt.case_id, mt.team_id
     )
     SELECT c.id, c.title, c.status, c.phase,
            (SELECT count(*)::int FROM matchups mu WHERE mu.case_id = c.id) AS "worldCount",
            coalesce(max(tt.due), 0)::int AS due,
            count(tt.team_id) FILTER (WHERE tt.done_due = tt.due)::int AS "teamsDoneDue",
            coalesce(max(tt.assigned), 0)::int AS assigned,
            count(tt.team_id) FILTER (WHERE tt.done = tt.assigned)::int AS "teamsDoneAll",
            count(tt.team_id)::int AS teams
     FROM cases c
     LEFT JOIN team_tasks tt ON tt.case_id = c.id
     WHERE c.course_id = $1
     GROUP BY c.id
     ORDER BY CASE c.status WHEN 'draft' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, c.created_at, c.title`,
    [courseId, now],
  )
  return Promise.all(
    rows.map(async (r): Promise<CaseMonitor> => {
      const base = { id: r.id, title: r.title, status: r.status, phase: r.phase, worldCount: r.worldCount }
      if (r.status === 'draft') {
        const checks = await launchChecks(courseId, r.id)
        const ready = checks.filter((c) => c.ok).length
        return {
          ...base,
          launch: { ready, total: checks.length, next: checks.find((c) => !c.ok)?.message ?? null },
          tasks: null,
        }
      }
      const tasks =
        r.status === 'active'
          ? { due: r.due, teamsDoneDue: r.teamsDoneDue, assigned: r.assigned, teamsDoneAll: r.teamsDoneAll, teams: r.teams }
          : null
      return { ...base, launch: null, tasks }
    }),
  )
}

/** Files the AI witnesses can't read, and reviews that couldn't be summarized, per case. */
async function fileProblems(courseId: string) {
  const { rows } = await pool.query<{ caseId: string; caseTitle: string; failedFiles: number; failedReviews: number }>(
    `SELECT c.id AS "caseId", c.title AS "caseTitle",
            (SELECT count(*)::int FROM case_materials m WHERE m.case_id = c.id AND m.text_status = 'failed') AS "failedFiles",
            (SELECT count(*)::int FROM interview_reviews r WHERE r.case_id = c.id AND r.status = 'failed') AS "failedReviews"
     FROM cases c WHERE c.course_id = $1 AND c.status <> 'closed'
     ORDER BY c.created_at, c.title`,
    [courseId],
  )
  return rows.filter((r) => r.failedFiles > 0 || r.failedReviews > 0)
}

/** What's waiting on the instructor, most pressing first. */
function attentionItems(
  stats: InstructorHome['stats'],
  cases: CaseMonitor[],
  problems: Awaited<ReturnType<typeof fileProblems>>,
): AttentionItem[] {
  const items: AttentionItem[] = []
  if (stats.reviewsWaiting > 0) {
    items.push({
      id: 'reviews',
      kind: 'reviews',
      text: `${plural(stats.reviewsWaiting, 'interview is', 'interviews are')} waiting for your review.`,
      target: { page: 'review' },
    })
  }
  const failedReviews = problems.reduce((n, p) => n + p.failedReviews, 0)
  if (failedReviews > 0) {
    items.push({
      id: 'failed-reviews',
      kind: 'failedReviews',
      text: `${plural(failedReviews, 'review', 'reviews')} couldn't be summarized. Retry from the Review page.`,
      target: { page: 'review' },
    })
  }
  for (const p of problems.filter((p) => p.failedFiles > 0)) {
    items.push({
      id: `transcription-${p.caseId}`,
      kind: 'transcription',
      text: `${p.caseTitle}: ${plural(p.failedFiles, "file couldn't", "files couldn't")} be read for the AI witnesses.`,
      target: { page: 'case', caseId: p.caseId, tab: 'materials' },
    })
  }
  const pending = stats.studentsOnRoster - stats.studentsJoined
  if (pending > 0) {
    items.push({
      id: 'roster',
      kind: 'roster',
      text: `${plural(pending, "student on your roster hasn't", "students on your roster haven't")} signed up yet.`,
      target: { page: 'manage' },
    })
  }
  for (const c of cases.filter((c) => c.launch?.next)) {
    items.push({
      id: `launch-${c.id}`,
      kind: 'launch',
      text: `${c.title} isn't ready to launch: ${c.launch!.next}`,
      target: { page: 'case', caseId: c.id },
    })
  }
  return items
}

/** The next task deadlines in active cases, with how many of the teams they're for have finished. */
async function upcomingDeadlines(courseId: string, now: Date): Promise<DeadlineProgress[]> {
  const { rows } = await pool.query<DeadlineProgress>(
    `SELECT k.id, k.title, c.id AS "caseId", c.title AS "caseTitle", k.due_at AS "dueAt",
            (SELECT count(*)::int FROM task_completions tc
               JOIN matchup_teams mt ON mt.team_id = tc.team_id AND k.audience IN ('all', mt.side)
             WHERE tc.task_id = k.id) AS "teamsDone",
            (SELECT count(*)::int FROM matchup_teams mt
             WHERE mt.case_id = c.id AND k.audience IN ('all', mt.side)) AS teams
     FROM case_tasks k JOIN cases c ON c.id = k.case_id
     WHERE c.course_id = $1 AND c.status = 'active' AND k.due_at >= $2
     ORDER BY k.due_at, k.title
     LIMIT ${MAX_DEADLINES}`,
    [courseId, now],
  )
  return rows
}

/** The latest things teams and students did: interviews, finished tasks, the instructor's rulings, sign-ups. */
async function recentActivity(courseId: string): Promise<InstructorActivity[]> {
  const { rows } = await pool.query<InstructorActivity>(
    `(SELECT 'interview-end-' || i.id AS id, 'interview' AS kind, 'Team ' || t.number AS actor,
             'ended an interview with ' || w.name AS action, c.title AS "caseTitle", i.ended_at AS at
      FROM interviews i JOIN teams t ON t.id = i.team_id
      JOIN case_witnesses w ON w.id = i.witness_id JOIN cases c ON c.id = w.case_id
      WHERE c.course_id = $1 AND i.ended_at IS NOT NULL
      ORDER BY i.ended_at DESC LIMIT ${MAX_ACTIVITY})
     UNION ALL
     (SELECT 'interview-start-' || i.id, 'interview', 'Team ' || t.number,
             'started interviewing ' || w.name, c.title, i.created_at
      FROM interviews i JOIN teams t ON t.id = i.team_id
      JOIN case_witnesses w ON w.id = i.witness_id JOIN cases c ON c.id = w.case_id
      WHERE c.course_id = $1 AND EXISTS (SELECT 1 FROM interview_turns x WHERE x.interview_id = i.id)
      ORDER BY i.created_at DESC LIMIT ${MAX_ACTIVITY})
     UNION ALL
     (SELECT 'task-' || tc.task_id || '-' || tc.team_id, 'task',
             coalesce(u.name, 'Team ' || t.number), 'completed “' || k.title || '”' ||
               CASE WHEN u.name IS NOT NULL THEN ' for Team ' || t.number ELSE '' END,
             c.title, tc.completed_at
      FROM task_completions tc JOIN case_tasks k ON k.id = tc.task_id
      JOIN teams t ON t.id = tc.team_id JOIN cases c ON c.id = k.case_id
      LEFT JOIN users u ON u.id = tc.completed_by
      WHERE c.course_id = $1
      ORDER BY tc.completed_at DESC LIMIT ${MAX_ACTIVITY})
     UNION ALL
     (SELECT 'review-' || r.id, 'review', NULL,
             'You ruled on Team ' || r.team_number || '''s interview of ' || w.name, c.title, r.completed_at
      FROM interview_reviews r JOIN case_witnesses w ON w.id = r.witness_id JOIN cases c ON c.id = r.case_id
      WHERE c.course_id = $1 AND r.status = 'completed'
      ORDER BY r.completed_at DESC LIMIT ${MAX_ACTIVITY})
     UNION ALL
     -- Sign-ups in the same hour (a class joining together) are one item.
     (SELECT 'join-' || to_char(date_trunc('hour', j.at), 'YYYYMMDDHH24'), 'join',
             CASE WHEN count(*) = 1 THEN max(j.name) END,
             CASE WHEN count(*) = 1 THEN 'joined the course' ELSE count(*) || ' students joined the course' END,
             NULL, max(j.at)
      FROM (SELECT coalesce(u.name, e.email) AS name, greatest(e.added_at, u.created_at) AS at
            FROM enrollments e JOIN users u ON u.id = e.user_id
            WHERE e.course_id = $1) j
      GROUP BY date_trunc('hour', j.at)
      ORDER BY max(j.at) DESC LIMIT ${MAX_ACTIVITY})
     ORDER BY at DESC
     LIMIT ${MAX_ACTIVITY}`,
    [courseId],
  )
  return rows
}
