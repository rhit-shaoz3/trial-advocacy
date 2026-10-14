import { pool } from '../db/pool.ts'
import type { Db } from '../db/transaction.ts'
import { HttpError } from '../httpError.ts'
import { isUuid } from '../validation.ts'

export type Side = 'plaintiff' | 'defendant'
export type DocSide = Side | 'both'
export type CharacterRole = 'witness' | 'investigator'
export const SIDES: Side[] = ['plaintiff', 'defendant']
export const DOC_SIDES: DocSide[] = ['plaintiff', 'defendant', 'both']
export const CHARACTER_ROLES: CharacterRole[] = ['witness', 'investigator']

export interface CaseRow {
  id: string
  course_id: string
  /** e.g. "LAW 540: Trial Advocacy" */
  course_name: string
  instructor_id: string | null
  name: string
  documents_published_at: Date | null
  characters_published_at: Date | null
  teams_published_at: Date | null
}

interface Person {
  id: string
  name: string
  email: string
}

interface DocumentRow {
  id: string
  filename: string
  content_type: string
  size_bytes: number
  side: DocSide
  uploaded_at: Date
}

interface CharacterRow {
  id: string
  name: string
  title: string
  role: CharacterRole
  side: DocSide
}

// Shapes sent to the client; match the types in src/cases/types.ts.

export interface Team {
  id: string
  name: string
  side: Side
  members: Person[]
}

export type Section = 'documents' | 'characters' | 'teams'

function published(c: CaseRow): Record<Section, boolean> {
  return {
    documents: c.documents_published_at !== null,
    characters: c.characters_published_at !== null,
    teams: c.teams_published_at !== null,
  }
}

function toDocument(row: DocumentRow) {
  return {
    id: row.id,
    filename: row.filename,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    side: row.side,
    uploadedAt: row.uploaded_at.toISOString(),
  }
}

function toSummary(c: CaseRow) {
  return {
    id: c.id,
    name: c.name,
    courseId: c.course_id,
    courseName: c.course_name,
    published: published(c),
  }
}

const SELECT_CASE = `
  SELECT ca.id, ca.course_id, co.code || ': ' || co.title AS course_name, co.instructor_id,
         ca.name, ca.documents_published_at, ca.characters_published_at, ca.teams_published_at
  FROM cases ca JOIN courses co ON co.id = ca.course_id`

const ANY_PUBLISHED = `(ca.documents_published_at IS NOT NULL
  OR ca.characters_published_at IS NOT NULL
  OR ca.teams_published_at IS NOT NULL)`

export async function findCase(caseId: string) {
  if (!isUuid(caseId)) return null
  const { rows } = await pool.query<CaseRow>(`${SELECT_CASE} WHERE ca.id = $1`, [caseId])
  return rows[0] ?? null
}

export async function createCase(input: { name: string; courseId: string; createdBy: string }) {
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO cases (course_id, name, created_by) VALUES ($1, $2, $3) RETURNING id',
    [input.courseId, input.name, input.createdBy],
  )
  return toSummary((await findCase(rows[0].id))!)
}

/**
 * The course's cases, newest first. Students only get cases with at least
 * one section published.
 */
export async function listCourseCases(courseId: string, onlyPublished: boolean) {
  const { rows } = await pool.query<CaseRow>(
    `${SELECT_CASE}
     WHERE ca.course_id = $1 ${onlyPublished ? `AND ${ANY_PUBLISHED}` : ''}
     ORDER BY ca.created_at DESC`,
    [courseId],
  )
  return rows.map(toSummary)
}

/**
 * Every case the user can open, across their courses: all of them for the
 * instructor, ones with something published for a student.
 */
export async function listUserCases(user: { id: string; role: string }) {
  const { rows } = await pool.query<CaseRow>(
    user.role === 'instructor'
      ? `${SELECT_CASE} WHERE co.instructor_id = $1 ORDER BY ca.created_at DESC`
      : `${SELECT_CASE}
         JOIN enrollments e ON e.course_id = ca.course_id
         WHERE e.user_id = $1 AND e.status = 'joined' AND ${ANY_PUBLISHED}
         ORDER BY ca.created_at DESC`,
    [user.id],
  )
  return rows.map(toSummary)
}

