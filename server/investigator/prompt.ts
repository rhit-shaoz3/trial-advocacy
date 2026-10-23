import { readFileSync } from 'node:fs'
import Mustache from 'mustache'
import type { ImportantFacts } from '../courses/cases.ts'
import type { Side } from '../courses/matchups.ts'
import { formatCaseDate, partyNames, partyRole } from '../witness/profile.ts'
import type { SettledFacts } from '../witness/prompt.ts'

// The background investigator's system prompt: templates/investigator.md (the
// investigator's instructions, the case file, and the facts he may not
// contradict), filled in for one team, plus the instructor's own notes.

// A Windows checkout (core.autocrlf) has a CRLF template; the prompt is the same everywhere.
const TEMPLATE = readFileSync(new URL('./templates/investigator.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

export const INVESTIGATOR_TITLE = 'a licensed private investigator'

export interface InvestigatorDocument {
  /** The case file's id (not sent to the model). */
  id: string
  title: string
  /** Whether the requesting team can already see the file. */
  teamHasAccess: boolean
  content: string
}

export interface InvestigatorContext {
  investigatorName: string
  /** The instructor's extra instructions for the case; blank for none. */
  instructions: string
  caseTitle: string
  caseSummary: string
  /** "Today" in the case (YYYY-MM-DD); null means the real date. */
  inWorldDate: string | null
  disputedIssues: string
  /** The requesting team's side and number. */
  side: Side
  teamNumber: number
  /** Every case file with text, and whether the team has it. */
  documents: InvestigatorDocument[]
  witnesses: { name: string; role: string; side: Side | null }[]
  importantFacts: ImportantFacts
  /** Accepted and denied facts for the team's case world. */
  settled: SettledFacts
}

/** Names that are clearly a company or public body (so its employees are off-limits too). */
const ORGANIZATION = /\b(inc|llc|l\.l\.c|corp|corporation|co|company|ltd|lp|llp|plc|group|holdings|transit|authority|agency|department|hospital|clinic|university|college|school|district|bank|association|partners|enterprises|industries|services|park|resorts?|hotels?|city of|county of|state of|town of)\b\.?/i

export const isOrganization = (name: string) => ORGANIZATION.test(name)

/** Case documents arrive verbatim, so Mustache's HTML escaping is off (the template asks for this). */
const render = (view: object) => Mustache.render(TEMPLATE, view, {}, { escape: (text: string) => text })

/** Removes the blank runs left behind by comments and false sections. */
const tidy = (text: string) => text.replace(/\n{3,}/g, '\n\n').trim()

const asList = (facts: string[]) => facts.map((fact) => ({ fact }))

export function buildInvestigatorPrompt(ctx: InvestigatorContext, today = new Date()) {
  const names = partyNames(ctx.caseTitle)
  const role = partyRole(ctx.side)
  const own = role === 'plaintiff' ? names.plaintiff : names.defendant
  const opposing = role === 'plaintiff' ? names.defendant : names.plaintiff
  const prompt = render({
    investigator_name: ctx.investigatorName,
    investigator_title: INVESTIGATOR_TITLE,
    requesting_side: role,
    requesting_party_name: own,
    requesting_team_name: `Team ${ctx.teamNumber}`,
    opposing_party_name: opposing,
    opposing_party_is_organization: isOrganization(opposing),
    // Every case is civil for now.
    is_criminal: false,
    is_prosecution: false,
    case_name: ctx.caseTitle,
    plaintiff_name: names.plaintiff,
    defendant_name: names.defendant,
    case_summary: ctx.caseSummary,
    in_world_date: formatCaseDate(ctx.inWorldDate ?? today.toISOString().slice(0, 10)),
    key_disputed_issues: ctx.disputedIssues || undefined,
    documents: ctx.documents.map((d) => ({
      title: d.title,
      team_has_access: d.teamHasAccess ? 'yes' : 'no',
      content: d.content.trim(),
    })),
    witnesses: ctx.witnesses.map((w) => ({
      name: w.name,
      title: w.role || 'role not stated',
      side: w.side ? partyRole(w.side) : 'neither',
    })),
    important_facts: asList([...ctx.importantFacts.plaintiff, ...ctx.importantFacts.defense]),
    accepted_facts: asList(ctx.settled.accepted),
    denied_facts: asList(ctx.settled.denied),
  })
  const notes = ctx.instructions.trim()
  return `${tidy(prompt)}${notes ? `\n\n# Notes from the instructor for this case\n\nFollow these too, within the rules above:\n\n${notes}` : ''}\n`
}
