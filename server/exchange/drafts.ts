import { pool } from '../db/pool.ts'
import { HttpError } from '../httpError.ts'
import { isUuid } from '../validation.ts'
import { MAX_ITEM_LENGTH, MAX_ITEMS_PER_SET, type TeamContext } from './exchange.ts'
import type { MentorTag } from './mentorPrompt.ts'
import { MAX_DESCRIPTION_LENGTH, MAX_JUSTIFICATION_LENGTH, MAX_RECIPIENT_LENGTH, MAX_RECORDS_LENGTH } from './subpoenas.ts'

// Drafts of a team's new subpoenas and sets, saved as the team writes them so
// a refresh or leaving the page doesn't lose the work. The whole team shares
// them (the last save wins). Sending one deletes its draft; so does Cancel.
// A draft keeps its last AI check (by id, so the tag and feedback come from
// the check itself) and the client's key for the draft it checked.

export type DraftKind = 'subpoena' | 'interrogatories' | 'rfas'
export const DRAFT_KINDS: readonly DraftKind[] = ['subpoena', 'interrogatories', 'rfas']

/** A subpoena as typed so far: any field may be blank. */
export interface SubpoenaDraftContent {
  recipient: string
  recipientDescription: string
  requestType: string
  records: string
  justification: string
}

export type DraftContent = SubpoenaDraftContent | { items: string[] }

export interface DiscoveryDraft {
  id: string
  kind: DraftKind
  content: DraftContent
  /** The last AI check of the draft, and the key of the draft it checked. */
  lastCheck: { id: string; tag: MentorTag; feedback: string; round: number; key: string } | null
  updatedAt: string
  updatedBy: string | null
}

const SELECT = `
  SELECT d.id, d.kind, d.content, d.updated_at AS "updatedAt", u.name AS "updatedBy",
         CASE WHEN c.id IS NULL THEN NULL
              ELSE json_build_object('id', c.id, 'tag', c.tag, 'feedback', c.feedback, 'round', c.round, 'key', d.check_key) END AS "lastCheck"
    FROM discovery_drafts d
    LEFT JOIN users u ON u.id = d.updated_by
    LEFT JOIN discovery_checks c ON c.id = d.check_id`

const text = (value: unknown, max: number, what: string) => {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new HttpError(400, `Send ${what} as text.`)
  if (value.length > max) throw new HttpError(400, `Keep ${what} to ${max} characters.`)
  return value
}

/** Checks a draft's content for its kind. Drafts may be incomplete, but not over the limits a submission has. */
export function readDraftContent(kind: DraftKind, body: unknown): DraftContent {
  const raw = (body ?? {}) as Record<string, unknown>
  if (kind === 'subpoena') {
    return {
      recipient: text(raw.recipient, MAX_RECIPIENT_LENGTH, 'who it’s for'),
      recipientDescription: text(raw.recipientDescription, MAX_DESCRIPTION_LENGTH, 'who they are'),
      requestType: text(raw.requestType, 40, 'the type of request'),
      records: text(raw.records, MAX_RECORDS_LENGTH, 'what you want'),
      justification: text(raw.justification, MAX_JUSTIFICATION_LENGTH, 'the justification'),
    }
  }
  const items = raw.items
  if (!Array.isArray(items) || items.some((t) => typeof t !== 'string')) throw new HttpError(400, 'Send the draft one line at a time.')
  if (items.length > MAX_ITEMS_PER_SET) throw new HttpError(400, `A set can have at most ${MAX_ITEMS_PER_SET} lines.`)
  if (items.some((t: string) => t.length > MAX_ITEM_LENGTH)) throw new HttpError(400, `Keep each line to ${MAX_ITEM_LENGTH} characters.`)
  return { items: items as string[] }
}

/**
 * The draft's last check, `{ id, key }`, if it's one of this team's checks of
 * this kind; anything else is dropped.
 */
async function readCheck(ctx: TeamContext, kind: DraftKind, body: unknown): Promise<{ id: string; key: string } | null> {
  const raw = body as Record<string, unknown> | null | undefined
  if (!raw || !isUuid(raw.id) || typeof raw.key !== 'string' || raw.key.length > 20000) return null
  const { rowCount } = await pool.query(
    `SELECT 1 FROM discovery_checks WHERE id = $1 AND case_id = $2 AND team_id = $3 AND kind = $4 AND mode = 'draft'`,
    [raw.id, ctx.caseId, ctx.teamId, kind],
  )
  return rowCount ? { id: raw.id as string, key: raw.key } : null
}

/** The team's drafts, newest first. */
export async function listDrafts(ctx: TeamContext): Promise<DiscoveryDraft[]> {
  const { rows } = await pool.query<DiscoveryDraft>(
    `${SELECT} WHERE d.case_id = $1 AND d.team_id = $2 ORDER BY d.updated_at DESC`,
    [ctx.caseId, ctx.teamId],
  )
  return rows
}

async function findDraft(id: string) {
  const { rows } = await pool.query<DiscoveryDraft>(`${SELECT} WHERE d.id = $1`, [id])
  return rows[0]
}

export async function createDraft(ctx: TeamContext, kind: DraftKind, content: unknown, lastCheck: unknown) {
  const draft = readDraftContent(kind, content)
  const check = await readCheck(ctx, kind, lastCheck)
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO discovery_drafts (case_id, team_id, kind, content, check_id, check_key, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [ctx.caseId, ctx.teamId, kind, JSON.stringify(draft), check?.id ?? null, check?.key ?? null, ctx.userId],
  )
  return findDraft(rows[0].id)
}

/** Saves the draft over what's there. */
export async function updateDraft(ctx: TeamContext, id: string, content: unknown, lastCheck: unknown) {
  if (!isUuid(id)) throw new HttpError(404, 'Draft not found.')
  const { rows } = await pool.query<{ kind: DraftKind }>('SELECT kind FROM discovery_drafts WHERE id = $1 AND case_id = $2 AND team_id = $3', [
    id,
    ctx.caseId,
    ctx.teamId,
  ])
  if (!rows[0]) throw new HttpError(404, 'Draft not found. A teammate may have sent or deleted it.')
  const { kind } = rows[0]
  const draft = readDraftContent(kind, content)
  const check = await readCheck(ctx, kind, lastCheck)
  await pool.query(
    `UPDATE discovery_drafts SET content = $2, check_id = $3, check_key = $4, updated_by = $5, updated_at = now() WHERE id = $1`,
    [id, JSON.stringify(draft), check?.id ?? null, check?.key ?? null, ctx.userId],
  )
  return findDraft(id)
}

/** Deletes the team's draft; a draft that's already gone is fine. */
export async function deleteDraft(ctx: TeamContext, id: unknown) {
  if (!isUuid(id)) return
  await pool.query('DELETE FROM discovery_drafts WHERE id = $1 AND case_id = $2 AND team_id = $3', [id, ctx.caseId, ctx.teamId])
}