/** Students who have joined the course (pending roster emails don't count). */
async function courseStudents(db: Db, courseId: string) {
  const { rows } = await db.query<Person>(
    `SELECT u.id, u.name, u.email
     FROM enrollments e JOIN users u ON u.id = e.user_id
     WHERE e.course_id = $1 AND e.status = 'joined'
     ORDER BY u.name`,
    [courseId],
  )
  return rows
}

// Everything but the file contents.
const DOCUMENT_COLUMNS = 'id, filename, content_type, size_bytes, side, uploaded_at'

async function listDocuments(caseId: string) {
  const { rows } = await pool.query<DocumentRow>(
    `SELECT ${DOCUMENT_COLUMNS} FROM case_documents WHERE case_id = $1 ORDER BY uploaded_at, filename`,
    [caseId],
  )
  return rows
}

async function listCharacters(caseId: string) {
  const { rows } = await pool.query<CharacterRow & { document_ids: string[] }>(
    `SELECT ch.id, ch.name, ch.title, ch.role, ch.side,
            coalesce(array_agg(cd.document_id) FILTER (WHERE cd.document_id IS NOT NULL), '{}')
              AS document_ids
     FROM case_characters ch
     LEFT JOIN character_documents cd ON cd.character_id = ch.id
     WHERE ch.case_id = $1
     GROUP BY ch.id
     ORDER BY ch.created_at, ch.name`,
    [caseId],
  )
  return rows
}

async function listTeams(caseId: string): Promise<Team[]> {
  const [teams, members] = await Promise.all([
    pool.query<{ id: string; name: string; side: Side }>(
      'SELECT id, name, side FROM teams WHERE case_id = $1 ORDER BY position, created_at',
      [caseId],
    ),
    pool.query<Person & { team_id: string }>(
      `SELECT tm.team_id, u.id, u.name, u.email
       FROM team_members tm JOIN users u ON u.id = tm.user_id
       WHERE tm.case_id = $1
       ORDER BY u.name`,
      [caseId],
    ),
  ])
  return teams.rows.map((t) => ({
    ...t,
    members: members.rows
      .filter((m) => m.team_id === t.id)
      .map(({ id, name, email }) => ({ id, name, email })),
  }))
}

async function listMatchups(caseId: string) {
  const { rows } = await pool.query<{
    id: string
    plaintiffTeamId: string
    defendantTeamId: string
  }>(
    `SELECT id, plaintiff_team_id AS "plaintiffTeamId", defendant_team_id AS "defendantTeamId"
     FROM matchups WHERE case_id = $1
     ORDER BY position, created_at`,
    [caseId],
  )
  return rows
}

/** Everything the instructor's case page needs. */
export async function getInstructorCase(c: CaseRow) {
  const [students, documents, characters, teams, matchups] = await Promise.all([
    courseStudents(pool, c.course_id),
    listDocuments(c.id),
    listCharacters(c.id),
    listTeams(c.id),
    listMatchups(c.id),
  ])
  return {
    ...toSummary(c),
    students,
    documents: documents.map(toDocument),
    characters: characters.map(({ document_ids, ...ch }) => ({ ...ch, documentIds: document_ids })),
    teams,
    matchups,
  }
}

// ---- Documents ----

export async function addDocument(input: {
  caseId: string
  filename: string
  contentType: string
  data: Buffer
  side: DocSide
  uploadedBy: string
}) {
  const { rows } = await pool.query<DocumentRow>(
    `INSERT INTO case_documents (case_id, filename, content_type, size_bytes, data, side, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${DOCUMENT_COLUMNS}`,
    [input.caseId, input.filename, input.contentType, input.data.length, input.data, input.side, input.uploadedBy],
  )
  return toDocument(rows[0])
}

/** The document's details, without its contents. */
export async function findDocument(caseId: string, documentId: string) {
  if (!isUuid(documentId)) return null
  const { rows } = await pool.query<DocumentRow>(
    `SELECT ${DOCUMENT_COLUMNS} FROM case_documents WHERE id = $1 AND case_id = $2`,
    [documentId, caseId],
  )
  return rows[0] ?? null
}

export async function findDocumentFile(caseId: string, documentId: string) {
  const { rows } = await pool.query<{ filename: string; contentType: string; data: Buffer }>(
    `SELECT filename, content_type AS "contentType", data
     FROM case_documents WHERE id = $1 AND case_id = $2`,
    [documentId, caseId],
  )
  return rows[0] ?? null
}

