import { ai, AiNotConfiguredError } from '../ai/ai.ts'
import { pool } from '../db/pool.ts'
import type { WitnessSuggestion } from './suggest.ts'

/**
 * Where the suggested witnesses stand for a case:
 * - waiting: not yet possible (`reason` says why), or the AI is still reading;
 * - ready: the suggestions, minus anyone already a witness;
 * - failed: the AI couldn't make them (try the Witnesses tab again later);
 * - done: the instructor already added some or skipped them; never offered again.
 */
export type SuggestionsState =
  | { status: 'waiting'; reason: 'no-file' | 'no-parties' | 'reading' | 'thinking' }
  | { status: 'ready'; suggestions: WitnessSuggestion[] }
  | { status: 'failed'; error: string }
  | { status: 'done' }

const running = new Map<string, Promise<void>>()

/** Resolves once every suggestion run now going has finished (for tests). */
export async function witnessSuggestionsSettled() {
  await Promise.all([...running.values()])
}

/** The case's suggested witnesses, starting the AI on them the first time they can be made. */
export async function witnessSuggestions(caseId: string): Promise<SuggestionsState> {
  const { rows } = await pool.query<{
    title: string
    plaintiff: string
    defendant: string
    stored: WitnessSuggestion[] | null
    key: string | null
    status: string | null
    doneAt: Date | null
    fileId: string | null
    textStatus: string | null
    text: string | null
  }>(
    `SELECT c.title, c.plaintiff_name AS plaintiff, c.defendant_name AS defendant,
            c.witness_suggestions AS stored, c.witness_suggestions_key AS key,
            c.witness_suggestions_status AS status, c.witness_suggestions_done_at AS "doneAt",
            m.id AS "fileId", m.text_status AS "textStatus", m.text_content AS text
     FROM cases c
     LEFT JOIN case_materials m ON m.case_id = c.id AND m.initial
     WHERE c.id = $1`,
    [caseId],
  )
  const c = rows[0]
  if (!c || c.doneAt) return { status: 'done' }
  if (!c.fileId) return { status: 'waiting', reason: 'no-file' }
  if (!c.plaintiff || !c.defendant) return { status: 'waiting', reason: 'no-parties' }
  if (c.textStatus === 'pending') return { status: 'waiting', reason: 'reading' }
  if (c.textStatus !== 'ready' || !c.text) return { status: 'failed', error: "The initial file couldn't be read." }

  const key = `${c.fileId}|${c.plaintiff}|${c.defendant}`
  if (c.key === key && c.status === 'ready') return { status: 'ready', suggestions: await withoutCurrent(caseId, c.stored ?? []) }
  if (c.key === key && c.status === 'failed') return { status: 'failed', error: 'Could not read the witnesses from the initial file.' }
  if (c.key !== key || c.status !== 'pending' || !running.has(caseId)) {
    start(caseId, key, { caseTitle: c.title, plaintiffName: c.plaintiff, defendantName: c.defendant, complaint: c.text })
  }
  return { status: 'waiting', reason: 'thinking' }
}

function start(caseId: string, key: string, input: Parameters<typeof ai.suggestWitnesses>[0]) {
  const work = async () => {
    await pool.query(
      `UPDATE cases SET witness_suggestions_key = $2, witness_suggestions_status = 'pending', witness_suggestions = NULL WHERE id = $1`,
      [caseId, key],
    )
    try {
      const suggestions = await ai.suggestWitnesses(input)
      // Only if nothing changed meanwhile.
      await pool.query(
        `UPDATE cases SET witness_suggestions = $3, witness_suggestions_status = 'ready'
         WHERE id = $1 AND witness_suggestions_key = $2`,
        [caseId, key, JSON.stringify(suggestions)],
      )
    } catch (err) {
      if (!(err instanceof AiNotConfiguredError)) console.error(`Could not suggest witnesses for case ${caseId}:`, err)
      await pool
        .query(`UPDATE cases SET witness_suggestions_status = 'failed' WHERE id = $1 AND witness_suggestions_key = $2`, [caseId, key])
        .catch(() => {})
    }
  }
  const run: Promise<void> = work().finally(() => {
    // A newer run (the file or names changed) may have replaced this one.
    if (running.get(caseId) === run) running.delete(caseId)
  })
  running.set(caseId, run)
}

/** Suggestions, without anyone already on the witness list (by name, ignoring case). */
async function withoutCurrent(caseId: string, suggestions: WitnessSuggestion[]) {
  const { rows } = await pool.query<{ name: string }>('SELECT lower(name) AS name FROM case_witnesses WHERE case_id = $1', [caseId])
  const taken = new Set(rows.map((r) => r.name.trim()))
  return suggestions.filter((s) => !taken.has(s.name.trim().toLowerCase()))
}

/** The instructor added some suggestions or skipped them: never offer them again. */
export async function finishWitnessSuggestions(caseId: string) {
  await pool.query('UPDATE cases SET witness_suggestions_done_at = coalesce(witness_suggestions_done_at, now()) WHERE id = $1', [caseId])
}
