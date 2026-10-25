import { pool } from '../db/pool.ts'
import {
  listCompletions,
  listMaterialsFor,
  listTasks,
  listWitnesses,
  visibleTo,
  type CaseMaterial,
  type CaseTask,
  type MaterialViewer,
  type Witness,
} from './caseContent.ts'
import type { CasePhase } from './cases.ts'
import {
  disclosedWitnessIds,
  findSubmission,
  getSettings,
  requestsOpen,
  type ExchangeKind,
} from '../exchange/exchange.ts'
import type { Side } from './matchups.ts'
import { listMyCases, type MyCase } from './myCases.ts'
import { listTeams } from './teams.ts'
import { isAiWitness } from '../witness/profile.ts'

/** What students see of a witness: never its AI setup (deposition file, persona, files it has seen). */
export type WorkspaceWitness = Pick<Witness, 'id' | 'name' | 'role' | 'description' | 'audience' | 'avatarUrl'> & {
  /** The side the witness testifies for, or null for neither. */
  side: Side | null
  /** Whether the witness is an AI witness the team can interview. */
  canInterview: boolean
  /** The other side's witness, shown because the instructor disclosed them; not to be interviewed yet. */
  disclosed: boolean
}

/**
 * The witnesses a team on `side` can see in `phase`. Until the deposition
 * phase, a witness for one side is hidden from the other, and the rest follow
 * their audience, except that after the introduction phase the witnesses in
 * the instructor's initial disclosures show to both sides. In deposition,
 * every witness is revealed to both sides. With no side yet, only shared
 * witnesses with no side show.
 */
export function visibleWitnesses<W extends Pick<Witness, 'id' | 'audience' | 'alignedSide'>>(
  witnesses: W[],
  side: Side | null,
  phase: CasePhase,
  disclosed: ReadonlySet<string> = new Set(),
) {
  if (phase === 'deposition') return witnesses
  const audiences: string[] = visibleTo(side)
  return witnesses.filter(
    (w) =>
      (audiences.includes(w.audience) && (w.alignedSide === null || w.alignedSide === side)) ||
      (side !== null && requestsOpen(phase) && disclosed.has(w.id)),
  )
}

/** Whether a team on `side` can interview a witness it can see: the other side's only in deposition. */
export const interviewable = (w: Pick<Witness, 'alignedSide' | 'audience'>, side: Side | null, phase: CasePhase) =>
  phase === 'deposition' || !side || (w.alignedSide ?? (w.audience === 'all' ? side : w.audience)) === side

// Shape sent to the client; matches `CaseWorkspace` in src/courses/types.ts.
export interface CaseWorkspace {
  case: {
    id: string
    title: string
    summary: string
    status: 'draft' | 'active' | 'closed'
    phase: CasePhase
    instructorNote: string
  }
  team: MyCase['team']
  world: MyCase['world']
  /** Which side's material is shown: the world's side, or null before matching. */
  side: Side | null
  materials: CaseMaterial[]
  witnesses: WorkspaceWitness[]
  /** The case's background investigator, or null if it has none. */
  investigator: { name: string; avatarUrl: string } | null
  /** Whether the background investigator is open yet (from the investigate phase on). */
  investigatorAvailable: boolean
  /** Whether the information exchange is set up, so the team has its tab. */
  exchangeReady: boolean
  /**
   * The instructor's tasks, plus the information exchange's own (`auto`):
   * choosing initial disclosures, and responding to each set the other team
   * sends. Those complete themselves.
   */
  tasks: (CaseTask & { completedAt: Date | null; completedBy: string | null; auto?: boolean })[]
  /** True when the instructor is looking at it as a team would; nothing can be changed. */
  preview: boolean
}

/** The background investigator's portrait, the same in every case (public/investigator.png). */
export const INVESTIGATOR_AVATAR_URL = '/investigator.png'

type CaseRow = CaseWorkspace['case'] & { investigatorEnabled: boolean; investigatorName: string; exchangeReady: boolean }

async function findCaseRow(courseId: string, caseId: string) {
  const { rows } = await pool.query<CaseRow>(
    `SELECT id, title, summary, status, phase, instructor_note AS "instructorNote",
            investigator_enabled AS "investigatorEnabled", investigator_name AS "investigatorName",
            EXISTS (SELECT 1 FROM information_exchange ie
                    WHERE ie.case_id = cases.id AND ie.setup_completed_at IS NOT NULL) AS "exchangeReady"
     FROM cases WHERE course_id = $1 AND id = $2`,
    [courseId, caseId],
  )
  return rows[0] ?? null
}

/** The case world a team is in, or null before it's matched. */
export async function teamMatchupId(teamId: string) {
  const { rows } = await pool.query<{ matchupId: string }>(
    'SELECT matchup_id AS "matchupId" FROM matchup_teams WHERE team_id = $1',
    [teamId],
  )
  return rows[0]?.matchupId ?? null
}

