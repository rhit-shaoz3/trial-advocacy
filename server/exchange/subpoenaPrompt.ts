import { readFileSync } from 'node:fs'
import Mustache from 'mustache'
import type { ImportantFacts } from '../courses/cases.ts'
import type { Side } from '../courses/matchups.ts'
import { formatCaseDate, partyNames, partyRole } from '../witness/profile.ts'
import type { SettledFacts } from '../witness/prompt.ts'
import type { SubpoenaType } from './exchange.ts'

// Drafting one subpoena's response. The system prompt, templates/
// subpoena-response.md (the recipient's instructions, the whole case file,
// and the facts it may not contradict), is the same for every subpoena in a
// case world, so it's cached once for all of them. The subpoena itself, which
// files the team has, earlier responses to reuse, and the instructor's notes
// for a new draft are the user message, templates/subpoena-request.md.

// A Windows checkout (core.autocrlf) has CRLF templates; the prompt is the same everywhere.
const readTemplate = (name: string) => readFileSync(new URL(`./templates/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const SYSTEM_TEMPLATE = readTemplate('subpoena-response.md')
const REQUEST_TEMPLATE = readTemplate('subpoena-request.md')

export interface SubpoenaDocument {
  /** The case file's id (not sent to the model). */
  id: string
  title: string
  /** Whether the requesting team can already see the file. */
  teamHasAccess: boolean
  content: string
}

/** An earlier subpoena in this case world that got a response, now in the case file. */
export interface WorldSubpoena {
  recipient: string
  requestType: SubpoenaType
  records: string
  /** The response file's title, as `documents` names it. */
  responseTitle: string
}

/** A response approved in another case world, to reuse for the same request. */
export interface OtherWorldResponse {
  /** "R1", "R2"…: how the drafter names it in a BASED_ON tag. */
  ref: string
  /** The response file's id (not sent to the model). */
  materialId: string
  recipient: string
  requestType: SubpoenaType
  records: string
  response: string
}

export interface SubpoenaContext {
  caseTitle: string
  /** The parties as the instructor named them (else they come from the title). */
  parties?: { plaintiff: string; defendant: string }
  caseSummary: string
  disputedIssues: string
  /** The requesting team's side. */
  side: Side
  recipient: string
  recipientDescription: string
  requestType: SubpoenaType
  /** The subpoena's requests, as the students wrote them. */
  records: string
  /** What the requesting team would tell the judge about the subpoena's validity, relevance, and proportionality. */
  justification?: string
  /** The discovery mentor reviewed this exact subpoena under the same rules and found it proper. */
  mentorApproved?: boolean
  /** Every case file with text in the team's case world, and whether the team has it. */
  documents: SubpoenaDocument[]
  importantFacts: ImportantFacts
  /** Accepted and denied facts for the team's case world. */
  settled: SettledFacts
  /** Earlier subpoenas in this case world that got a response. */
  worldSubpoenas: WorldSubpoena[]
  /** Responses approved in other case worlds. */
  otherWorldResponses: OtherWorldResponse[]
  /** The instructor's notes for a new draft; blank for none. */
  instructions: string
  /** Whether the instructor asked for a new file rather than existing ones. */
  createNew: boolean
}

/** Case documents arrive verbatim, so Mustache's HTML escaping is off (the template asks for this). */
const render = (template: string, view: object) => Mustache.render(template, view, {}, { escape: (text: string) => text })

/** Removes the blank runs left behind by comments and false sections. */
const tidy = (text: string) => text.replace(/\n{3,}/g, '\n\n').trim()

const asList = (facts: string[]) => facts.map((fact) => ({ fact }))

/** How a request's kind reads in the prompt. */
const TYPE_TEXT: Record<SubpoenaType, string> = {
  documents: 'physical documents or electronically stored information',
  tangible_things: 'tangible things',
  inspection: 'inspection of premises',
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The system prompt: the same for every subpoena in the case world, so they share one cache. */
export function buildSubpoenaPrompt(ctx: SubpoenaContext, today = new Date()) {
  const names = partyNames(ctx.caseTitle, ctx.parties)
  const prompt = render(SYSTEM_TEMPLATE, {
    // Every case is civil for now.
    is_criminal: false,
    is_prosecution: false,
    case_name: ctx.caseTitle,
    plaintiff_name: names.plaintiff,
    defendant_name: names.defendant,
    case_summary: ctx.caseSummary,
    in_world_date: formatCaseDate(today.toISOString().slice(0, 10)),
    key_disputed_issues: ctx.disputedIssues || undefined,
    documents: ctx.documents.map((d) => ({ title: d.title, content: d.content.trim() })),
    important_facts: asList([...ctx.importantFacts.plaintiff, ...ctx.importantFacts.defense]),
    accepted_facts: asList(ctx.settled.accepted),
    denied_facts: asList(ctx.settled.denied),
  })
  return `${tidy(prompt)}\n`
}

/** The user message: this subpoena, what the team has, earlier responses to reuse, and the reviewer's notes. */
export function buildSubpoenaMessage(ctx: SubpoenaContext) {
  const names = partyNames(ctx.caseTitle, ctx.parties)
  const role = partyRole(ctx.side)
  const message = render(REQUEST_TEMPLATE, {
    is_criminal: false,
    requesting_side: role,
    requesting_party_name: role === 'plaintiff' ? names.plaintiff : names.defendant,
    recipient_name: ctx.recipient,
    recipient_description: ctx.recipientDescription || 'Not stated.',
    recipient_is_party: sameName(ctx.recipient, names.plaintiff) || sameName(ctx.recipient, names.defendant),
    requests_documents: ctx.requestType === 'documents',
    requests_tangible_things: ctx.requestType === 'tangible_things',
    requests_inspection: ctx.requestType === 'inspection',
    request_text: ctx.records.trim(),
    justification: ctx.justification?.trim() ?? '',
    mentor_approved: ctx.mentorApproved === true,
    team_documents: ctx.documents.filter((d) => d.teamHasAccess).map((d) => ({ title: d.title })),
    world_subpoenas: ctx.worldSubpoenas.map((w) => ({
      recipient: w.recipient,
      type: TYPE_TEXT[w.requestType],
      // One line each in the list.
      request: w.records.trim().replace(/\s*\n\s*/g, ' '),
      response_title: w.responseTitle,
    })),
    other_world_responses: ctx.otherWorldResponses.map((o) => ({
      ref: o.ref,
      recipient: o.recipient,
      type: TYPE_TEXT[o.requestType],
      request: o.records.trim(),
      response: o.response.trim(),
    })),
  })
  const notes = [
    ctx.createNew
      ? "Don't produce any existing case document, by reference or otherwise, and add no EXISTING_DOCUMENT tags. Create the records this response produces, consistent with the case file."
      : '',
    ctx.instructions.trim(),
  ].filter(Boolean)
  return `${tidy(message)}${notes.length ? `\n\n# Notes from the reviewer for this response\n\nFollow these too, within the rules above:\n\n${notes.join('\n\n')}` : ''}\n`
}

export interface ParsedSubpoenaResponse {
  /** The response document, without its tag lines. */
  body: string
  /** Whether a court would likely quash or modify the subpoena, in the drafter's view. */
  flag: 'quash' | 'modify' | null
  /** Titles of existing case files the response produces. */
  existingTitles: string[]
  /** The other world's response this one adapts, by ref ("R1"), if any. */
  basedOn: string | null
}

/** Splits the leading tag lines (QUASH, MODIFY, EXISTING_DOCUMENT: title, BASED_ON: ref) from the response. */
export function parseSubpoenaResponse(text: string): ParsedSubpoenaResponse {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let flag: ParsedSubpoenaResponse['flag'] = null
  const existingTitles: string[] = []
  let basedOn: string | null = null
  let i = 0
  for (; i < lines.length; i++) {
    // Tolerates markdown emphasis and a trailing colon around the tags.
    const line = lines[i].trim().replace(/^[*_`]+|[*_`]+$/g, '')
    if (!line) continue
    const tag = line.match(/^(QUASH|MODIFY)\s*:?$/i)
    if (tag) {
      // Quash outranks modify when both appear.
      if (tag[1].toUpperCase() === 'QUASH' || !flag) flag = tag[1].toLowerCase() as 'quash' | 'modify'
      continue
    }
    const existing = line.match(/^EXISTING_DOCUMENT\s*:\s*(.+)$/i)
    if (existing) {
      const title = existing[1].trim().replace(/^["“']|["”']$/g, '')
      if (title && !existingTitles.some((t) => t.toLowerCase() === title.toLowerCase())) existingTitles.push(title)
      continue
    }
    const based = line.match(/^BASED_ON\s*:\s*["“']?([^"”'\s]+)["”']?$/i)
    if (based) {
      basedOn ??= based[1].toUpperCase()
      continue
    }
    break
  }
  return { body: lines.slice(i).join('\n').trim(), flag, existingTitles, basedOn }
}
