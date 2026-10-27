import { pool } from '../db/pool.ts'
import { HttpError } from '../httpError.ts'

// A course's calendar: tasks on their due dates, plus events. The instructor
// marks significant dates for a case (everyone in it sees them); anyone can
// keep personal reminders; a student can share one with their team.

export type CalendarKind = 'task' | 'case' | 'personal' | 'team'

/** Shape sent to the client; matches `CalendarItem` in src/courses/types.ts. */
export interface CalendarItem {
  id: string
  kind: CalendarKind
  title: string
  notes: string
  /** YYYY-MM-DD: the event's day, or the day a task is due. */
  date: string
  /** A task's exact due time. */
  dueAt: Date | null
  caseId: string | null
  caseTitle: string | null
  /** A team event's team. */
  teamNumber: number | null
  /** A student's task: whether their team has done it. */
  done: boolean | null
  /** Whether this user made it (and so can change it). */
  mine: boolean
}

/** Who's looking: the course's instructor, or an enrolled student. Throws 404 for anyone else. */
export async function calendarViewer(courseId: string, userId: string) {
  const { rows } = await pool.query<{ instructor: boolean }>(
    `SELECT c.instructor_id = $2 AS instructor FROM courses c
     WHERE c.id = $1
       AND (c.instructor_id = $2 OR EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = c.id AND e.user_id = $2))`,
    [courseId, userId],
  )
  if (!rows[0]) throw new HttpError(404, 'Course not found.')
  return { courseId, userId, instructor: rows[0].instructor }
}
export type CalendarViewer = Awaited<ReturnType<typeof calendarViewer>>

/** The student's teams in this course's launched cases, with each one's side. */
async function studentTeams(courseId: string, userId: string) {
  const { rows } = await pool.query<{ teamId: string; caseId: string; number: number; side: string | null }>(
    `SELECT t.id AS "teamId", t.case_id AS "caseId", t.number, mt.side
     FROM team_members m
     JOIN enrollments e ON e.course_id = m.course_id AND e.email = m.email
     JOIN teams t ON t.id = m.team_id
     JOIN cases c ON c.id = t.case_id AND c.status <> 'draft'
     LEFT JOIN matchup_teams mt ON mt.team_id = t.id
     WHERE m.course_id = $1 AND e.user_id = $2`,
    [courseId, userId],
  )
  return rows
}

const EVENT_COLUMNS = `ev.id, ev.kind, ev.title, ev.notes, to_char(ev.on_date, 'YYYY-MM-DD') AS date, NULL::timestamptz AS "dueAt",
  coalesce(ev.case_id, tm.case_id) AS "caseId", c.title AS "caseTitle", tm.number AS "teamNumber", NULL::boolean AS done,
  ev.created_by = $2 AS mine`
const EVENT_FROM = `FROM calendar_events ev
  LEFT JOIN teams tm ON tm.id = ev.team_id
  LEFT JOIN cases c ON c.id = coalesce(ev.case_id, tm.case_id)`

