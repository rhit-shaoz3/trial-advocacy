import { readFileSync } from 'node:fs'
import Mustache from 'mustache'
import type { FeedbackLevel } from '../courses/cases.ts'
import type { Side } from '../courses/matchups.ts'
import type { PriorDiscovery } from '../exchange/mentorPrompt.ts'
import { formatCaseDate, partyNames, partyRole } from '../witness/profile.ts'
import type { PlannerChart } from './planner.ts'

// The system prompt for one round of feedback on a team's case planner:
// templates/planner-review.md (the client team's), filled in with the whole
// case file, marked with what the team can see, and the team's chart. The
// message is always the same.

// A Windows checkout (core.autocrlf) has a CRLF template; the prompt is the same everywhere.
const TEMPLATE = readFileSync(new URL('./templates/planner-review.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

export const PLANNER_MESSAGE = 'Review our planner.'

/** A card's or gap's short id in the prompt ("c3", "g2"), so the feedback can name it. */
export type Labels = Record<string, { kind: 'card' | 'gap'; id: string }>

export interface PlannerReviewContext {
  caseTitle: string
  parties?: { plaintiff: string; defendant: string }
  caseSummary: string
  inWorldDate: string | null
  side: Side
  /** What the team can use now, in plain words. */
  availableTools: string[]
  interrogatoryLimit: number | null
  interrogatoriesServed: number
  chart: PlannerChart
  /** The witnesses' names, by id, for the cards' tags. */
  witnessNames: Record<string, string>
  labels: Labels
  round: number
  /** How demanding the instructor wants the feedback to be. */
  level: FeedbackLevel
  /** The last round's feedback as written, and the team's replies to it by short id. */
  previousFeedback: string | null
  teamReplies: { label: string; text: string }[]
  documents: { title: string; teamHasAccess: boolean; content: string }[]
  witnesses: { name: string; title: string; side: string }[]
  facts: { fact: string; teamCanSee: boolean }[]
  priorDiscovery: PriorDiscovery[]
}

/** Case documents arrive verbatim, so Mustache's HTML escaping is off (the template asks for this). */
const render = (view: object) => Mustache.render(TEMPLATE, view, {}, { escape: (text: string) => text })

/** Removes the blank runs left behind by comments and false sections. */
const tidy = (text: string) => text.replace(/\n{3,}/g, '\n\n').trim()

const yesNo = (value: boolean) => (value ? 'yes' : 'no')

/**
 * Short ids for the chart's cards and gaps. A card or gap keeps the id it had
 * last round, so the feedback and the team's replies still point at it; new
 * ones take the next free number. Cards are numbered down the tree, in order.
 */
export function labelChart(chart: PlannerChart, previous: Labels = {}): Labels {
  const labels: Labels = {}
  const known = new Map(Object.entries(previous).map(([label, target]) => [target.id, label]))
  const next = { card: 1, gap: 1 }
  for (const label of Object.keys(previous)) {
    const kind = label.startsWith('c') ? 'card' : 'gap'
    next[kind] = Math.max(next[kind], Number(label.slice(1)) + 1)
  }
  const ordered: PlannerChart['cards'] = []
  const walk = (parentId: string | null) => {
    for (const c of chart.cards.filter((c) => c.parentId === parentId).sort((a, b) => a.position - b.position)) {
      ordered.push(c)
      walk(c.id)
    }
  }
  walk(null)
  for (const c of ordered) labels[known.get(c.id) ?? `c${next.card++}`] = { kind: 'card', id: c.id }
  for (const g of [...chart.gaps].sort((a, b) => a.position - b.position)) {
    labels[known.get(g.id) ?? `g${next.gap++}`] = { kind: 'gap', id: g.id }
  }
  return labels
}

/** The chart as the template's planner_json, with the short ids. */
export function plannerJson(chart: PlannerChart, labels: Labels, witnessNames: Record<string, string>) {
  const label = new Map(Object.entries(labels).map(([l, t]) => [t.id, l]))
  const cards = Object.values(labels)
    .filter((t) => t.kind === 'card')
    .map((t) => chart.cards.find((c) => c.id === t.id)!)
    .filter(Boolean)
  return JSON.stringify(
    {
      cards: cards.map((c) => ({
        id: label.get(c.id),
        kind: c.parentId ? 'subfact' : 'fact',
        parent_id: c.parentId ? label.get(c.parentId) : null,
        title: c.title,
        notes: c.notes,
        evidence: c.evidence.map((e) => ({ document_title: e.title, excerpt: e.excerpt, note: e.note })),
        witnesses: c.witnessIds.map((id) => witnessNames[id]).filter(Boolean),
      })),
      gaps: chart.gaps
        .filter((g) => label.has(g.id))
        .map((g) => ({
          id: label.get(g.id),
          ...(g.cardId && label.has(g.cardId) && { card_id: label.get(g.cardId) }),
          description: g.description,
          tools: g.tools.map((t) => ({
            tool: t.tool,
            priority: t.priority,
            reason: t.reason,
            specifics: [t.witnessId && witnessNames[t.witnessId] ? `Witness: ${witnessNames[t.witnessId]}.` : '', t.specifics]
              .filter(Boolean)
              .join(' '),
          })),
        })),
    },
    null,
    2,
  )
}

/** The reviewer's system prompt for this round. */
export function buildPlannerPrompt(ctx: PlannerReviewContext, today = new Date()) {
  const names = partyNames(ctx.caseTitle, ctx.parties)
  const role = partyRole(ctx.side)
  return `${tidy(
    render({
      case_name: ctx.caseTitle,
      plaintiff_name: names.plaintiff,
      defendant_name: names.defendant,
      case_summary: ctx.caseSummary,
      // Every case is civil for now.
      is_criminal: false,
      is_prosecution: false,
      in_world_date: formatCaseDate(ctx.inWorldDate ?? today.toISOString().slice(0, 10)),
      team_side: role,
      team_party_name: role === 'plaintiff' ? names.plaintiff : names.defendant,
      opposing_party_name: role === 'plaintiff' ? names.defendant : names.plaintiff,
      available_tools: ctx.availableTools.join(', '),
      ...(ctx.interrogatoryLimit !== null && {
        interrogatory_limit: ctx.interrogatoryLimit,
        interrogatories_already_served: ctx.interrogatoriesServed,
      }),
      planner_json: plannerJson(ctx.chart, ctx.labels, ctx.witnessNames),
      level_gentle: ctx.level === 'gentle',
      level_balanced: ctx.level === 'balanced',
      level_rigorous: ctx.level === 'rigorous',
      round_number: ctx.round,
      previous_feedback: ctx.previousFeedback ?? undefined,
      team_replies: ctx.teamReplies.length ? ctx.teamReplies.map((r) => `[${r.label}] ${r.text.trim()}`).join('\n\n') : undefined,
      documents: ctx.documents.map((d) => ({ title: d.title, team_has_access: yesNo(d.teamHasAccess), content: d.content.trim() })),
      witnesses: ctx.witnesses.map((w) => ({ name: w.name, title: w.title || 'no title given', side: w.side })),
      facts: ctx.facts.map((f) => ({ fact: f.fact, team_can_see: yesNo(f.teamCanSee) })),
      prior_discovery: ctx.priorDiscovery.map((p) => ({
        title: p.title,
        type: p.type,
        served_by: p.servedBy,
        status: p.status,
        content: p.content,
      })),
    }),
  )}\n`
}

export const PLANNER_TAGS = ['LOOKS_GOOD', 'SMALL_EDITS', 'NEEDS_IMPROVEMENT'] as const
export type PlannerTag = (typeof PLANNER_TAGS)[number]

export interface ParsedPlannerReview {
  tag: PlannerTag
  overview: string
  bigPicture: string
  notes: { label: string; kind: 'card' | 'gap'; text: string }[]
}

/**
 * The reviewer's text with the short ids it may mention ("g1 still has no
 * tools") written as what the students call them: the card's or gap's own
 * words, in quotes.
 */
export function nameLabels(text: string, labels: Labels, chart: PlannerChart) {
  return text.replace(/\b([cg]\d+)\b/g, (label) => {
    const target = labels[label]
    const words =
      target?.kind === 'card'
        ? chart.cards.find((c) => c.id === target.id)?.title
        : target && chart.gaps.find((g) => g.id === target.id)?.description
    const shown = words?.trim()
    if (!shown) return label
    return `“${shown.length > 80 ? `${shown.slice(0, 79).trimEnd()}…` : shown}”`
  })
}

const block = (text: string, name: string) => text.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'))?.[1].trim() ?? ''

/**
 * Reads the reviewer's reply: the tag on the first line (as the discovery
 * mentor's is read: a missing or garbled tag counts as needing work), the
 * overview, each card and gap block, and the big picture.
 */
export function parsePlannerReview(text: string): ParsedPlannerReview {
  const first = (text.trim().split('\n')[0] ?? '').replace(/[*`#:]/g, '').trim().replace(/^_+|_+$/g, '').toUpperCase().replace(/\s+/g, '_')
  const tag = PLANNER_TAGS.find((t) => first === t) ?? 'NEEDS_IMPROVEMENT'
  const notes = [...text.matchAll(/<(card|gap)\s+id\s*=\s*["']?([\w-]+)["']?\s*>([\s\S]*?)<\/\1>/gi)].map((m) => ({
    kind: m[1].toLowerCase() as 'card' | 'gap',
    label: m[2],
    text: m[3].trim(),
  }))
  let overview = block(text, 'overview')
  // A reply with none of the blocks is still feedback: all of it, after the tag.
  if (!overview && notes.length === 0 && !block(text, 'big_picture')) {
    overview = PLANNER_TAGS.includes(first as PlannerTag) ? text.trim().split('\n').slice(1).join('\n').trim() : text.trim()
  }
  return { tag, overview, bigPicture: block(text, 'big_picture'), notes: notes.filter((n) => n.text) }
}
