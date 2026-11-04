import { ai, AiNotConfiguredError } from '../ai/ai.ts'
import { pool } from '../db/pool.ts'
import type { ClaimKind } from './claims.ts'

// A witness's memory of earlier testimony in a case world. Each answer in a
// team's interview is read in the background and stored as claims, tied to
// its turn. A witness stays consistent with testimony while its ruling is
// pending; a denied fact drops out as soon as it's ruled.
//
// A claim's standing isn't stored. It's worked out from the rulings each time
// (see testimonyMemory), so group rulings, flags, and changed rulings all
// count with nothing to keep in step. Instructor tests and interviews ended
// with "Start over" are never remembered.

/** Testimony that counts: `i` is a team's interview, still open or sent for review. */
const COUNTS = `i.team_id IS NOT NULL
  AND (i.ended_at IS NULL OR EXISTS (SELECT 1 FROM interview_reviews r WHERE r.interview_id = i.id))`

const running = new Map<string, Promise<void>>()

/** Reads an interview's unread answers in the background, one run at a time. */
export function queueClaims(interviewId: string) {
  const run: Promise<void> = (running.get(interviewId) ?? Promise.resolve())
    .then(() => readTurns(interviewId))
    .finally(() => {
      if (running.get(interviewId) === run) running.delete(interviewId)
    })
  running.set(interviewId, run)
}

/** Resolves once every read running now has finished (for tests). */
export async function claimsSettled() {
  while (running.size > 0) await Promise.all(running.values())
}

/**
 * Stores the claims in each unread answer; never throws. A failure leaves the
 * rest unread for the next question, the end of the interview, or the next boot.
 */
async function readTurns(interviewId: string) {
  try {
    const { rows } = await pool.query<{ position: number; question: string; answer: string; witnessName: string }>(
      `SELECT t.position, t.question, t.answer, w.name AS "witnessName"
       FROM interview_turns t
       JOIN interviews i ON i.id = t.interview_id
       JOIN case_witnesses w ON w.id = i.witness_id
       WHERE t.interview_id = $1 AND t.claims_read_at IS NULL AND ${COUNTS}
       ORDER BY t.position`,
      [interviewId],
    )
    for (const turn of rows) {
      // Nothing to read when the witness only got an objection in.
      const claims = turn.answer.trim() ? await ai.findClaims(turn) : []
      await storeClaims(interviewId, turn.position, claims)
    }
  } catch (err) {
    if (!(err instanceof AiNotConfiguredError)) console.error(`Could not read the testimony in interview ${interviewId}:`, err)
  }
}

async function storeClaims(interviewId: string, position: number, claims: { kind: ClaimKind; text: string }[]) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM testimony_claims WHERE interview_id = $1 AND position = $2', [interviewId, position])
    for (const [number, claim] of claims.entries()) {
      await client.query('INSERT INTO testimony_claims (interview_id, position, number, kind, text) VALUES ($1, $2, $3, $4, $5)', [
        interviewId,
        position,
        number,
        claim.kind,
        claim.text,
      ])
    }
    await client.query('UPDATE interview_turns SET claims_read_at = now() WHERE interview_id = $1 AND position = $2', [
      interviewId,
      position,
    ])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/** Picks up what a restart or a failure left unread, one interview at a time. Run once when the server starts. */
export async function resumeClaims() {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT i.id FROM interviews i
     WHERE ${COUNTS} AND EXISTS (SELECT 1 FROM interview_turns t WHERE t.interview_id = i.id AND t.claims_read_at IS NULL)`,
  )
  for (const { id } of rows) {
    queueClaims(id)
    await running.get(id)
  }
}

export interface RememberedClaim {
  kind: ClaimKind
  text: string
  /** The review is finished, so the testimony stands; otherwise its rulings are still pending. */
  settled: boolean
}

/**
 * What the witness has said in this case world, oldest first, leaving out the
 * interview under way (its turns are already in the conversation). A denied
 * fact takes out the claims in the exchanges that stated it and the ones whose
 * answers relied on it, the same exchanges struck from the transcript
 * (markedTranscript), so another claim in such an exchange goes with it.
 */
export async function testimonyMemory(witnessId: string, matchupId: string, currentInterviewId: string | null = null) {
  const { rows } = await pool.query<RememberedClaim>(
    `SELECT c.kind, c.text, coalesce(rv.status = 'completed', false) AS settled
     FROM testimony_claims c
     JOIN interviews i ON i.id = c.interview_id
     JOIN matchup_teams mt ON mt.team_id = i.team_id
     LEFT JOIN interview_reviews rv ON rv.interview_id = i.id
     WHERE i.witness_id = $1 AND mt.matchup_id = $2 AND i.id IS DISTINCT FROM $3 AND ${COUNTS}
       AND NOT EXISTS (
         SELECT 1 FROM review_facts f
         WHERE f.review_id = rv.id AND f.decision LIKE 'deny%'
           AND (f.links->'producedBy' @> to_jsonb(c.position)
                OR f.links->'builtOn' @> jsonb_build_array(jsonb_build_object('turn', c.position, 'answer', true))))
     ORDER BY i.created_at, c.position, c.number`,
    [witnessId, matchupId, currentInterviewId],
  )
  return rows
}
