import { readFileSync } from 'node:fs'
import Mustache from 'mustache'
import type { ImportantFacts } from '../courses/cases.ts'
import type { Side } from '../courses/matchups.ts'
import { formatCaseDate, partyNames, partyRole } from '../witness/profile.ts'
import type { SettledFacts } from '../witness/prompt.ts'

// The system prompt for a team's clients answering one email:
// templates/client-email.md (the rules, who the clients are, the case file
// with what they know and have, the facts, and the team's earlier emails),
// filled in for one team. The team's new email is the message.

// A Windows checkout (core.autocrlf) has a CRLF template; the prompt is the same everywhere.
const TEMPLATE = readFileSync(new URL('./templates/client-email.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

/** One of the team's clients, as the witness is set up. */
export interface ClientContact {
  id: string
  name: string
  role: string
  isOrganization: boolean
  personaNotes: string
}

export interface ClientDocument {
  /** The case file's id (not sent to the model). */
  id: string
  title: string
  teamHasAccess: boolean
  /** A client's deposition, a file one of them has seen, or one they own. */
  clientKnows: boolean
  /** Owned by one of the clients or by the team's side, so they can hand it over. */
  clientHas: boolean
  content: string
}

/** One of the team's earlier emails with its clients, or a reply. */
export interface PriorEmail {
  date: Date
  from: string
  to: string
  subject: string
  body: string
}

export interface ClientContext {
  caseTitle: string
  /** The parties as the instructor named them (else they come from the title). */
  parties?: { plaintiff: string; defendant: string }
  caseSummary: string
  disputedIssues: string
  side: Side
  /** The students on the team, for the reply's To line. */
  attorneyNames: string[]
  contacts: ClientContact[]
  documents: ClientDocument[]
  importantFacts: ImportantFacts
  /** Accepted and denied facts for the team's case world. */
  settled: SettledFacts
  priorEmails: PriorEmail[]
}

/** The team's new email: whom it's to (by name), its subject, and its body. */
export interface ClientEmail {
  to: string[]
  subject: string
  body: string
}

/** Case documents arrive verbatim, so Mustache's HTML escaping is off (the template asks for this). */
const render = (view: object) => Mustache.render(TEMPLATE, view, {}, { escape: (text: string) => text })

/** Removes the blank runs left behind by comments and false sections. */
const tidy = (text: string) => text.replace(/\n{3,}/g, '\n\n').trim()

const asList = (facts: string[]) => facts.map((fact) => ({ fact }))
const yesNo = (value: boolean) => (value ? 'yes' : 'no')
const day = (date: Date) => formatCaseDate(date.toISOString().slice(0, 10))

/** The clients' system prompt: the same for every email from the team until the facts or files change. */
export function buildClientPrompt(ctx: ClientContext, today = new Date()) {
  const names = partyNames(ctx.caseTitle, ctx.parties)
  const role = partyRole(ctx.side)
  return `${tidy(
    render({
      client_name: role === 'plaintiff' ? names.plaintiff : names.defendant,
      client_contacts: ctx.contacts.map((c) => ({
        name: c.name,
        title: c.role || undefined,
        is_organization: c.isOrganization,
        persona_notes: c.personaNotes || undefined,
      })),
      several_contacts: ctx.contacts.length > 1,
      any_organization: ctx.contacts.some((c) => c.isOrganization),
      team_side: role,
      team_attorney_names: ctx.attorneyNames.length ? ctx.attorneyNames.join(', ') : undefined,
      opposing_party_name: role === 'plaintiff' ? names.defendant : names.plaintiff,
      case_name: ctx.caseTitle,
      plaintiff_name: names.plaintiff,
      defendant_name: names.defendant,
      case_summary: ctx.caseSummary,
      // Every case is civil for now.
      is_criminal: false,
      is_prosecution: false,
      // The case runs on the real date.
      in_world_date: day(today),
      key_disputed_issues: ctx.disputedIssues || undefined,
      prior_emails: ctx.priorEmails.map((e) => ({ ...e, date: day(new Date(e.date)), body: e.body.trim() })),
      documents: ctx.documents.map((d) => ({
        title: d.title,
        team_has_access: yesNo(d.teamHasAccess),
        client_knows: yesNo(d.clientKnows || d.clientHas),
        client_has: yesNo(d.clientHas),
        content: d.content.trim(),
      })),
      important_facts: asList([...ctx.importantFacts.plaintiff, ...ctx.importantFacts.defense]),
      accepted_facts: asList(ctx.settled.accepted),
      denied_facts: asList(ctx.settled.denied),
    }),
  )}\n`
}

/** The team's email, as the message the clients answer. */
export function buildClientMessage(email: ClientEmail) {
  return `<student_email>
To: ${email.to.join(', ')}
Subject: ${email.subject}

${email.body.trim()}
</student_email>`
}
