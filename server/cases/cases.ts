import { pool } from '../db/pool.ts'
import type { Db } from '../db/transaction.ts'
import { putFile } from '../files/fileStore.ts'
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
  class_id: string
  class_name: string
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
  storage_key: string
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
    classId: c.class_id,
    className: c.class_name,
    published: published(c),
  }
}

const SELECT_CASE = `
  SELECT ca.id, ca.class_id, cl.name AS class_name, ca.name,
         ca.documents_published_at, ca.characters_published_at, ca.teams_published_at
  FROM cases ca JOIN classes cl ON cl.id = ca.class_id`

export async function findCase(caseId: string) {
  if (!isUuid(caseId)) return null
  const { rows } = await pool.query<CaseRow>(`${SELECT_CASE} WHERE ca.id = $1`, [caseId])
  return rows[0] ?? null
}

export async function createCase(input: { name: string; classId: string; createdBy: string }) {
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO cases (class_id, name, created_by) VALUES ($1, $2, $3) RETURNING id',
    [input.classId, input.name, input.createdBy],
  )
  return toSummary((await findCase(rows[0].id))!)
}

/** Cases in every class the instructor teaches, newest first. */
export async function listInstructorCases(instructorId: string) {
  const { rows } = await pool.query<CaseRow>(
    `${SELECT_CASE}
     JOIN class_instructors ci ON ci.class_id = ca.class_id
     WHERE ci.user_id = $1
     ORDER BY ca.created_at DESC`,
    [instructorId],
  )
  return rows.map(toSummary)
}

/** Cases in the student's classes that have at least one section published. */
export async function listStudentCases(studentId: string) {
  const { rows } = await pool.query<CaseRow>(
    `${SELECT_CASE}
     JOIN class_students cs ON cs.class_id = ca.class_id
     WHERE cs.user_id = $1
       AND (ca.documents_published_at IS NOT NULL
            OR ca.characters_published_at IS NOT NULL
            OR ca.teams_published_at IS NOT NULL)
     ORDER BY ca.created_at DESC`,
    [studentId],
  )
  return rows.map(({ id, name, class_name }) => ({ id, name, className: class_name }))
}

async function classStudents(classId: string) {
  const { rows } = await pool.query<Person>(
    `SELECT u.id, u.name, u.email
     FROM class_students cs JOIN users u ON u.id = cs.user_id
     WHERE cs.class_id = $1
     ORDER BY u.name`,
    [classId],
  )
  return rows
}

async function listDocuments(caseId: string) {
  const { rows } = await pool.query<DocumentRow>(
    'SELECT * FROM case_documents WHERE case_id = $1 ORDER BY uploaded_at, filename',
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
    classStudents(c.class_id),
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

export async function addDocuments(
  db: Db,
  caseId: string,
  files: { filename: string; contentType: string; content: Buffer }[],
  side: DocSide,
) {
  const added = []
  for (const file of files) {
    const key = await putFile(db, file.content)
    const { rows } = await db.query<DocumentRow>(
      `INSERT INTO case_documents (case_id, filename, content_type, size_bytes, storage_key, side)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [caseId, file.filename, file.contentType, file.content.length, key, side],
    )
    added.push(toDocument(rows[0]))
  }
  return added
}

export async function findDocument(caseId: string, documentId: string) {
  if (!isUuid(documentId)) return null
  const { rows } = await pool.query<DocumentRow>(
    'SELECT * FROM case_documents WHERE id = $1 AND case_id = $2',
    [documentId, caseId],
  )
  return rows[0] ?? null
}

export async function setDocumentSide(caseId: string, documentId: string, side: DocSide) {
  const { rows } = await pool.query<DocumentRow>(
    'UPDATE case_documents SET side = $3 WHERE id = $1 AND case_id = $2 RETURNING *',
    [documentId, caseId, side],
  )
  return rows[0] ? toDocument(rows[0]) : null
}

/** Deletes the document row and returns its storage key, or null if it wasn't found. */
export async function deleteDocument(db: Db, caseId: string, documentId: string) {
  if (!isUuid(documentId)) return null
  const { rows } = await db.query<{ storage_key: string }>(
    'DELETE FROM case_documents WHERE id = $1 AND case_id = $2 RETURNING storage_key',
    [documentId, caseId],
  )
  return rows[0]?.storage_key ?? null
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
  const [students, existing] = await Promise.all([
    db.query<{ id: string; name: string }>(
      `SELECT u.id, u.name FROM class_students cs JOIN users u ON u.id = cs.user_id
       WHERE cs.class_id = $1 ORDER BY u.name`,
      [c.class_id],
    ),
    db.query<{ id: string; side: Side }>('SELECT id, side FROM teams WHERE case_id = $1', [c.id]),
  ])
  const enrolled = new Map(students.rows.map((s) => [s.id, s.name]))
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
      if (!name) throw new HttpError(400, `${team.name} has a student who isn't in this class.`)
      const other = placed.get(studentId)
      if (other) throw new HttpError(400, `${name} is on both ${other} and ${team.name}.`)
      placed.set(studentId, team.name)
    }
  }
  const unplaced = students.rows.filter((s) => !placed.has(s.id)).map((s) => s.name)
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

  return { id: c.id, name: c.name, className: c.class_name, published: isPublished, team, documents, characters }
}