export async function setDocumentSide(caseId: string, documentId: string, side: DocSide) {
  const { rows } = await pool.query<DocumentRow>(
    `UPDATE case_documents SET side = $3 WHERE id = $1 AND case_id = $2 RETURNING ${DOCUMENT_COLUMNS}`,
    [documentId, caseId, side],
  )
  return rows[0] ? toDocument(rows[0]) : null
}

/** Returns false if there was no such document. */
export async function deleteDocument(caseId: string, documentId: string) {
  if (!isUuid(documentId)) return false
  const { rowCount } = await pool.query(
    'DELETE FROM case_documents WHERE id = $1 AND case_id = $2',
    [documentId, caseId],
  )
  return rowCount === 1
}

// ---- Characters ----

export interface CharacterInput {
  name: string
  title: string
  role: CharacterRole
  side: DocSide
}

export async function createCharacter(caseId: string, input: CharacterInput) {
  const { rows } = await pool.query<CharacterRow>(
    `INSERT INTO case_characters (case_id, name, title, role, side) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, title, role, side`,
    [caseId, input.name, input.title, input.role, input.side],
  )
  return { ...rows[0], documentIds: [] as string[] }
}

export async function updateCharacter(caseId: string, characterId: string, input: CharacterInput) {
  if (!isUuid(characterId)) return null
  const { rows } = await pool.query<CharacterRow>(
    `UPDATE case_characters SET name = $3, title = $4, role = $5, side = $6
     WHERE id = $1 AND case_id = $2
     RETURNING id, name, title, role, side`,
    [characterId, caseId, input.name, input.title, input.role, input.side],
  )
  return rows[0] ?? null
}

export async function deleteCharacter(caseId: string, characterId: string) {
  if (!isUuid(characterId)) return false
  const { rowCount } = await pool.query(
    'DELETE FROM case_characters WHERE id = $1 AND case_id = $2',
    [characterId, caseId],
  )
  return rowCount === 1
}

/** Links or unlinks a character and a document. Returns false if either isn't in the case. */
export async function setCharacterKnows(
  caseId: string,
  characterId: string,
  documentId: string,
  knows: boolean,
) {
  if (!isUuid(characterId) || !isUuid(documentId)) return false
  const { rows } = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM case_characters WHERE id = $1 AND case_id = $3)
        AND EXISTS (SELECT 1 FROM case_documents WHERE id = $2 AND case_id = $3) AS ok`,
    [characterId, documentId, caseId],
  )
  if (!rows[0].ok) return false
  await pool.query(
    knows
      ? `INSERT INTO character_documents (character_id, document_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`
      : 'DELETE FROM character_documents WHERE character_id = $1 AND document_id = $2',
    [characterId, documentId],
  )
  return true
}

// ---- Teams ----

export interface TeamInput {
  id?: string
  name: string
  side: Side
  studentIds: string[]
}

/**
 * Replaces the case's teams with `teams`. Teams sent with an id keep it (and
 * their matchups, unless their side changed); teams left out are deleted.
 */
export async function saveTeams(db: Db, c: CaseRow, teams: TeamInput[]) {
  const students = await courseStudents(db, c.course_id)
  const existing = await db.query<{ id: string; side: Side }>(
    'SELECT id, side FROM teams WHERE case_id = $1',
    [c.id],
  )
  const enrolled = new Map(students.map((s) => [s.id, s.name]))
  const existingSide = new Map(existing.rows.map((t) => [t.id, t.side]))

  const names = new Set<string>()
  const placed = new Map<string, string>() // student id -> team name
  for (const team of teams) {
    if (team.id !== undefined && !existingSide.has(team.id)) {
      throw new HttpError(400, 'One of these teams no longer exists. Reload and try again.')
    }
    if (!team.name) throw new HttpError(400, 'Every team needs a name.')
    const key = team.name.toLowerCase()
    if (names.has(key)) throw new HttpError(400, `There are two teams named "${team.name}".`)
    names.add(key)
    if (team.studentIds.length === 0) {
      throw new HttpError(400, `${team.name} needs at least one student.`)
    }
    for (const studentId of team.studentIds) {
      const name = enrolled.get(studentId)
      if (!name) throw new HttpError(400, `${team.name} has a student who isn't in this course.`)
      const other = placed.get(studentId)
      if (other) throw new HttpError(400, `${name} is on both ${other} and ${team.name}.`)
      placed.set(studentId, team.name)
    }
  }
  const unplaced = students.filter((s) => !placed.has(s.id)).map((s) => s.name)
  if (unplaced.length) {
    throw new HttpError(400, `Every student must be on a team. Not placed: ${unplaced.join(', ')}`)
  }

  const keptIds = teams.flatMap((t) => (t.id ? [t.id] : []))
  await db.query('DELETE FROM teams WHERE case_id = $1 AND id <> ALL($2::uuid[])', [c.id, keptIds])
  await db.query('DELETE FROM team_members WHERE case_id = $1', [c.id])

  for (const [position, team] of teams.entries()) {
    let teamId = team.id
    if (teamId) {
      if (existingSide.get(teamId) !== team.side) {
        // Its matchups would now pit a side against itself.
        await db.query(
          'DELETE FROM matchups WHERE plaintiff_team_id = $1 OR defendant_team_id = $1',
          [teamId],
        )
      }
      await db.query('UPDATE teams SET name = $2, side = $3, position = $4 WHERE id = $1', [
        teamId,
        team.name,
        team.side,
        position,
      ])
    } else {
      const { rows } = await db.query<{ id: string }>(
        'INSERT INTO teams (case_id, name, side, position) VALUES ($1, $2, $3, $4) RETURNING id',
        [c.id, team.name, team.side, position],
      )
      teamId = rows[0].id
    }
    await db.query(
      `INSERT INTO team_members (team_id, case_id, user_id)
       SELECT $1::uuid, $2::uuid, unnest($3::uuid[])`,
      [teamId, c.id, team.studentIds],
    )
  }
}

