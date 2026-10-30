import { randomUUID } from 'node:crypto'
import { findUserByEmail } from '../auth/users.ts'
import { pool } from '../db/pool.ts'
import { HttpError } from '../httpError.ts'
import { storage } from '../storage/storage.ts'
import { findCase } from './cases.ts'
import { findTaughtCourse } from './courses.ts'

// Copying a case: an instructor duplicates one into a class they teach, or
// another instructor accepts one that was shared with them. The copy is the
// case as written, not as played: its details, important facts, background
// investigator, witnesses (pictures and the files they know), case files with
// the text the AI read from them (instructors only, except the starting
// file), the information exchange setup, and, if asked, its tasks without due
// dates. Teams, worlds, and everything from playing it (interviews, rulings on
// facts, requests, subpoenas and their responses, shared files) stay behind.
// The copy is a draft in the introduction phase, whose setup is just its
// teams and worlds.

export interface CopyOptions {
  includeTasks: boolean
  /** The copy's title; the original's when not given. */
  title?: string
}

/** Copies the case into `targetCourseId` and returns the copy's id. */
export async function copyCase(sourceCaseId: string, targetCourseId: string, actorId: string, options: CopyOptions) {
  const newCaseId = randomUUID()
  // Stored files are copied first (storage isn't transactional); if the copy fails, they're removed.
  const copiedKeys: string[] = []
  const client = await pool.connect()
  try {
    const { rows: sourceRows } = await client.query<{ title: string; owner: string | null }>(
      `SELECT c.title, coalesce(u.name, u.email) AS owner
       FROM cases c JOIN courses co ON co.id = c.course_id LEFT JOIN users u ON u.id = co.instructor_id
       WHERE c.id = $1`,
      [sourceCaseId],
    )
    if (!sourceRows[0]) throw new HttpError(404, 'Case not found.')
    const title = options.title?.trim() || sourceRows[0].title

    await client.query('BEGIN')
    await client.query(
      `INSERT INTO cases (id, course_id, title, summary, status, phase, instructor_note, disputed_issues,
         plaintiff_key_facts, defense_key_facts, plaintiff_name, defendant_name,
         investigator_enabled, investigator_name, investigator_instructions, review_mode,
         setup_step, setup_completed_at, witness_suggestions_done_at, copy_setup, copied_from_title, copied_from_name)
       SELECT $2, $3, $4, summary, 'draft', 'introduction', instructor_note, disputed_issues,
         plaintiff_key_facts, defense_key_facts, plaintiff_name, defendant_name,
         investigator_enabled, investigator_name, investigator_instructions, review_mode,
         'worlds', NULL, now(), true, title, $5
       FROM cases WHERE id = $1`,
      [sourceCaseId, newCaseId, targetCourseId, title, sourceRows[0].owner],
    )

    // The instructor's case files, not files generated in play (a world's subpoena responses).
    const { rows: materials } = await client.query<{ id: string; storageKey: string | null }>(
      `SELECT id, storage_key AS "storageKey" FROM case_materials
       WHERE case_id = $1 AND source = 'instructor' AND matchup_id IS NULL ORDER BY uploaded_at`,
      [sourceCaseId],
    )
    const materialIds = new Map<string, string>()
    for (const m of materials) {
      const id = randomUUID()
      materialIds.set(m.id, id)
      const key = m.storageKey ? `cases/${newCaseId}/${id}` : null
      if (m.storageKey && key) {
        await storage.copy(m.storageKey, key)
        copiedKeys.push(key)
      }
      // The text the AI read comes along, so nothing is read again.
      await client.query(
        `INSERT INTO case_materials (id, case_id, audience, filename, description, content_type, size_bytes, data,
           storage_key, uploaded_by, uploaded_at, text_status, text_content, text_error, initial, source)
         SELECT $2, $3, CASE WHEN initial THEN 'all' ELSE 'instructor' END, filename, description, content_type,
           size_bytes, data, $4, $5, uploaded_at, text_status, text_content, text_error, initial, source
         FROM case_materials WHERE id = $1`,
        [m.id, id, newCaseId, key, actorId],
      )
    }
    const remap = (id: string | null) => (id ? (materialIds.get(id) ?? null) : null)

    const { rows: witnesses } = await client.query<{
      id: string
      depositionMaterialId: string | null
      knownMaterialIds: string[]
      avatarKey: string | null
    }>(
      `SELECT id, deposition_material_id AS "depositionMaterialId", known_material_ids AS "knownMaterialIds",
              avatar_key AS "avatarKey"
       FROM case_witnesses WHERE case_id = $1 ORDER BY created_at`,
      [sourceCaseId],
    )
    const witnessIds = new Map<string, string>()
    for (const w of witnesses) {
      const id = randomUUID()
      witnessIds.set(w.id, id)
      let avatarKey: string | null = null
      if (w.avatarKey) {
        avatarKey = `witnesses/${id}/${randomUUID()}`
        await storage.copy(w.avatarKey, avatarKey)
        copiedKeys.push(avatarKey)
      }
      await client.query(
        `INSERT INTO case_witnesses (id, case_id, name, role, description, audience, created_at, aligned_side,
           persona_notes, deposition_material_id, known_material_ids, defending_counsel, avatar_preset, avatar_key)
         SELECT $2, $3, name, role, description, audience, created_at, aligned_side,
           persona_notes, $4, $5, defending_counsel, avatar_preset, $6
         FROM case_witnesses WHERE id = $1`,
        [
          w.id,
          id,
          newCaseId,
          remap(w.depositionMaterialId),
          w.knownMaterialIds.map(remap).filter((m): m is string => m !== null),
          avatarKey,
        ],
      )
    }

    if (options.includeTasks) {
      // Last term's dates don't carry over; the instructor sets new ones.
      await client.query(
        `INSERT INTO case_tasks (case_id, title, description, due_at, audience, created_at)
         SELECT $2, title, description, NULL, audience, created_at FROM case_tasks WHERE case_id = $1`,
        [sourceCaseId, newCaseId],
      )
    }

    // The exchange setup, for the instructor to look over and finish again.
    await client.query(
      `INSERT INTO information_exchange (case_id, disclosures_enabled, subpoenas_enabled, subpoena_limit, subpoena_days,
         subpoena_types, interrogatories_enabled, interrogatory_limit, interrogatory_days, rfas_enabled, rfa_limit,
         rfa_days, plaintiff_firm, plaintiff_partner, defense_firm, defense_partner, subpoena_ai_feedback,
         subpoena_ai_rounds, interrogatory_ai_feedback, interrogatory_ai_rounds, rfa_ai_feedback, rfa_ai_rounds,
         setup_completed_at)
       SELECT $2, disclosures_enabled, subpoenas_enabled, subpoena_limit, subpoena_days,
         subpoena_types, interrogatories_enabled, interrogatory_limit, interrogatory_days, rfas_enabled, rfa_limit,
         rfa_days, plaintiff_firm, plaintiff_partner, defense_firm, defense_partner, subpoena_ai_feedback,
         subpoena_ai_rounds, interrogatory_ai_feedback, interrogatory_ai_rounds, rfa_ai_feedback, rfa_ai_rounds, NULL
       FROM information_exchange WHERE case_id = $1`,
      [sourceCaseId, newCaseId],
    )
    const { rows: disclosed } = await client.query<{ materialId: string | null; witnessId: string | null }>(
      `SELECT material_id AS "materialId", witness_id AS "witnessId" FROM disclosure_items WHERE case_id = $1`,
      [sourceCaseId],
    )
    for (const d of disclosed) {
      const materialId = remap(d.materialId)
      const witnessId = d.witnessId ? (witnessIds.get(d.witnessId) ?? null) : null
      if (!materialId && !witnessId) continue
      await client.query('INSERT INTO disclosure_items (case_id, material_id, witness_id) VALUES ($1, $2, $3)', [
        newCaseId,
        materialId,
        witnessId,
      ])
    }

    await client.query('COMMIT')
    return newCaseId
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    await storage.delete(copiedKeys).catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/** Duplicates a case into a class the instructor teaches. */
export async function duplicateCase(sourceCaseId: string, instructorId: string, targetCourseId: string, options: CopyOptions) {
  if (!(await findTaughtCourse(targetCourseId, instructorId))) throw new HttpError(404, 'Class not found.')
  const id = await copyCase(sourceCaseId, targetCourseId, instructorId, options)
  return (await findCase(targetCourseId, id))!
}

// Sharing ----------------------------------------------------------------------

// Shape sent to the client; matches `SharedCase` in src/courses/types.ts.
export interface SharedCase {
  id: string
  caseTitle: string
  summary: string
  fromName: string | null
  fromEmail: string | null
  sharedAt: Date
  includeTasks: boolean
}

/**
 * Shares the case with the instructor who has this email; they accept or
 * decline it. Sharing again with the same person refreshes it.
 */
export async function shareCase(caseId: string, fromUserId: string, email: string, includeTasks: boolean) {
  const address = email.trim()
  if (!address) throw new HttpError(400, "Enter the instructor's email.")
  const user = await findUserByEmail(address)
  if (!user) throw new HttpError(404, 'No one has an account with that email.')
  if (user.role === 'student') throw new HttpError(400, 'That email belongs to a student. Cases can only be shared with instructors.')
  if (user.id === fromUserId) throw new HttpError(400, "That's you. Use Duplicate to copy a case into one of your classes.")
  await pool.query(
    `INSERT INTO case_shares (case_id, from_user_id, to_user_id, include_tasks) VALUES ($1, $2, $3, $4)
     ON CONFLICT (case_id, to_user_id) DO UPDATE SET from_user_id = $2, include_tasks = $4, created_at = now()`,
    [caseId, fromUserId, user.id, includeTasks],
  )
  return { toName: user.name, toEmail: user.email }
}

/** The cases shared with this instructor that they haven't accepted or declined, newest first. */
export async function listSharedCases(userId: string) {
  const { rows } = await pool.query<SharedCase>(
    `SELECT s.id, c.title AS "caseTitle", c.summary, u.name AS "fromName", u.email AS "fromEmail",
            s.created_at AS "sharedAt", s.include_tasks AS "includeTasks"
     FROM case_shares s JOIN cases c ON c.id = s.case_id LEFT JOIN users u ON u.id = s.from_user_id
     WHERE s.to_user_id = $1
     ORDER BY s.created_at DESC`,
    [userId],
  )
  return rows
}

async function findShare(shareId: string, userId: string) {
  const { rows } = await pool.query<{ caseId: string; includeTasks: boolean }>(
    'SELECT case_id AS "caseId", include_tasks AS "includeTasks" FROM case_shares WHERE id = $1 AND to_user_id = $2',
    [shareId, userId],
  )
  if (!rows[0]) throw new HttpError(404, 'That shared case is no longer waiting for you.')
  return rows[0]
}

/** Copies a shared case into one of the recipient's classes; the share is done. */
export async function acceptSharedCase(shareId: string, userId: string, courseId: string) {
  const share = await findShare(shareId, userId)
  if (!(await findTaughtCourse(courseId, userId))) throw new HttpError(404, 'Class not found.')
  const id = await copyCase(share.caseId, courseId, userId, { includeTasks: share.includeTasks })
  await pool.query('DELETE FROM case_shares WHERE id = $1', [shareId])
  return (await findCase(courseId, id))!
}

export async function declineSharedCase(shareId: string, userId: string) {
  await findShare(shareId, userId)
  await pool.query('DELETE FROM case_shares WHERE id = $1', [shareId])
}
