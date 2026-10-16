import Anthropic from '@anthropic-ai/sdk'
import { askWitness, type WitnessReply } from '../witness/deposition.ts'
import { transcribeFile, type FileToTranscribe } from './transcribe.ts'

/**
 * The app's calls to Claude, in one place so tests can swap them for fakes
 * (tests never call the API). Without ANTHROPIC_API_KEY, every call fails
 * with a clear message instead of reaching the network.
 */
export class AiNotConfiguredError extends Error {
  constructor() {
    super('AI is not set up on this server (ANTHROPIC_API_KEY is missing).')
  }
}

let client: Anthropic | null = null
function anthropic() {
  if (!process.env.ANTHROPIC_API_KEY) throw new AiNotConfiguredError()
  client ??= new Anthropic()
  return client
}

export const ai = {
  /** Plain text of a case file for the AI witnesses to read; null if it has none (audio, video). */
  transcribe: (file: FileToTranscribe): Promise<string | null> => transcribeFile(anthropic(), file),
  /** The AI witness's reply to the next deposition question. */
  askWitness: (options: Parameters<typeof askWitness>[1]): Promise<WitnessReply> => askWitness(anthropic(), options),
}