// ---- Matchups ----

export interface MatchupInput {
  plaintiffTeamId: string
  defendantTeamId: string
}

/** Replaces all of the case's matchups. */
export async function saveMatchups(db: Db, caseId: string, matchups: MatchupInput[]) {
  const { rows } = await db.query<{ id: string; side: Side }>(
    'SELECT id, side FROM teams WHERE case_id = $1',
    [caseId],
  )
  const sideOf = new Map(rows.map((t) => [t.id, t.side]))

  const seen = new Set<string>()
  for (const m of matchups) {
    if (sideOf.get(m.plaintiffTeamId) !== 'plaintiff' || sideOf.get(m.defendantTeamId) !== 'defendant') {
      throw new HttpError(400, 'Each matchup needs one plaintiff team and one defendant team from this case.')
    }
    const pair = `${m.plaintiffTeamId}:${m.defendantTeamId}`
    if (seen.has(pair)) throw new HttpError(400, 'The same two teams are matched up twice.')
    seen.add(pair)
  }

  await db.query('DELETE FROM matchups WHERE case_id = $1', [caseId])
  await db.query(
    `INSERT INTO matchups (case_id, plaintiff_team_id, defendant_team_id, position)
     SELECT $1::uuid, p, d, n - 1
     FROM unnest($2::uuid[], $3::uuid[]) WITH ORDINALITY AS m(p, d, n)`,
    [caseId, matchups.map((m) => m.plaintiffTeamId), matchups.map((m) => m.defendantTeamId)],
  )
}

// ---- Publishing ----

/** `true` publishes a section (keeping the original time), `false` hides it, omitted leaves it. */
export async function setPublished(caseId: string, changes: Partial<Record<Section, boolean>>) {
  const column = (value: boolean | undefined, name: string) =>
    value === undefined ? name : value ? `coalesce(${name}, now())` : 'NULL'
  await pool.query(
    `UPDATE cases SET
       documents_published_at = ${column(changes.documents, 'documents_published_at')},
       characters_published_at = ${column(changes.characters, 'characters_published_at')},
       teams_published_at = ${column(changes.teams, 'teams_published_at')}
     WHERE id = $1`,
    [caseId],
  )
}

// ---- What students see ----

/** The student's side, but only once teams are published (null otherwise). */
async function publishedSide(c: CaseRow, studentId: string) {
  if (!c.teams_published_at) return null
  const { rows } = await pool.query<{ side: Side }>(
    `SELECT t.side FROM team_members tm JOIN teams t ON t.id = tm.team_id
     WHERE tm.case_id = $1 AND tm.user_id = $2`,
    [c.id, studentId],
  )
  return rows[0]?.side ?? null
}

