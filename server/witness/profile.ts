import { listMaterialTexts, type MaterialText, type Witness } from '../courses/caseContent.ts'
import type { CourseCase } from '../courses/cases.ts'
import type { Side } from '../courses/matchups.ts'
import { finishPendingTranscriptions } from '../courses/materialText.ts'
import type { DepositionSettings, PartyRole, WitnessDocument, WitnessProfile } from './prompt.ts'

// Builds an AI witness's profile from what the instructor set up in the app:
// the witness (side, deposition, files they've seen, persona), the case
// (title, summary, in-world date, disputed issues, most important facts), and every case file's
// transcription.

/** Why a witness can't be deposed right now; the message is shown to whoever asked. */
export class WitnessNotReadyError extends Error {}

/** A witness becomes an AI witness once it has a side and a deposition file. */
export const isAiWitness = (w: Pick<Witness, 'alignedSide' | 'depositionMaterialId'>) =>
  w.alignedSide !== null && w.depositionMaterialId !== null

export const partyRole = (side: Side): PartyRole => (side === 'defense' ? 'defendant' : 'plaintiff')

/** "Rivera v. Thrill Park" → both party names; anything else falls back to generic names. */
export function partyNames(caseTitle: string) {
  const [plaintiff, defendant] = caseTitle.split(/\s+v\.?\s+/i)
  if (!plaintiff?.trim() || !defendant?.trim()) return { plaintiff: 'the plaintiff', defendant: 'the defendant' }
  return { plaintiff: plaintiff.trim(), defendant: defendant.trim() }
}

/** "2024-10-01" → "October 1, 2024", read as a calendar date (no time zone shift). */
export function formatCaseDate(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

const title = (m: Pick<MaterialText, 'description' | 'filename'>) => m.description || m.filename

/**
 * How the witness treats each file: the deposition is their own sworn account;
 * files the instructor ticked as seen are records they know; other files the
 * students can see are records they don't know; other instructor-only files
 * (other witnesses' depositions, usually) are someone else's account.
 */
export function witnessDocuments(witness: Witness, materials: MaterialText[]): WitnessDocument[] {
  const known = new Set(witness.knownMaterialIds)
  const readable = materials.filter((m) => m.textStatus === 'ready' && m.text)
  const deposition = readable.find((m) => m.id === witness.depositionMaterialId)
  if (!deposition) throw new WitnessNotReadyError(`${witness.name}'s deposition file can't be read yet.`)

  const others = readable.filter((m) => m.id !== deposition.id)
  return [
    { title: title(deposition), type: 'own_statement', witnessKnows: true, content: deposition.text! },
    ...others
      .filter((m) => known.has(m.id))
      .map((m): WitnessDocument => ({ title: title(m), type: 'record', witnessKnows: true, content: m.text! })),
    ...others
      .filter((m) => !known.has(m.id))
      .map(
        (m): WitnessDocument => ({
          title: title(m),
          type: m.audience === 'instructor' ? 'other_witness' : 'record',
          witnessKnows: false,
          content: m.text!,
        }),
      ),
  ]
}

export function buildProfile(
  courseCase: Pick<CourseCase, 'title' | 'summary' | 'inWorldDate' | 'disputedIssues' | 'importantFacts'>,
  witness: Witness,
  materials: MaterialText[],
  today = new Date(),
): WitnessProfile {
  if (!witness.alignedSide) throw new WitnessNotReadyError(`Choose which side ${witness.name} is a witness for.`)
  const names = partyNames(courseCase.title)
  const role = partyRole(witness.alignedSide)
  return {
    name: witness.name,
    title: witness.role || 'Not stated',
    roleInCase: witness.description || `A witness for the ${role}.`,
    alignedPartyRole: role,
    alignedPartyName: role === 'plaintiff' ? names.plaintiff : names.defendant,
    personaNotes: witness.personaNotes || undefined,
    caseName: courseCase.title,
    plaintiffName: names.plaintiff,
    defendantName: names.defendant,
    caseSummary: courseCase.summary,
    inWorldDate: formatCaseDate(courseCase.inWorldDate ?? today.toISOString().slice(0, 10)),
    keyDisputedIssues: courseCase.disputedIssues || undefined,
    importantFacts: courseCase.importantFacts,
    documents: witnessDocuments(witness, materials),
  }
}

/** Loads the case files (finishing any transcription still pending) and builds the profile. */
export async function loadProfile(courseCase: Parameters<typeof buildProfile>[0] & { id: string }, witness: Witness) {
  if (!witness.depositionMaterialId) throw new WitnessNotReadyError(`Choose ${witness.name}'s deposition file.`)
  let materials = await listMaterialTexts(courseCase.id)
  if (materials.some((m) => m.textStatus === 'pending')) {
    await finishPendingTranscriptions(materials)
    materials = await listMaterialTexts(courseCase.id)
  }
  return buildProfile(courseCase, witness, materials)
}

/** Who is asking: the side's party, and the witness's own lawyer when the other side asks. */
export function depositionSettings(profile: WitnessProfile, witness: Witness, side: Side): DepositionSettings {
  const role = partyRole(side)
  return {
    examiningPartyRole: role,
    examiningPartyName: role === 'plaintiff' ? profile.plaintiffName : profile.defendantName,
    defendingCounselName: witness.defendingCounsel || undefined,
  }
}