/** What a student sees of the case file: their side's files, plus any shared with their team or world. */
export async function studentViewer(caseId: string, userId: string, side: Side | null): Promise<MaterialViewer> {
  const teamId = await findStudentTeamId(caseId, userId)
  return { side, teamId, matchupId: teamId ? await teamMatchupId(teamId) : null }
}

type WorkspaceTask = CaseWorkspace['tasks'][number]

const KIND_TASK: Record<ExchangeKind, string> = {
  interrogatories: 'interrogatories',
  rfas: 'requests for admission',
}

/**
 * The information exchange's tasks for a student: choosing their initial
 * disclosures (while that's open, or once done), and responding to each set
 * the other team sent.
 */
async function exchangeTasks(caseId: string, phase: CasePhase, teamId: string, side: Side, userId: string | null) {
  const settings = await getSettings(caseId)
  const tasks: WorkspaceTask[] = []
  if (settings.disclosures.enabled && userId) {
    const submission = await findSubmission(caseId, userId)
    if (submission || phase === 'introduction') {
      tasks.push({
        id: 'exchange:disclosures',
        title: 'Choose your initial disclosures',
        description: "Pick the witnesses and documents you'd disclose to opposing counsel, and say why.",
        dueAt: null,
        audience: side,
        completedAt: submission?.submittedAt ?? null,
        completedBy: submission ? 'you' : null,
        auto: true,
      })
    }
  }
  const { rows } = await pool.query<{
    id: string
    kind: ExchangeKind
    from: number
    dueAt: Date
    respondedAt: Date | null
    respondedBy: string | null
  }>(
    `SELECT r.id, r.kind, t.number AS "from", r.due_at AS "dueAt", r.responded_at AS "respondedAt", u.name AS "respondedBy"
     FROM exchange_requests r JOIN teams t ON t.id = r.from_team_id LEFT JOIN users u ON u.id = r.responded_by
     WHERE r.case_id = $1 AND r.to_team_id = $2 ORDER BY r.sent_at`,
    [caseId, teamId],
  )
  for (const r of rows) {
    tasks.push({
      id: `exchange:${r.id}`,
      title: `Respond to ${KIND_TASK[r.kind]} from Team ${r.from}`,
      description: 'Open the Information exchange tab to respond.',
      dueAt: r.dueAt,
      audience: side,
      completedAt: r.respondedAt,
      completedBy: r.respondedBy,
      auto: true,
    })
  }
  return tasks
}

/** Soonest due first; tasks with no due date last. */
const byDue = (a: WorkspaceTask, b: WorkspaceTask) =>
  (a.dueAt ? new Date(a.dueAt).getTime() : Infinity) - (b.dueAt ? new Date(b.dueAt).getTime() : Infinity)

async function assemble(
  { investigatorEnabled, investigatorName, exchangeReady, ...caseRow }: CaseRow,
  team: MyCase['team'],
  world: MyCase['world'],
  viewer: MaterialViewer,
  preview: boolean,
  userId: string | null = null,
): Promise<CaseWorkspace> {
  const { side, teamId } = viewer
  const audiences = visibleTo(side)
  const [materials, witnesses, tasks, completions, disclosed, autoTasks] = await Promise.all([
    listMaterialsFor(caseRow.id, viewer),
    listWitnesses(caseRow.id),
    listTasks(caseRow.id, audiences),
    teamId ? listCompletions(caseRow.id, teamId) : Promise.resolve([]),
    disclosedWitnessIds(caseRow.id),
    exchangeReady && teamId && side && !preview
      ? exchangeTasks(caseRow.id, caseRow.phase, teamId, side, userId)
      : Promise.resolve([]),
  ])
  const doneBy = new Map(completions.map((c) => [c.taskId, c]))
  return {
    case: caseRow,
    team,
    world,
    side,
    materials,
    witnesses: visibleWitnesses(witnesses, side, caseRow.phase, disclosed).map((w) => {
      const canAsk = interviewable(w, side, caseRow.phase)
      return {
        id: w.id,
        name: w.name,
        role: w.role,
        description: w.description,
        audience: w.audience,
        side: w.alignedSide,
        canInterview: isAiWitness(w) && canAsk,
        disclosed: !canAsk,
        avatarUrl: w.avatarUrl,
      }
    }),
    investigator: investigatorEnabled ? { name: investigatorName, avatarUrl: INVESTIGATOR_AVATAR_URL } : null,
    investigatorAvailable: investigatorEnabled && (caseRow.phase === 'investigate' || caseRow.phase === 'deposition'),
    exchangeReady,
    tasks: [
      ...tasks.map((t) => ({
        ...t,
        completedAt: doneBy.get(t.id)?.completedAt ?? null,
        completedBy: doneBy.get(t.id)?.completedBy ?? null,
      })),
      ...autoTasks,
    ].sort(byDue),
    preview,
  }
}