/** Side-tagged items stay hidden until teams are published, so they can't give a side away. */
function visibleTo(side: Side | null) {
  return (item: { side: DocSide }) => item.side === 'both' || item.side === side
}

export async function canStudentSeeDocument(c: CaseRow, studentId: string, doc: DocumentRow) {
  if (!c.documents_published_at) return false
  return visibleTo(await publishedSide(c, studentId))(doc)
}

export async function getStudentCase(c: CaseRow, studentId: string) {
  const isPublished = published(c)
  const side = await publishedSide(c, studentId)
  const visible = visibleTo(side)

  let team = null
  if (isPublished.teams) {
    const [teams, matchups] = await Promise.all([listTeams(c.id), listMatchups(c.id)])
    const mine = teams.find((t) => t.members.some((m) => m.id === studentId))
    if (mine) {
      const opponentIds = new Set(
        matchups.flatMap((m) =>
          m.plaintiffTeamId === mine.id
            ? [m.defendantTeamId]
            : m.defendantTeamId === mine.id
              ? [m.plaintiffTeamId]
              : [],
        ),
      )
      team = {
        id: mine.id,
        name: mine.name,
        side: mine.side,
        teammates: mine.members.filter((m) => m.id !== studentId),
        opponents: teams.filter((t) => opponentIds.has(t.id)),
      }
    }
  }

  const documents = isPublished.documents
    ? (await listDocuments(c.id)).filter(visible).map(toDocument)
    : null
  const characters = isPublished.characters
    ? (await listCharacters(c.id))
        .filter(visible)
        .map(({ id, name, title, role }) => ({ id, name, title, role }))
    : null

  return {
    id: c.id,
    name: c.name,
    courseName: c.course_name,
    published: isPublished,
    team,
    documents,
    characters,
  }
}

// ---- Course dashboard cards ----

const SIDE_NAMES: Record<Side, string> = { plaintiff: 'Plaintiff', defendant: 'Defendant' }

/**
 * The cases shown on the course dashboard, in the shape of `CaseSummary` in
 * src/workspace/types.ts. The instructor sees every case and how far along it
 * is; a student sees published cases from their side of the table.
 */
export async function listDashboardCases(courseId: string, user: { id: string; role: string }) {
  const isInstructor = user.role === 'instructor'
  const cases = await listCourseCases(courseId, !isInstructor)

  return Promise.all(
    cases.map(async (c) => {
      const [teams, matchups, counts] = await Promise.all([
        listTeams(c.id),
        listMatchups(c.id),
        pool.query<{ documents: number; characters: number }>(
          `SELECT (SELECT count(*)::int FROM case_documents WHERE case_id = $1) AS documents,
                  (SELECT count(*)::int FROM case_characters WHERE case_id = $1) AS characters`,
          [c.id],
        ),
      ])
      const base = { id: c.id, caseNumber: null, title: c.name, status: 'active' as const, progress: null, nextMilestone: null }

      if (isInstructor) {
        const { documents, characters } = counts.rows[0]
        const live = (Object.keys(c.published) as Section[]).filter((s) => c.published[s])
        return {
          ...base,
          caseType: `${documents} file${documents === 1 ? '' : 's'} · ${characters} character${characters === 1 ? '' : 's'}`,
          summary: live.length
            ? `Published to students: ${live.map((s) => (s === 'documents' ? 'case files' : s)).join(', ')}.`
            : 'Draft. Students can’t see this case yet.',
          participants: teams.flatMap((t) => t.members.map((m) => ({ name: m.name }))),
        }
      }

      const mine = c.published.teams
        ? teams.find((t) => t.members.some((m) => m.id === user.id))
        : undefined
      const opponentIds = new Set(
        matchups.flatMap((m) =>
          m.plaintiffTeamId === mine?.id ? [m.defendantTeamId] : m.defendantTeamId === mine?.id ? [m.plaintiffTeamId] : [],
        ),
      )
      const opponents = teams.filter((t) => opponentIds.has(t.id)).map((t) => t.name)
      return {
        ...base,
        caseType: mine ? `${SIDE_NAMES[mine.side]} · ${mine.name}` : 'Team assignment coming soon',
        summary: opponents.length ? `Against ${opponents.join(' and ')}.` : '',
        participants: mine ? mine.members.map((m) => ({ name: m.name })) : [],
      }
    }),
  )
}
