import { ai, AiNotConfiguredError } from '../ai/ai.ts'
import { listMaterialTexts } from '../courses/caseContent.ts'
import type { CourseCase, ImportantFacts } from '../courses/cases.ts'
import type { Side } from '../courses/matchups.ts'
import { pool } from '../db/pool.ts'
import type { FactDecision } from './reviews.ts'

// The instructor's running list of facts for a case, beside the review queue:
// what the case files say (read by the AI, in the background, whenever the
// instructor's files change), the important facts for each side, what's been
// ruled for every world, and what's been ruled in each world. The rulings
// follow the same rule as settledFacts in reviews.ts: completed reviews only.

export type FileFactsStatus = 'none' | 'working' | 'ready' | 'failed'

// Shapes sent to the client; match `CaseFacts` in src/courses/types.ts.
export interface RuledFact {
  text: string
  /** Where it came from: "Interview of Paige Turner · Team 1", or "Investigation · Team 2". */
  source: string
  /** Decided automatically (review lite), not by the instructor. */
  auto: boolean
}

export interface WorldFacts {
  matchupId: string
  number: number
  teams: { number: number; side: Side }[]
  accepted: RuledFact[]
  denied: RuledFact[]
}

export interface CaseFacts {
  fileFacts: { status: FileFactsStatus; facts: string[] }
  important: ImportantFacts
  allWorlds: { accepted: RuledFact[]; denied: RuledFact[] }
  worlds: WorldFacts[]
}

/** The case's running list of facts; starts reading the case files again if they've changed. */
export async function caseFacts(courseCase: CourseCase): Promise<CaseFacts> {
  await refreshFileFacts(courseCase.id)
  const [{ rows: fileRows }, { rows: ruled }, { rows: worlds }] = await Promise.all([
    pool.query<{ status: FileFactsStatus; facts: string[] }>(
      'SELECT file_facts_status AS status, file_facts AS facts FROM cases WHERE id = $1',
      [courseCase.id],
    ),
    pool.query<RuledFact & { decision: FactDecision; matchupId: string | null }>(
      `SELECT f.text, f.decision, f.auto, r.matchup_id AS "matchupId",
              CASE WHEN r.kind = 'investigation' THEN 'Investigation · Team ' || r.team_number
                   ELSE 'Interview of ' || coalesce(w.name, 'a witness') || ' · Team ' || r.team_number END AS source
       FROM review_facts f
       JOIN interview_reviews r ON r.id = f.review_id
       LEFT JOIN case_witnesses w ON w.id = r.witness_id
       WHERE r.case_id = $1 AND r.status = 'completed' AND f.decision IS NOT NULL
       ORDER BY r.completed_at, f.position`,
      [courseCase.id],
    ),
    pool.query<Omit<WorldFacts, 'accepted' | 'denied'>>(
      `SELECT mu.id AS "matchupId", mu.number,
              coalesce((SELECT json_agg(json_build_object('number', t.number, 'side', mt.side) ORDER BY mt.side DESC)
                        FROM matchup_teams mt JOIN teams t ON t.id = mt.team_id
                        WHERE mt.matchup_id = mu.id), '[]') AS teams
       FROM matchups mu WHERE mu.case_id = $1 ORDER BY mu.number`,
      [courseCase.id],
    ),
  ])
  const strip = ({ text, source, auto }: RuledFact): RuledFact => ({ text, source, auto })
  const pick = (decision: FactDecision, matchupId?: string) =>
    ruled.filter((f) => f.decision === decision && (matchupId === undefined || f.matchupId === matchupId)).map(strip)
  return {
    fileFacts: fileRows[0] ?? { status: 'none', facts: [] },
    important: courseCase.importantFacts,
    allWorlds: { accepted: pick('accept_case'), denied: pick('deny_case') },
    worlds: worlds.map((w) => ({ ...w, accepted: pick('accept_world', w.matchupId), denied: pick('deny_world', w.matchupId) })),
  }
}

const running = new Map<string, Promise<void>>()

/** Resolves once every case file summary running now has finished (for tests). */
export async function fileFactsSettled() {
  while (running.size) await Promise.all(running.values())
}

/** What the case file facts are read from: the instructor's files whose text is ready. */
async function filesKey(caseId: string) {
  const materials = (await listMaterialTexts(caseId, null)).filter((m) => m.textStatus === 'ready' && m.text)
  return {
    materials,
    key: materials
      .map((m) => `${m.id}:${m.text!.length}`)
      .sort()
      .join(','),
  }
}

/**
 * Reads the facts from the case files again, in the background, when the
 * files have changed since (or `force`, or the last read was cut off by a
 * restart). With no files, the list is just empty.
 */
export async function refreshFileFacts(caseId: string, { force = false } = {}) {
  if (running.has(caseId)) return
  const { rows } = await pool.query<{ key: string | null; status: FileFactsStatus }>(
    'SELECT file_facts_key AS key, file_facts_status AS status FROM cases WHERE id = $1',
    [caseId],
  )
  if (!rows[0]) return
  const { materials, key } = await filesKey(caseId)
  const stale = force || rows[0].key !== key || rows[0].status === 'working' || rows[0].status === 'none'
  if (!stale) return
  if (!materials.length) {
    await pool.query(`UPDATE cases SET file_facts = '{}', file_facts_key = $2, file_facts_status = 'ready' WHERE id = $1`, [
      caseId,
      key,
    ])
    return
  }
  await pool.query(`UPDATE cases SET file_facts_status = 'working', file_facts_key = $2 WHERE id = $1`, [caseId, key])
  const run = summarizeFiles(caseId, key, materials).finally(() => running.delete(caseId))
  running.set(caseId, run)
}

async function summarizeFiles(caseId: string, key: string, materials: Awaited<ReturnType<typeof listMaterialTexts>>) {
  try {
    const { rows } = await pool.query<{ title: string }>('SELECT title FROM cases WHERE id = $1', [caseId])
    const facts = await ai.summarizeCaseFacts({
      caseName: rows[0]?.title ?? '',
      documents: materials.map((m) => ({ title: m.description || m.filename, content: m.text! })),
    })
    // Kept only if the files haven't changed again meanwhile.
    await pool.query(
      `UPDATE cases SET file_facts = $3, file_facts_status = 'ready' WHERE id = $1 AND file_facts_key = $2`,
      [caseId, key, facts],
    )
  } catch (err) {
    if (!(err instanceof AiNotConfiguredError)) console.error(`Could not read the facts in case ${caseId}'s files:`, err)
    await pool
      .query(`UPDATE cases SET file_facts_status = 'failed' WHERE id = $1 AND file_facts_key = $2`, [caseId, key])
      .catch(() => {})
  }
}