/** The student's own team id in a case, if they are on one. */
export async function findStudentTeamId(caseId: string, userId: string) {
  const { rows } = await pool.query<{ teamId: string }>(
    `SELECT m.team_id AS "teamId"
     FROM team_members m
     JOIN enrollments e ON e.course_id = m.course_id AND e.email = m.email
     WHERE m.case_id = $1 AND e.user_id = $2`,
    [caseId, userId],
  )
  return rows[0]?.teamId ?? null
}

/**
 * A student's case dashboard, or null unless the case is launched (not a
 * draft) and in a course they're enrolled in. Unpaired students still see the
 * shared material.
 */
export async function getStudentWorkspace(courseId: string, caseId: string, userId: string) {
  const myCase = (await listMyCases(courseId, userId)).find((c) => c.id === caseId)
  if (!myCase) return null
  const caseRow = (await findCaseRow(courseId, caseId))!
  const viewer = await studentViewer(caseId, userId, myCase.world?.side ?? null)
  return assemble(caseRow, myCase.team, myCase.world, viewer, false, userId)
}

/**
 * The case dashboard as the instructor previews it: as the team on `side` in
 * one matchup (with that team's task progress), or, with no matchup, as any
 * team on `side`. Null if the matchup isn't in this case.
 */
export async function getPreviewWorkspace(
  courseId: string,
  caseId: string,
  side: Side,
  matchupId: string | null,
): Promise<CaseWorkspace | null> {
  const caseRow = await findCaseRow(courseId, caseId)
  if (!caseRow) return null
  if (!matchupId) return assemble(caseRow, null, null, { side, teamId: null, matchupId: null }, true)

  const { teams, matchups } = await listTeams(courseId, caseId)
  const matchup = matchups.find((m) => m.id === matchupId)
  if (!matchup) return null
  const ownId = side === 'plaintiff' ? matchup.plaintiffTeamId : matchup.defenseTeamId
  const otherId = side === 'plaintiff' ? matchup.defenseTeamId : matchup.plaintiffTeamId
  const own = teams.find((t) => t.id === ownId)!
  const other = teams.find((t) => t.id === otherId)!
  const asMembers = (t: typeof own) => t.members.map((m) => ({ ...m, you: false }))
  return assemble(
    caseRow,
    { number: own.number, members: asMembers(own) },
    { number: matchup.number, side, opponents: { number: other.number, members: asMembers(other) } },
    { side, teamId: own.id, matchupId },
    true,
  )
}

export interface LaunchCheck {
  key: 'importantFacts' | 'paired' | 'matched' | 'caseFile'
  ok: boolean
  message: string
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** What has to be true before a case's worlds can launch. */
export async function launchChecks(courseId: string, caseId: string): Promise<LaunchCheck[]> {
  const { teams, unpaired, matchups } = await listTeams(courseId, caseId)
  const matched = new Set(matchups.flatMap((m) => [m.plaintiffTeamId, m.defenseTeamId]))
  const waiting = teams.filter((t) => !matched.has(t.id)).length
  const paired = teams.reduce((n, t) => n + t.members.length, 0)
  const { rows } = await pool.query<{ n: number; initial: string | null }>(
    `SELECT count(*)::int AS n, max(coalesce(nullif(description, ''), filename)) FILTER (WHERE initial) AS initial
     FROM case_materials WHERE case_id = $1`,
    [caseId],
  )
  const { n: files, initial } = rows[0]
  const { plaintiff, defense } = (await pool.query<{ plaintiff: number; defense: number }>(
    `SELECT cardinality(plaintiff_key_facts) AS plaintiff, cardinality(defense_key_facts) AS defense
     FROM cases WHERE id = $1`,
    [caseId],
  )).rows[0]

  return [
    {
      // The AI witnesses keep to these, so both sides need theirs before students start.
      key: 'importantFacts',
      ok: plaintiff > 0 && defense > 0,
      message:
        plaintiff > 0 && defense > 0
          ? `Important facts: ${plaintiff} for the plaintiff, ${defense} for the defense.`
          : 'Add at least one important fact for each side.',
    },
    {
      key: 'paired',
      ok: paired > 0 && unpaired.length === 0,
      message:
        paired === 0
          ? 'Pair students into teams.'
          : unpaired.length > 0
            ? `${plural(unpaired.length, 'student is', 'students are')} not on a team yet.`
            : `All ${plural(paired, 'student is', 'students are')} on a team.`,
    },
    {
      key: 'matched',
      ok: teams.length > 0 && waiting === 0,
      message:
        teams.length === 0
          ? 'Match teams into case worlds.'
          : waiting > 0
            ? `${plural(waiting, 'team is', 'teams are')} waiting for an opponent.`
            : `${plural(matchups.length, 'case world is', 'case worlds are')} set up.`,
    },
    {
      // Every team starts from the initial file, so the case can't launch without one.
      key: 'caseFile',
      ok: initial !== null,
      message:
        files === 0
          ? 'Upload the case file.'
          : initial === null
            ? 'Choose the initial file every team starts from.'
            : `Teams start from ${initial}; ${plural(files, 'case file is', 'case files are')} uploaded.`,
    },
  ]
}
