import { readFileSync } from 'node:fs'
import Mustache from 'mustache'

// Builds an AI witness's system prompt from the team's two Mustache templates:
// the witness initialization (who the witness is, what they know, the rules
// for filling gaps) followed by the deposition session (who is asking, how to
// answer). See server/witness/templates/.

export type PartyRole = 'plaintiff' | 'defendant'

/**
 * How binding a case document is for the witness: their own account, an
 * objective record, someone else's account, or background like pleadings.
 */
export type DocumentType = 'own_statement' | 'record' | 'other_witness' | 'background'

export interface WitnessDocument {
  title: string
  type: DocumentType
  /** Whether the character has seen or lived this. Unknown documents only keep answers consistent. */
  witnessKnows: boolean
  content: string
}

/** Everything about the witness and the case; the same for every session with them. */
export interface WitnessProfile {
  name: string
  title: string
  roleInCase: string
  alignedPartyRole: PartyRole
  alignedPartyName: string
  personaNotes?: string
  expert?: { field: string; compensation?: string }
  caseName: string
  plaintiffName: string
  defendantName: string
  caseSummary: string
  /** "Today" inside the case, e.g. "October 1, 2024". */
  inWorldDate: string
  keyDisputedIssues?: string
  documents: WitnessDocument[]
  /**
   * The instructor's rulings on facts witnesses added in earlier interviews,
   * for this witness's case world and the whole case: true facts to keep to,
   * and facts ruled untrue that must never be said.
   */
  settledFacts?: SettledFacts
}

export interface SettledFacts {
  accepted: string[]
  denied: string[]
}

/** Who is taking this deposition. */
export interface DepositionSettings {
  examiningPartyRole: PartyRole
  examiningPartyName: string
  examiningAttorneyName?: string
  /**
   * The witness's own lawyer defends the deposition and may object. Only used
   * when the examining attorney is on the other side, as in the template.
   */
  defendingCounselName?: string
}

const loadTemplate = (name: string) => readFileSync(new URL(`./templates/${name}`, import.meta.url), 'utf8')
const INITIALIZATION = loadTemplate('witness-initialization.md')
const SESSION = loadTemplate('deposition-session.md')

/** Whether the examining attorney is on the witness's side (the template's is_friendly). */
export const isFriendly = (profile: WitnessProfile, settings: DepositionSettings) =>
  settings.examiningPartyRole === profile.alignedPartyRole

/**
 * Case documents arrive verbatim, so turn off Mustache's HTML escaping (the
 * templates ask for this) or quotes and ampersands would reach the model as
 * entities.
 */
const render = (template: string, view: object) => Mustache.render(template, view, {}, { escape: (text: string) => text })

export function buildSystemPrompt(profile: WitnessProfile, settings: DepositionSettings) {
  const initialization = render(INITIALIZATION, {
    witness_name: profile.name,
    witness_title: profile.title,
    witness_role_in_case: profile.roleInCase,
    aligned_party_role: profile.alignedPartyRole,
    aligned_party_name: profile.alignedPartyName,
    persona_notes: profile.personaNotes,
    is_expert: Boolean(profile.expert),
    expert_field: profile.expert?.field,
    expert_compensation: profile.expert?.compensation,
    case_name: profile.caseName,
    plaintiff_name: profile.plaintiffName,
    defendant_name: profile.defendantName,
    case_summary: profile.caseSummary,
    in_world_date: profile.inWorldDate,
    key_disputed_issues: profile.keyDisputedIssues,
    settled_facts: profile.settledFacts?.accepted ?? [],
    has_settled_facts: Boolean(profile.settledFacts?.accepted.length),
    denied_facts: profile.settledFacts?.denied ?? [],
    has_denied_facts: Boolean(profile.settledFacts?.denied.length),
    documents: profile.documents.map((d) => ({
      title: d.title,
      type: d.type,
      witness_knows: d.witnessKnows ? 'yes' : 'no',
      content: d.content.trim(),
    })),
  })

  const friendly = isFriendly(profile, settings)
  const session = render(SESSION, {
    witness_name: profile.name,
    examining_party_role: settings.examiningPartyRole,
    examining_party_name: settings.examiningPartyName,
    examining_attorney_name: settings.examiningAttorneyName,
    is_friendly: friendly,
    has_defending_counsel: !friendly && Boolean(settings.defendingCounselName),
    defending_counsel_name: settings.defendingCounselName,
  })

  return `${tidy(initialization)}\n\n${tidy(session)}\n`
}

/** Removes the blank runs left behind by comments and false sections. */
const tidy = (text: string) => text.replace(/\n{3,}/g, '\n\n').trim()
