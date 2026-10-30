import { afterEach, beforeEach } from 'vitest'
import { ai } from '../ai/ai.ts'
import { transcriptionsSettled } from '../courses/materialText.ts'
import { subpoenasSettled } from '../exchange/subpoenas.ts'
import { investigationsSettled } from '../investigator/requests.ts'
import { reviewsSettled } from '../reviews/reviews.ts'
import { witnessSuggestionsSettled } from '../witness/suggestions.ts'

// Server tests never call Claude. By default a file's "transcription" is its
// own bytes as text, and the witness has no answer; tests that need the
// witness swap in their own fake.
const real = { ...ai }

beforeEach(() => {
  ai.transcribe = async (file) => (file.contentType.startsWith('audio/') ? null : file.data.toString('utf8'))
  ai.askWitness = async () => {
    throw new Error('This test did not set up a fake witness.')
  }
  ai.findNewFacts = async () => []
  ai.investigate = async () => {
    throw new Error('This test did not set up a fake investigator.')
  }
  // Edits nothing; tests that check the edit swap in their own.
  ai.finalizeReport = async (input) => input.body
  ai.suggestFromComplaint = async () => ({ witnesses: [], content: { disputedIssues: '', investigatorNotes: '', instructorNote: '', tasks: [] } })
  ai.reviewDiscovery = async () => ({ tag: 'LOOKS_GOOD', feedback: 'Nice work.' })
  ai.respondToSubpoena = async () => {
    throw new Error('This test did not set up a fake subpoena recipient.')
  }
})

afterEach(async () => {
  // Uploads start transcriptions in the background; let them finish before the next test resets the database.
  await transcriptionsSettled()
  await reviewsSettled()
  await investigationsSettled()
  await witnessSuggestionsSettled()
  await subpoenasSettled()
  Object.assign(ai, real)
})
