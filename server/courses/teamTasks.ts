import { pool } from '../db/pool.ts'
import { HttpError } from '../httpError.ts'
import { isUuid } from '../validation.ts'

// A team's own to-dos, beside the instructor's tasks: most come from its
// planner, like the questions it means to ask a witness. One for a witness
// shows on that witness's interview too. Either teammate can tick one off,
// or delete it.

export const MAX_TEAM_TASK_LENGTH = 500

export interface TeamTask {
  id: string
  title: string
  witnessId: string | null
  gapId: string | null
  createdBy: string | null
  completedAt: Date | null
  completedBy: string | null
  createdAt: Date
}

const COLUMNS = `t.id, t.title, t.witness_id AS "witnessId", t.gap_id AS "gapId", cu.name AS "createdBy",
  t.completed_at AS "completedAt", du.name AS "completedBy", t.created_at AS "createdAt"`

const FROM = 'FROM team_tasks t LEFT JOIN users cu ON cu.id = t.created_by LEFT JOIN users du ON du.id = t.completed_by'

/** The team's tasks in the case, oldest first. */
export async function listTeamTasks(caseId: string, teamId: string) {
  const { rows } = await pool.query<TeamTask>(`SELECT ${COLUMNS} ${FROM} WHERE t.case_id = $1 AND t.team_id = $2 ORDER BY t.created_at`, [
    caseId,
    teamId,
  ])
  return rows
}

/** The team's tasks for one witness, oldest first. */
export async function witnessTasks(teamId: string, witnessId: string) {
  const { rows } = await pool.query<TeamTask>(`SELECT ${COLUMNS} ${FROM} WHERE t.team_id = $1 AND t.witness_id = $2 ORDER BY t.created_at`, [
    teamId,
    witnessId,
  ])
  return rows
}

/** Adds a task `{ title, witnessId?, gapId? }`: the witness one the team can see, the gap one of its own. */
export async function createTeamTask(team: { caseId: string; teamId: string; userId: string }, body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>
  const title = typeof b.title === 'string' ? b.title.trim() : ''
  if (!title) throw new HttpError(400, 'Write what the task is.')
  if (title.length > MAX_TEAM_TASK_LENGTH) throw new HttpError(400, `Keep the task to ${MAX_TEAM_TASK_LENGTH} characters.`)
  let witnessId: string | null = null
  if (b.witnessId) {
    const { rows } = isUuid(b.witnessId)
      ? await pool.query('SELECT 1 FROM case_witnesses WHERE id = $1 AND case_id = $2 AND NOT hidden', [b.witnessId, team.caseId])
      : { rows: [] }
    if (!rows[0]) throw new HttpError(400, 'Choose a witness from this case.')
    witnessId = b.witnessId as string
  }
  let gapId: string | null = null
  if (b.gapId) {
    const { rows } = isUuid(b.gapId)
      ? await pool.query('SELECT 1 FROM planner_gaps WHERE id = $1 AND case_id = $2 AND team_id = $3', [b.gapId, team.caseId, team.teamId])
      : { rows: [] }
    if (!rows[0]) throw new HttpError(400, 'That gap is gone. A teammate may have deleted it.')
    gapId = b.gapId as string
  }
  await pool.query(
    'INSERT INTO team_tasks (case_id, team_id, title, witness_id, gap_id, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
    [team.caseId, team.teamId, title, witnessId, gapId, team.userId],
  )
}

export async function setTeamTaskDone(caseId: string, teamId: string, taskId: string, userId: string, done: boolean) {
  await pool.query(
    `UPDATE team_tasks SET completed_at = CASE WHEN $4 THEN coalesce(completed_at, now()) END,
       completed_by = CASE WHEN $4 THEN coalesce(completed_by, $5) END
     WHERE id = $1 AND case_id = $2 AND team_id = $3`,
    [taskId, caseId, teamId, done, userId],
  )
}

export async function deleteTeamTask(caseId: string, teamId: string, taskId: string) {
  if (!isUuid(taskId)) return
  await pool.query('DELETE FROM team_tasks WHERE id = $1 AND case_id = $2 AND team_id = $3', [taskId, caseId, teamId])
}
