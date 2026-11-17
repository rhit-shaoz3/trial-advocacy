import { randomUUID } from 'node:crypto'
import {
  createMaterial,
  removeStoredFiles,
  shareMaterialWithTeam,
  type MaterialOwner,
  type MaterialSource,
} from '../courses/caseContent.ts'
import { pool } from '../db/pool.ts'
import { madeFileText, renderMadeFile, type MadeBy, type MadeFile } from '../investigator/records.ts'
import { storage } from '../storage/storage.ts'
import { queueGrouping } from './grouping.ts'

// The review of a written answer to a team: an investigator's report, or a
// client's email back. Both go the same way: the new facts it states, the
// case files it would unlock, and the documents written out with it (each a
// file in the team's world, for the instructor only until allowed) wait for
// the instructor's rulings, or in review lite stand at once; then the AI
// writes the clean copy the team gets, and the allowed files are shared.

/** The review kinds that are written answers (the rest are interviews). */
export const REPORT_KINDS = ['investigation', 'client_email'] as const
export type ReportKind = (typeof REPORT_KINDS)[number]

export interface ReportLayout {
  caseId: string
  matchupId: string | null
  teamNumber: number
  /** Review lite: the facts stand for the world and the files are allowed, without the instructor. */
  lite: boolean
  /** The answer without its review block and written-out documents. */
  body: string
  facts: string[]
  /** Case files it would unlock for the team. */
  unlockIds: string[]
  /** Documents written out with it, to become files in the team's world. */
  made: MadeFile[]
  /** Who wrote them out, by name, and as what. */
  madeBy: string
  by: MadeBy
  /** What the written-out files are, as case files. */
  source: Extract<MaterialSource, 'investigator' | 'client'>
  /** Who owns the written-out files: a third party's unless said otherwise (a client's are their side's). */
  owner?: MaterialOwner
  recordsRequested: string[]
  reviewBlockMissing: boolean
}

const safeFilename = (title: string) => `${title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()}.pdf`

/**
 * Lays the answer out for the instructor's review (replacing what an earlier
 * try laid out), or in review lite rules on it at once. Returns the review's
 * new status: open, or finalizing (lite).
 */
export async function layOutReport(id: string, input: ReportLayout): Promise<'open' | 'finalizing'> {
  // The documents written out, drawn and stored before they're added to the case.
  const made = await Promise.all(
    input.made.map(async (file) => {
      const materialId = randomUUID()
      const data = Buffer.from(await renderMadeFile(file, input.madeBy, input.teamNumber, new Date(), input.by))
      const storageKey = `cases/${input.caseId}/${materialId}`
      await storage.put(storageKey, data, 'application/pdf')
      return { file, materialId, storageKey, size: data.length }
    }),
  )

  const client = await pool.connect()
  let replaced: string[] = []
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM review_facts WHERE review_id = $1', [id])
    // A retry replaces what an earlier try made.
    const { rows: earlier } = await client.query<{ id: string; key: string | null }>(
      `DELETE FROM case_materials WHERE source IN ('investigator', 'client')
         AND id IN (SELECT material_id FROM review_documents WHERE review_id = $1)
       RETURNING id, storage_key AS key`,
      [id],
    )
    replaced = earlier.flatMap((m) => (m.key ? [m.key] : []))
    await client.query('DELETE FROM review_documents WHERE review_id = $1', [id])
    const lite = input.lite
    for (const [position, fact] of input.facts.entries()) {
      await client.query(
        `INSERT INTO review_facts (review_id, position, text, decision, decided_at, auto)
         VALUES ($1, $2, $3, CASE WHEN $4 THEN 'accept_world' END, CASE WHEN $4 THEN now() END, $4)`,
        [id, position, fact, lite],
      )
    }
    for (const [position, materialId] of input.unlockIds.entries()) {
      await client.query(
        `INSERT INTO review_documents (review_id, material_id, position, decision, auto)
         VALUES ($1, $2, $3, CASE WHEN $4 THEN 'allow' END, $4)`,
        [id, materialId, position, lite],
      )
    }
    // Each written-out document is a file in the team's world, for the instructor only until it's allowed.
    for (const [i, m] of made.entries()) {
      await createMaterial(
        {
          id: m.materialId,
          caseId: input.caseId,
          audience: 'instructor',
          filename: safeFilename(m.file.title),
          description: m.file.title,
          contentType: 'application/pdf',
          sizeBytes: m.size,
          storageKey: m.storageKey,
          uploadedBy: null,
          matchupId: input.matchupId,
          source: input.source,
          owner: input.owner,
        },
        client,
      )
      // Its text is known, so witnesses and later answers can read it once it's allowed.
      await client.query(`UPDATE case_materials SET text_status = 'ready', text_content = $2 WHERE id = $1`, [
        m.materialId,
        madeFileText(m.file, input.madeBy, input.by),
      ])
      await client.query(
        `INSERT INTO review_documents (review_id, material_id, position, decision, auto)
         VALUES ($1, $2, $3, CASE WHEN $4 THEN 'allow' END, $4)`,
        [id, m.materialId, input.unlockIds.length + i, lite],
      )
    }
    // Otherwise every answer waits for the instructor, even with nothing to rule on.
    const status = lite ? 'finalizing' : 'open'
    await client.query(
      `UPDATE interview_reviews
       SET report = $2, records_requested = $3, review_block_missing = $4, error = NULL, status = $5
       WHERE id = $1`,
      [id, input.body, input.recordsRequested, input.reviewBlockMissing, status],
    )
    await client.query('COMMIT')
    await removeStoredFiles(replaced)
    if (status === 'open') queueGrouping(input.caseId)
    return status
  } catch (err) {
    await client.query('ROLLBACK')
    await removeStoredFiles(made.map((m) => m.storageKey))
    throw err
  } finally {
    client.release()
  }
}