/** Everything on the viewer's calendar, soonest first. */
export async function listCalendar(viewer: CalendarViewer): Promise<CalendarItem[]> {
  const { courseId, userId } = viewer
  if (viewer.instructor) {
    const { rows } = await pool.query<CalendarItem>(
      `SELECT t.id, 'task' AS kind, t.title, t.description AS notes, to_char(t.due_at, 'YYYY-MM-DD') AS date, t.due_at AS "dueAt",
              c.id AS "caseId", c.title AS "caseTitle", NULL::int AS "teamNumber", NULL::boolean AS done, false AS mine
       FROM case_tasks t JOIN cases c ON c.id = t.case_id
       WHERE c.course_id = $1 AND c.status <> 'draft' AND t.due_at IS NOT NULL
       UNION ALL
       SELECT ${EVENT_COLUMNS} ${EVENT_FROM}
       WHERE ev.course_id = $1 AND (ev.kind = 'case' OR (ev.kind = 'personal' AND ev.created_by = $2))
       ORDER BY date, kind`,
      [courseId, userId],
    )
    return rows
  }
  const teams = await studentTeams(courseId, userId)
  const { rows } = await pool.query<CalendarItem>(
    `WITH mine AS (SELECT * FROM unnest($3::uuid[], $4::uuid[], $5::text[]) AS m(team_id, case_id, side))
     SELECT t.id, 'task' AS kind, t.title, t.description AS notes, to_char(t.due_at, 'YYYY-MM-DD') AS date, t.due_at AS "dueAt",
            c.id AS "caseId", c.title AS "caseTitle", NULL::int AS "teamNumber",
            EXISTS (SELECT 1 FROM task_completions tc WHERE tc.task_id = t.id AND tc.team_id = mine.team_id) AS done,
            false AS mine
     FROM mine JOIN cases c ON c.id = mine.case_id
     JOIN case_tasks t ON t.case_id = c.id AND t.audience IN ('all', coalesce(mine.side, 'all'))
     WHERE t.due_at IS NOT NULL
     UNION ALL
     SELECT ${EVENT_COLUMNS} ${EVENT_FROM}
     WHERE ev.course_id = $1
       AND ((ev.kind = 'case' AND ev.case_id IN (SELECT case_id FROM mine))
         OR (ev.kind = 'personal' AND ev.created_by = $2)
         OR (ev.kind = 'team' AND ev.team_id IN (SELECT team_id FROM mine)))
     ORDER BY date, kind`,
    [courseId, userId, teams.map((t) => t.teamId), teams.map((t) => t.caseId), teams.map((t) => t.side)],
  )
  return rows
}

export interface EventInput {
  kind: 'case' | 'personal' | 'team'
  title: string
  notes: string
  date: string
  /** A case date's case, or (for a team event) the case whose team to share with. */
  caseId: string | null
}

/** Adds an event, checking the viewer may: case dates are the instructor's, team events a student's. */
export async function createEvent(viewer: CalendarViewer, input: EventInput) {
  let caseId: string | null = null
  let teamId: string | null = null
  if (input.kind === 'case') {
    if (!viewer.instructor) throw new HttpError(403, 'Only the instructor marks dates for a case.')
    const { rows } = await pool.query('SELECT 1 FROM cases WHERE id = $1 AND course_id = $2', [input.caseId, viewer.courseId])
    if (!rows[0]) throw new HttpError(400, 'Choose a case in this course.')
    caseId = input.caseId
  } else if (input.kind === 'team') {
    if (viewer.instructor) throw new HttpError(400, 'Team events are for a team’s members.')
    const team = (await studentTeams(viewer.courseId, viewer.userId)).find((t) => t.caseId === input.caseId)
    if (!team) throw new HttpError(400, 'Choose a case you’re on a team in.')
    teamId = team.teamId
  }
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO calendar_events (course_id, kind, case_id, team_id, title, notes, on_date, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [viewer.courseId, input.kind, caseId, teamId, input.title, input.notes, input.date, viewer.userId],
  )
  return rows[0].id
}

/** Changes an event's title, notes, or day; only its creator can. */
export async function updateEvent(viewer: CalendarViewer, eventId: string, input: Pick<EventInput, 'title' | 'notes' | 'date'>) {
  const { rowCount } = await pool.query(
    `UPDATE calendar_events SET title = $4, notes = $5, on_date = $6
     WHERE id = $1 AND course_id = $2 AND created_by = $3`,
    [eventId, viewer.courseId, viewer.userId, input.title, input.notes, input.date],
  )
  if (!rowCount) throw new HttpError(404, 'Event not found.')
}

/** Deletes an event; only its creator can. */
export async function deleteEvent(viewer: CalendarViewer, eventId: string) {
  const { rowCount } = await pool.query('DELETE FROM calendar_events WHERE id = $1 AND course_id = $2 AND created_by = $3', [
    eventId,
    viewer.courseId,
    viewer.userId,
  ])
  if (!rowCount) throw new HttpError(404, 'Event not found.')
}
