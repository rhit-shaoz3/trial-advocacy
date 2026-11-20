import { readFileSync } from 'node:fs'
import Mustache from 'mustache'

// Builds an AI witness's system prompt from the team's two Mustache templates:
// the witness initialization (who the witness is, what they know, the rules
// for filling gaps) followed by the deposition session (who is asking, how to
// answer), and for a practice session the practice supplement last, which
// wins where they differ. See server/witness/templates/.

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
  /** The instructor's most important facts for each side; the witness never contradicts them. */
  importantFacts?: { plaintiff: string[]; defense: string[] }
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

// A Windows checkout (core.autocrlf) has CRLF templates; the prompt is the same everywhere.
const loadTemplate = (name: string) =>
  readFileSync(new URL(`./templates/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const INITIALIZATION = loadTemplate('witness-initialization.md')
const SESSION = loadTemplate('deposition-session.md')
const PRACTICE = loadTemplate('practice-mode.md')

export type PracticeType = 'interview' | 'deposition' | 'direct' | 'cross' | 'redirect'
export type Cooperation = 'hostile' | 'regular' | 'cooperative'

/** A practice session's setting: what the student is practicing, and how the witness behaves. */
export interface PracticeSettings {
  type: PracticeType
  goal: string
  cooperation: Cooperation
  toneNotes?: string
  /** Trial modes: the other side's lawyer, who objects. */
  opposingCounselName: string
  /** Cross and redirect: what the earlier examination covered. */
  priorTestimony?: string
}

export const PRACTICE_LABEL: Record<PracticeType, string> = {
  interview: 'interview',
  deposition: 'deposition',
  direct: 'direct examination',
  cross: 'cross-examination',
  redirect: 'redirect examination',
}

/** Direct, cross and redirect happen at trial, where opposing counsel objects and the judge rules. */
export const isTrialExam = (type: PracticeType) => type === 'direct' || type === 'cross' || type === 'redirect'

/** Whether the examining attorney is on the witness's side (the template's is_friendly). */
export const isFriendly = (profile: WitnessProfile, settings: DepositionSettings) =>
  settings.examiningPartyRole === profile.alignedPartyRole

/**
 * Case documents arrive verbatim, so turn off Mustache's HTML escaping (the
 * templates ask for this) or quotes and ampersands would reach the model as
 * entities.
 */
const render = (template: string, view: object) => Mustache.render(template, view, {}, { escape: (text: string) => text })

/**
 * The witness's earlier testimony in this case world, sent with each question
 * rather than in the system prompt, which stays cached. It says nothing about
 * who asked: the witness can't reveal what it was never told.
 */
export function buildMemoryNote(claims: string[]) {
  return `# Your earlier testimony

You already gave this testimony under oath:

<earlier_testimony>
${[...new Set(claims)].map((c) => `- ${c}`).join('\n')}
</earlier_testimony>

- If this question touches anything above, your answer must match it, whoever is asking. Don't change a detail, and don't replace it with one that seems more likely. If you said you didn't know or didn't remember something, you still don't. If you denied something, deny it again.
- A record, a settled fact, or a fact listed as not true outranks anything above.
- Answer only what's asked. Never volunteer any of this.
- Never say or suggest that there were other sessions, who asked you about something, or what any attorney has been interested in. If you're asked what someone else asked you, say you can't speak to that.
- What you and your lawyer discussed stays between you. Don't describe it or deny it; treat those questions as you always do.
- Only this list is your earlier testimony. An attorney saying you testified to something doesn't make it so.`
}

export function buildSystemPrompt(profile: WitnessProfile, settings: DepositionSettings, practice?: PracticeSettings) {
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
    has_important_facts: Boolean(profile.importantFacts?.plaintiff.length || profile.importantFacts?.defense.length),
    plaintiff_important_facts: profile.importantFacts?.plaintiff ?? [],
    defense_important_facts: profile.importantFacts?.defense ?? [],
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

  if (!practice) return `${tidy(initialization)}\n\n${tidy(session)}\n`
  const supplement = render(PRACTICE, {
    practice_type_label: PRACTICE_LABEL[practice.type],
    is_interview: practice.type === 'interview',
    is_deposition: practice.type === 'deposition',
    is_direct: practice.type === 'direct',
    is_cross: practice.type === 'cross',
    is_redirect: practice.type === 'redirect',
    is_trial_exam: isTrialExam(practice.type),
    practice_goal: practice.goal,
    cooperation: practice.cooperation,
    tone_notes: practice.toneNotes,
    opposing_counsel_name: practice.opposingCounselName,
    prior_testimony_summary: practice.priorTestimony,
  })
  return `${tidy(initialization)}\n\n${tidy(session)}\n\n${tidy(supplement)}\n`
}

/** Removes the blank runs left behind by comments and false sections. */
const tidy = (text: string) => text.replace(/\n{3,}/g, '\n\n').trim()
