import { pool } from '../db/pool.ts'
import { HttpError } from '../httpError.ts'
import { isUuid } from '../validation.ts'

// Drafts of a team's emails to the investigator and to its clients, kept
// until they're sent or deleted, so the team can come back to one (often
// one it started from its planner). The whole team shares them; the last
// save wins. Sending one deletes it.

export const MESSAGE_DRAFT_KINDS = ['investigator', 'client_email'] as const
export type MessageDraftKind = (typeof MESSAGE_DRAFT_KINDS)[number]

const MAX_BODY_LENGTH = 4000
const MAX_SUBJECT_LENGTH = 200

export type MessageDraftContent = { assignment: string } | { to: string[]; subject: string; body: string }

// Shape sent to the client; matches `MessageDraft` in src/courses/types.ts.
export interface MessageDraft {
  id: string
  kind: MessageDraftKind
  content: MessageDraftContent
  updatedAt: Date
  updatedBy: string | null
}

export interface DraftTeam {
  caseId: string
  teamId: string
  userId: string
}

const text = (value: unknown, max: number, what: string) => {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new HttpError(400, `Send ${what} as text.`)
  if (value.length > max) throw new HttpError(400, `Keep ${what} to ${max} characters.`)
  return value
}

/** Checks a draft's content for its kind; a draft may be incomplete, but not over the limits a sent one has. */
function readContent(kind: MessageDraftKind, raw: unknown): MessageDraftContent {
  const c = (raw ?? {}) as Record<string, unknown>
  if (kind === 'investigator') return { assignment: text(c.assignment, MAX_BODY_LENGTH, 'the assignment') }
  const to = Array.isArray(c.to) ? c.to.filter(isUuid) : []
  return { to: [...new Set(to)], subject: text(c.subject, MAX_SUBJECT_LENGTH, 'the subject'), body: text(c.body, MAX_BODY_LENGTH, 'the email') }
}

const SELECT = `SELECT d.id, d.kind, d.content, d.updated_at AS "updatedAt", u.name AS "updatedBy"
  FROM message_drafts d LEFT JOIN users u ON u.id = d.updated_by`

/** The team's drafts, newest first. */
export async function listMessageDrafts(caseId: string, teamId: string) {
  const { rows } = await pool.query<MessageDraft>(`${SELECT} WHERE d.case_id = $1 AND d.team_id = $2 ORDER BY d.updated_at DESC`, [
    caseId,
    teamId,
  ])
  return rows
}

/** Saves a new draft `{ kind, content }`. */
export async function createMessageDraft(team: DraftTeam, body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>
  const kind = b.kind as MessageDraftKind
  if (!MESSAGE_DRAFT_KINDS.includes(kind)) throw new HttpError(400, 'Choose an email to the investigator or to your client.')
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO message_drafts (case_id, team_id, kind, content, updated_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [team.caseId, team.teamId, kind, JSON.stringify(readContent(kind, b.content)), team.userId],
  )
  return (await pool.query<MessageDraft>(`${SELECT} WHERE d.id = $1`, [rows[0].id])).rows[0]
}

/** Saves over one of the team's drafts: `{ content }`. */
export async function updateMessageDraft(team: DraftTeam, id: string, body: unknown) {
  const { rows } = isUuid(id)
    ? await pool.query<{ kind: MessageDraftKind }>('SELECT kind FROM message_drafts WHERE id = $1 AND case_id = $2 AND team_id = $3', [
        id,
        team.caseId,
        team.teamId,
      ])
    : { rows: [] }
  if (!rows[0]) throw new HttpError(404, 'Draft not found. A teammate may have sent or deleted it.')
  const content = readContent(rows[0].kind, (body as Record<string, unknown> | undefined)?.content)
  await pool.query('UPDATE message_drafts SET content = $2, updated_by = $3, updated_at = now() WHERE id = $1', [
    id,
    JSON.stringify(content),
    team.userId,
  ])
  return (await pool.query<MessageDraft>(`${SELECT} WHERE d.id = $1`, [id])).rows[0]
}

/** Deletes one of the team's drafts; one that's already gone is fine. */
export async function deleteMessageDraft(team: Pick<DraftTeam, 'caseId' | 'teamId'>, id: unknown) {
  if (!isUuid(id)) return
  await pool.query('DELETE FROM message_drafts WHERE id = $1 AND case_id = $2 AND team_id = $3', [id, team.caseId, team.teamId])
}
