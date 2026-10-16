import { ai, AiNotConfiguredError } from '../ai/ai.ts'
import { TranscriptionError } from '../ai/transcribe.ts'
import { pool } from '../db/pool.ts'
import { storage } from '../storage/storage.ts'
import { setMaterialText } from './caseContent.ts'

// Each uploaded case file is transcribed once, in the background, so the AI
// witnesses can read it. A file whose transcription is still pending when a
// witness needs it (say, after a restart) is transcribed on the spot.

const running = new Map<string, Promise<void>>()

/** Transcribes one file and records the result; never throws. Joins a run already in progress. */
export function transcribeMaterial(id: string): Promise<void> {
  let run = running.get(id)
  if (!run) {
    run = transcribe(id).finally(() => running.delete(id))
    running.set(id, run)
  }
  return run
}

/** Starts transcribing a file without waiting for it (after an upload). */
export function queueTranscription(id: string) {
  void transcribeMaterial(id)
}

async function transcribe(id: string) {
  try {
    const { rows } = await pool.query<{ filename: string; contentType: string; storageKey: string | null; data: Buffer | null }>(
      `SELECT filename, content_type AS "contentType", storage_key AS "storageKey", data
       FROM case_materials WHERE id = $1`,
      [id],
    )
    const file = rows[0]
    if (!file) return // deleted meanwhile
    const data = file.storageKey ? await storage.read(file.storageKey) : file.data!
    const text = await ai.transcribe({ filename: file.filename, contentType: file.contentType, data })
    await setMaterialText(id, text === null ? { status: 'none' } : { status: 'ready', text })
  } catch (err) {
    const known = err instanceof AiNotConfiguredError || err instanceof TranscriptionError
    if (!known) console.error(`Could not transcribe case file ${id}:`, err)
    const error = known ? (err as Error).message : 'Could not read this file. Try again later.'
    await setMaterialText(id, { status: 'failed', error }).catch(() => {})
  }
}

/** Waits until none of these files is still pending, transcribing any that are. */
export async function finishPendingTranscriptions(materials: { id: string; textStatus: string }[]) {
  await Promise.all(materials.filter((m) => m.textStatus === 'pending').map((m) => transcribeMaterial(m.id)))
}

/** Resolves once every transcription running now has finished (for tests). */
export async function transcriptionsSettled() {
  await Promise.all(running.values())
}
