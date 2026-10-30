import { describe, expect, it } from 'vitest'
import { buildMentorMessage, buildMentorPrompt, parseMentorReply, type MentorContext } from './mentorPrompt.ts'

const base: MentorContext = {
  caseTitle: 'Ramirez v. Thrillville',
  caseSummary: 'A harness opened.',
  inWorldDate: '2026-03-02',
  side: 'defense',
  kind: 'rfas',
  mode: 'answer',
  servedRequests: '1. Admit the harness light was red.',
  draft: '1. Denied.',
  interrogatoryLimit: 25,
  interrogatoriesServed: 4,
  documents: [{ title: 'Incident report', content: 'The light was green.' }],
  acceptedFacts: ['The ride stopped at 3:02.'],
  priorDiscovery: [],
}

describe('the discovery mentor prompt', () => {
  it('puts the rules and what the team can see in the system prompt, and the draft in the message', () => {
    const system = buildMentorPrompt(base)
    expect(system).toContain('Law students on the defendant team, representing Thrillville')
    expect(system).toContain('Today\'s date, in the world of the case, is March 2, 2026.')
    expect(system).toContain('<document title="Incident report">\nThe light was green.\n</document>')
    expect(system).toContain('- The ride stopped at 3:02.')
    expect(system).toContain('Requests for admission (Rule 36):')
    expect(system).not.toContain('Interrogatories (Rule 33):')
    expect(system).toContain('None yet.')
    // The draft changes on every check, so it stays out of the cached prompt.
    expect(system).not.toContain('1. Denied.')
    expect(system).not.toContain('{{')

    const message = buildMentorMessage(base)
    expect(message).toContain('The team is drafting its responses to requests for admission served by Ramirez.')
    expect(message).toContain('<served_requests>\n1. Admit the harness light was red.\n</served_requests>')
    expect(message).toContain('<student_draft>\n1. Denied.\n</student_draft>')
    expect(message.endsWith('Review this draft.')).toBe(true)
  })

  it('describes a subpoena being drafted, with its justification as the goal', () => {
    const message = buildMentorMessage({
      ...base,
      side: 'plaintiff',
      kind: 'subpoena',
      mode: 'draft',
      subpoenaRecipient: 'Mercy Hospital',
      subpoenaTypes: 'documents',
      draft: 'ER records.',
      goal: 'Damages.',
    })
    expect(message).toContain('The team is drafting a subpoena to Mercy Hospital, asking for: documents.')
    expect(message).toContain('<student_goal>\nDamages.\n</student_goal>')
    expect(buildMentorPrompt({ ...base, kind: 'subpoena', mode: 'draft' })).toContain('Subpoenas (Rule 45):')
  })

  it('counts interrogatories already served', () => {
    const message = buildMentorMessage({ ...base, kind: 'interrogatories', mode: 'draft', draft: '1. Who?' })
    expect(message).toContain('It has already served 4 interrogatories on this party, and the limit is 25')
  })

  it('tells a re-check what it said last time, and says when it is the last check', () => {
    const first = buildMentorMessage({ ...base, kind: 'interrogatories', mode: 'draft', draft: '1. Who?' })
    expect(first).not.toContain('earlier version')
    expect(first).not.toContain('last check')

    const again = buildMentorMessage({
      ...base,
      kind: 'interrogatories',
      mode: 'draft',
      draft: '1. Who inspected it?',
      previous: { round: 1, feedback: 'Interrogatory 1: Who what?' },
      finalRound: true,
    })
    expect(again).toContain('You checked an earlier version of this draft (check 1).')
    expect(again).toContain('<previous_feedback>\nInterrogatory 1: Who what?\n</previous_feedback>')
    expect(again).toContain("This is the team's last check before it sends.")
    expect(again.endsWith('Review this draft.')).toBe(true)
    // The system prompt stays the same, so it's still cached.
    expect(buildMentorPrompt({ ...base, previous: { round: 1, feedback: 'x' }, finalRound: true })).toBe(buildMentorPrompt(base))
  })
})

describe('reading the reply', () => {
  it('takes the tag line off the feedback', () => {
    expect(parseMentorReply('SMALL_EDITS\n\nGood start.\n\nInterrogatory 2: Why?')).toEqual({
      tag: 'SMALL_EDITS',
      feedback: 'Good start.\n\nInterrogatory 2: Why?',
    })
    expect(parseMentorReply('**LOOKS_GOOD**\nTight and focused.')).toEqual({ tag: 'LOOKS_GOOD', feedback: 'Tight and focused.' })
    expect(parseMentorReply('Needs improvement\nToo broad.').tag).toBe('NEEDS_IMPROVEMENT')
  })

  it('treats a reply without a tag as needing work, keeping all of it', () => {
    expect(parseMentorReply('This set is overbroad.')).toEqual({ tag: 'NEEDS_IMPROVEMENT', feedback: 'This set is overbroad.' })
  })
})
