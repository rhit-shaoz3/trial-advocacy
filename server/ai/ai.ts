import Anthropic from '@anthropic-ai/sdk'
import { askWitness, type WitnessReply } from '../witness/deposition.ts'
import { finalizeReport, type FinalizeInput } from '../investigator/finalize.ts'
import { investigate, type InvestigationInput } from '../investigator/investigate.ts'
import { findNewFacts, type NewFact, type NewFactsInput } from '../witness/newFacts.ts'
import { suggestFromComplaint, type ComplaintSuggestions, type SuggestInput } from '../witness/suggest.ts'
import { respondToSubpoena } from '../exchange/subpoenaResponse.ts'
import type { SubpoenaContext } from '../exchange/subpoenaPrompt.ts'
import { reviewDiscovery } from '../exchange/mentor.ts'
import type { MentorContext, MentorTag } from '../exchange/mentorPrompt.ts'
import { groupFacts, type FactGroupProposal, type PendingFact } from '../reviews/factsAi.ts'
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
  /** The new facts a witness added in an ended interview, for the instructor to rule on. */
  findNewFacts: (input: NewFactsInput): Promise<NewFact[]> => findNewFacts(anthropic(), input),
  /** The background investigator's report on a team's assignment, review block and all. */
  investigate: (input: InvestigationInput): Promise<string> => investigate(anthropic(), input),
  /** The investigator's report as the team gets it, without whatever the instructor turned down. */
  finalizeReport: (input: FinalizeInput): Promise<string> => finalizeReport(anthropic(), input),
  /** A subpoena's response as its recipient drafts it, tag lines and all, for the instructor to review. */
  respondToSubpoena: (context: SubpoenaContext): Promise<string> => respondToSubpoena(anthropic(), context),
  /** The discovery mentor's tag and Socratic feedback on a team's draft requests or answers. */
  reviewDiscovery: (context: MentorContext): Promise<{ tag: MentorTag; feedback: string }> => reviewDiscovery(anthropic(), context),
  /** Everything setup can start from, in one read of the complaint: who will likely testify, and text for the case's own fields. */
  suggestFromComplaint: (input: SuggestInput): Promise<ComplaintSuggestions> => suggestFromComplaint(anthropic(), input),
  /** Which pending new facts are alike enough to rule on together. */
  groupFacts: (facts: PendingFact[]): Promise<FactGroupProposal[]> => groupFacts(anthropic(), facts),
}