/** What the clean copy is written from: the answer, and what the instructor turned down. */
export interface ReportRulings {
  teamId: string | null
  report: string
  deniedFacts: string[]
  deniedTitles: string[]
}

/** The answer and the instructor's rulings on it, for writing the team's clean copy; null if it's gone. */
export async function reportRulings(id: string): Promise<ReportRulings | null> {
  const { rows } = await pool.query<{ teamId: string | null; report: string }>(
    'SELECT team_id AS "teamId", report FROM interview_reviews WHERE id = $1',
    [id],
  )
  if (!rows[0]) return null
  const { rows: facts } = await pool.query<{ text: string; decision: string }>(
    'SELECT text, decision FROM review_facts WHERE review_id = $1 ORDER BY position',
    [id],
  )
  const { rows: docs } = await pool.query<{ title: string; decision: string }>(
    `SELECT coalesce(nullif(m.description, ''), m.filename) AS title, d.decision
     FROM review_documents d JOIN case_materials m ON m.id = d.material_id
     WHERE d.review_id = $1 ORDER BY d.position`,
    [id],
  )
  return {
    ...rows[0],
    deniedFacts: facts.filter((f) => f.decision.startsWith('deny')).map((f) => f.text),
    deniedTitles: docs.filter((d) => d.decision !== 'allow').map((d) => d.title),
  }
}

/** Shares the allowed files with the team (and takes back the rest), stores the clean copy, and completes the review. */
export async function completeReport(id: string, teamId: string | null, finalReport: string) {
  const { rows: docs } = await pool.query<{ materialId: string; decision: string }>(
    'SELECT material_id AS "materialId", decision FROM review_documents WHERE review_id = $1',
    [id],
  )
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (teamId) {
      for (const doc of docs.filter((d) => d.decision === 'allow')) await shareMaterialWithTeam(doc.materialId, teamId, client)
      // A file the instructor took back after all (from a student's flag, say).
      for (const doc of docs.filter((d) => d.decision !== 'allow')) {
        await client.query('DELETE FROM material_shares WHERE material_id = $1 AND team_id = $2', [doc.materialId, teamId])
      }
    }
    await client.query(
      `UPDATE interview_reviews SET final_report = $2, status = 'completed', completed_at = coalesce(completed_at, now()), error = NULL
       WHERE id = $1`,
      [id, finalReport],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
