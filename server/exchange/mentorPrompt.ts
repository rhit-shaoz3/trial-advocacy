import { readFileSync } from 'node:fs'
import Mustache from 'mustache'
import type { Side } from '../courses/matchups.ts'
import { formatCaseDate, partyNames } from '../witness/profile.ts'

// The discovery mentor: before a team serves a subpoena, sends interrogatories
// or requests for admission, or sends its answers to a set, it can have an
// experienced trial attorney look over the draft. The system prompt,
// templates/discovery-mentor.md (the rules, and everything the team can see),
// stays the same across a team's re-checks, so it's cached; what the team is
// working on and its draft are the user message, templates/discovery-mentor-request.md.
// The reply starts with one tag line: LOOKS_GOOD, SMALL_EDITS, or NEEDS_IMPROVEMENT.

const readTemplate = (name: string) => readFileSync(new URL(`./templates/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const SYSTEM_TEMPLATE = readTemplate('discovery-mentor.md')
const REQUEST_TEMPLATE = readTemplate('discovery-mentor-request.md')

export const MENTOR_TAGS = ['LOOKS_GOOD', 'SMALL_EDITS', 'NEEDS_IMPROVEMENT'] as const
export type MentorTag = (typeof MENTOR_TAGS)[number]

export type DiscoveryKind = 'subpoena' | 'interrogatories' | 'rfas'
export type CheckMode = 'draft' | 'answer'

/** Earlier discovery in the team's case world that the team can see. */
export interface PriorDiscovery {
  title: string
  type: string
  servedBy: 'your team' | 'opposing counsel'
  status: string
  content: string
}

export interface MentorContext {
  caseTitle: string
  parties?: { plaintiff: string; defendant: string }
  caseSummary: string
  /** "Today" inside the case (YYYY-MM-DD); null means the real date. */
  inWorldDate: string | null
  /** The team's side. */
  side: Side
  kind: DiscoveryKind
  mode: CheckMode
  /** Subpoenas: who it's for, and the kind of request, as it reads. */
  subpoenaRecipient?: string
  subpoenaTypes?: string
  /** Answering: the other side's requests, numbered. */
  servedRequests?: string
  /** The team's draft requests or answers, numbered. */
  draft: string
  /** What the team says it's trying to accomplish (a subpoena's justification). */
  goal?: string
  /** On a re-check: the last check of this draft, which this one follows. */
  previous?: { round: number; feedback: string }
  /** This is the team's last allowed check of the draft. */
  finalRound?: boolean
  interrogatoryLimit: number
  interrogatoriesServed: number
  /** Only files the team can see, and its own interview transcripts. */
  documents: { title: string; content: string }[]
  /** Facts accepted for the team's world (the instructor's important facts are never sent: students don't see them). */
  acceptedFacts: string[]
  priorDiscovery: PriorDiscovery[]
}

const render = (template: string, view: object) => Mustache.render(template, view, {}, { escape: (text: string) => text })
const tidy = (text: string) => text.replace(/\n{3,}/g, '\n\n').trim()

function view(ctx: MentorContext, today: Date) {
  const names = partyNames(ctx.caseTitle, ctx.parties)
  const plaintiffSide = ctx.side === 'plaintiff'
  return {
    case_name: ctx.caseTitle,
    plaintiff_name: names.plaintiff,
    defendant_name: names.defendant,
    case_summary: ctx.caseSummary.trim() || 'No summary given.',
    // Every case is civil for now.
    is_criminal: false,
    in_world_date: formatCaseDate(ctx.inWorldDate ?? today.toISOString().slice(0, 10)),
    key_disputed_issues: '',
    team_side: plaintiffSide ? 'plaintiff' : 'defendant',
    team_party_name: plaintiffSide ? names.plaintiff : names.defendant,
    opposing_party_name: plaintiffSide ? names.defendant : names.plaintiff,
    is_drafting: ctx.mode === 'draft',
    is_answering: ctx.mode === 'answer',
    is_subpoena: ctx.kind === 'subpoena',
    is_interrogatories: ctx.kind === 'interrogatories',
    is_rfas: ctx.kind === 'rfas',
    subpoena_recipient: ctx.subpoenaRecipient ?? '',
    subpoena_types: ctx.subpoenaTypes ?? '',
    served_requests: ctx.servedRequests ?? '',
    student_draft: ctx.draft,
    student_goal: ctx.goal?.trim() ?? '',
    previous_feedback: ctx.previous?.feedback.trim() ?? '',
    previous_round: ctx.previous?.round ?? 0,
    final_round: ctx.finalRound ?? false,
    interrogatory_limit: ctx.interrogatoryLimit,
    interrogatories_already_served: ctx.interrogatoriesServed,
    documents: ctx.documents,
    important_facts: [],
    accepted_facts: ctx.acceptedFacts.map((fact) => ({ fact })),
    prior_discovery: ctx.priorDiscovery.map((p) => ({
      title: p.title,
      type: p.type,
      served_by: p.servedBy,
      status: p.status,
      content: p.content,
    })),
  }
}

/** The system prompt: the rules and everything the team can see. */
export function buildMentorPrompt(ctx: MentorContext, today = new Date()) {
  return tidy(render(SYSTEM_TEMPLATE, view(ctx, today)))
}

/** The user message: what the team is working on, its draft, and "Review this draft." */
export function buildMentorMessage(ctx: MentorContext, today = new Date()) {
  return tidy(render(REQUEST_TEMPLATE, view(ctx, today)))
}

/**
 * The tag on the reply's first line, and the feedback after it. A reply
 * without a tag is treated as needing work, so its text is still shown.
 */
export function parseMentorReply(text: string): { tag: MentorTag; feedback: string } {
  const lines = text.trim().split('\n')
  // Tolerates markdown around the tag ("**LOOKS_GOOD**") and a space for the underscore.
  const first = (lines[0] ?? '')
    .replace(/[*`#:]/g, '')
    .trim()
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
    .replace(/\s+/g, '_')
  const tag = MENTOR_TAGS.find((t) => first === t)
  if (!tag) return { tag: 'NEEDS_IMPROVEMENT', feedback: text.trim() }
  return { tag, feedback: lines.slice(1).join('\n').trim() }
}
