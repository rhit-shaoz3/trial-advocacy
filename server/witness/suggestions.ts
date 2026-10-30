import { ai, AiNotConfiguredError } from '../ai/ai.ts'
import { transcribeMaterial } from '../courses/materialText.ts'
import { pool } from '../db/pool.ts'
import type { CaseSuggestions, WitnessSuggestion } from './suggest.ts'

// One AI call per complaint (the initial file) makes every setup suggestion: the likely witnesses and the text for the case's
// own fields. Both are saved together under one key and status, and each
// part is offered from what's saved.

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

/**
 * Where the suggested text for the case's own fields stands: still being
 * made, ready, or none to offer (no complaint to read, or the AI couldn't),
 * when the fields just show their usual hints.
 */
export type ContentSuggestionsState = { status: 'waiting' } | { status: 'ready'; suggestions: CaseSuggestions } | { status: 'none' }

const running = new Map<string, Promise<void>>()

/** Resolves once every suggestion run now going has finished (for tests). */
export async function witnessSuggestionsSettled() {
  await Promise.all([...running.values()])
}

interface Saved {
  witnesses: WitnessSuggestion[] | null
  content: CaseSuggestions | null
  doneAt: Date | null
}

type Prepared =
  | { phase: 'no-file' | 'no-parties' | 'reading' | 'unreadable' | 'thinking' | 'failed' }
  | { phase: 'ready'; saved: Saved }

/**
 * The case's suggestions as saved, starting the AI on them when they can be
 * made and aren't yet (or the initial file changed since). Renaming the
 * parties doesn't make them again.
 */
async function prepare(caseId: string): Promise<Prepared & { doneAt: Date | null }> {
  const { rows } = await pool.query<
    Saved & {
      title: string
      plaintiff: string
      defendant: string
      key: string | null
      status: string | null
      fileId: string | null
      textStatus: string | null
      text: string | null
    }
  >(
    `SELECT c.title, c.plaintiff_name AS plaintiff, c.defendant_name AS defendant,
            c.witness_suggestions AS witnesses, c.content_suggestions AS content,
            c.witness_suggestions_key AS key, c.witness_suggestions_status AS status,
            c.witness_suggestions_done_at AS "doneAt",
            m.id AS "fileId", m.text_status AS "textStatus", m.text_content AS text
     FROM cases c
     LEFT JOIN case_materials m ON m.case_id = c.id AND m.initial
     WHERE c.id = $1`,
    [caseId],
  )
  const c = rows[0]
  if (!c) return { phase: 'no-file', doneAt: null }
  const doneAt = c.doneAt
  if (!c.fileId) return { phase: 'no-file', doneAt }
  if (!c.plaintiff || !c.defendant) return { phase: 'no-parties', doneAt }
  if (c.textStatus === 'pending') {
    // Read it now if nothing is (after a restart, or a file queued to be read again); joins a run already going.
    void transcribeMaterial(c.fileId)
    return { phase: 'reading', doneAt }
  }
  if (c.textStatus !== 'ready' || !c.text) return { phase: 'unreadable', doneAt }

  // The initial file alone (older keys also carried the parties' names after a "|").
  const key = c.fileId
  const sameFile = c.key?.split('|')[0] === key
  // Saved before the case's own fields were suggested too: made again, once, with everything.
  if (sameFile && c.status === 'ready' && c.content) return { phase: 'ready', saved: c, doneAt }
  if (sameFile && c.status === 'failed') return { phase: 'failed', doneAt }
  if (!sameFile || c.status !== 'pending' || !running.has(caseId)) {
    start(caseId, key, { caseTitle: c.title, plaintiffName: c.plaintiff, defendantName: c.defendant, complaint: c.text.slice(0, 60000) })
  }
  return { phase: 'thinking', doneAt }
}

/** The case's suggested witnesses, starting the AI on them the first time they can be made. */
export async function witnessSuggestions(caseId: string): Promise<SuggestionsState> {
  const { rows } = await pool.query<{ doneAt: Date | null }>('SELECT witness_suggestions_done_at AS "doneAt" FROM cases WHERE id = $1', [caseId])
  if (!rows[0] || rows[0].doneAt) return { status: 'done' }
  const p = await prepare(caseId)
  switch (p.phase) {
    case 'no-file':
    case 'no-parties':
    case 'reading':
    case 'thinking':
      return { status: 'waiting', reason: p.phase }
    case 'unreadable':
      return { status: 'failed', error: "The starting file's text couldn't be read, so no witnesses could be suggested from it." }
    case 'failed':
      return { status: 'failed', error: 'Could not read the witnesses from the initial file.' }
    case 'ready':
      return { status: 'ready', suggestions: await withoutCurrent(caseId, p.saved.witnesses ?? []) }
  }
}

/** The suggested text for the case's own fields, from the same call as the witnesses. */
export async function contentSuggestions(caseId: string): Promise<ContentSuggestionsState> {
  const p = await prepare(caseId)
  if (p.phase === 'ready' && p.saved.content) return { status: 'ready', suggestions: p.saved.content }
  return p.phase === 'reading' || p.phase === 'thinking' ? { status: 'waiting' } : { status: 'none' }
}

function start(caseId: string, key: string, input: Parameters<typeof ai.suggestFromComplaint>[0]) {
  const work = async () => {
    await pool.query(
      `UPDATE cases SET witness_suggestions_key = $2, witness_suggestions_status = 'pending', witness_suggestions = NULL, content_suggestions = NULL
       WHERE id = $1`,
      [caseId, key],
    )
    try {
      const { witnesses, content } = await ai.suggestFromComplaint(input)
      // Only if nothing changed meanwhile.
      await pool.query(
        `UPDATE cases SET witness_suggestions = $3, content_suggestions = $4, witness_suggestions_status = 'ready'
         WHERE id = $1 AND witness_suggestions_key = $2`,
        [caseId, key, JSON.stringify(witnesses), JSON.stringify(content)],
      )
    } catch (err) {
      if (!(err instanceof AiNotConfiguredError)) console.error(`Could not suggest the setup for case ${caseId}:`, err)
      await pool
        .query(`UPDATE cases SET witness_suggestions_status = 'failed' WHERE id = $1 AND witness_suggestions_key = $2`, [caseId, key])
        .catch(() => {})
    }
  }
  const run: Promise<void> = work().finally(() => {
    // A newer run (the file changed) may have replaced this one.
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
