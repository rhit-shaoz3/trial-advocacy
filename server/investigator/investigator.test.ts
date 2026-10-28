import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import { buildFinalizeRequest, finalizeReport, stripTags, type EditClient } from './finalize.ts'
import { buildInvestigationRequest, matchTitles, parseReport } from './investigate.ts'
import { buildInvestigatorPrompt, buildTeamBlock, isOrganization, type InvestigatorContext } from './prompt.ts'

const context: InvestigatorContext = {
  investigatorName: 'Nora Vance',
  instructions: '',
  caseTitle: 'Rivera v. Northstar Transit',
  caseSummary: 'A bus braked hard at a crosswalk; a passenger was hurt.',
  inWorldDate: '2026-03-15',
  disputedIssues: 'Whether the driver was distracted',
  side: 'plaintiff',
  teamNumber: 3,
  documents: [
    { id: 'm1', title: 'Fact pattern', teamHasAccess: true, content: 'The bus braked at 5th and Main.' },
    { id: 'm2', title: 'Maintenance log', teamHasAccess: false, content: 'Brakes serviced March 1.' },
  ],
  witnesses: [{ name: 'Marcus Okafor', role: 'Bus driver', side: 'defense' }],
  importantFacts: { plaintiff: ['The light was green.'], defense: ['A pedestrian stepped out.'] },
  settled: { accepted: ['A neighbor says she heard a horn.'], denied: ['The driver was on his phone.'] },
}

const REPORT = `1. I photographed the intersection from the northeast corner. [NEW FACT]
2. The fact pattern places the stop at 5th and Main. [CASE FILE: Fact pattern]
3. The city's maintenance log shows the brakes were serviced March 1. [NEW ACCESS: Maintenance log]

<review>
NEW FACTS
- A traffic camera is mounted on the northeast corner of 5th and Main.
- The camera points south, away from the crosswalk.
NEW ACCESS
- Maintenance log
- A report that isn't in the file
RECORDS REQUESTED
- Northstar's dispatch audio, by subpoena.
</review>`

describe('the investigator prompt', () => {
  it('fills in the case, the same for every team in the world', () => {
    const prompt = buildInvestigatorPrompt(context)

    expect(prompt).toContain('You are Nora Vance, a licensed private investigator.')
    expect(prompt).toContain('starts with a <your_team> block that says which team you work for')
    expect(prompt).toContain('Contact the opposing party (named in <your_team>) directly.')
    expect(prompt).toContain('Interview current employees of the opposing party, when it')
    expect(prompt).toContain('Today\'s date, in the world of the case, is March 15, 2026.')
    expect(prompt).toContain('<document title="Fact pattern">')
    expect(prompt).toContain('<document title="Maintenance log">')
    // Nothing about the asking team, so both teams share one cached prompt.
    expect(prompt).not.toMatch(/Team 3|Rivera \(|team_has_access/)
    expect(buildInvestigatorPrompt({ ...context, side: 'defense', teamNumber: 4, documents: context.documents.map((d) => ({ ...d, teamHasAccess: true })) })).toBe(prompt)
    expect(prompt).toContain('- Marcus Okafor, Bus driver (side: defendant)')
    expect(prompt).toContain('- The light was green.\n- A pedestrian stepped out.')
    expect(prompt).toContain('- A neighbor says she heard a horn.')
    expect(prompt).toContain('- The driver was on his phone.')
    expect(prompt).toContain('These issues must stay genuinely disputed: Whether the driver was distracted')
    expect(prompt).not.toContain('This is a criminal case')
    expect(prompt).not.toContain('{{')
    expect(prompt).not.toContain('Notes from the instructor')
    // He may watch named witnesses in public, within the limits, and tries to help.
    expect(prompt).toContain('This includes named witnesses and parties')
    expect(prompt).toContain('witness tampering (18 U.S.C. § 1512(d)')
    expect(prompt).toContain('# Be as helpful as you lawfully can')
    // He watches when asked, doesn't stick to an old refusal, and never corrects himself on the page.
    expect(prompt).toContain("When your team asks you to watch someone, do it and report what you saw.")
    expect(prompt).toContain("Don't repeat a refusal just because you made it before")
    expect(prompt).toContain('Your report must never contain corrections, withdrawals, second thoughts')
    expect(prompt).toContain('report it as done on the next such day')
    // Records that need legal process get their own list in the review block.
    expect(prompt).toContain('RECORDS REQUESTED\n- One record per line')
  })

  it('tells him which team he works for, its opponent, and what it has', () => {
    expect(buildTeamBlock(context)).toBe(
      [
        '<your_team>',
        'You work for the attorneys for the plaintiff, Rivera (Team 3).',
        // Northstar Transit is a company, so its employees are off-limits too.
        'Opposing party: Northstar Transit (an organization)',
        'Case files your team already has:',
        '- Fact pattern',
        '</your_team>',
      ].join('\n'),
    )
  })

  it("adds the instructor's own instructions at the end", () => {
    const prompt = buildInvestigatorPrompt({ ...context, instructions: 'Keep reports under 200 words.' })
    expect(prompt.trimEnd().endsWith('Keep reports under 200 words.')).toBe(true)
    expect(prompt).toContain('# Notes from the instructor for this case')
  })

  it('tells people from organizations', () => {
    expect(isOrganization('Northstar Transit')).toBe(true)
    expect(isOrganization('Thrill Park LLC')).toBe(true)
    expect(isOrganization('Elena Rivera')).toBe(false)
  })
})

describe('an investigation request', () => {
  it("replays the team's earlier assignments and reports, then the new one", () => {
    const request = buildInvestigationRequest(
      { context, history: [{ assignment: 'Find witnesses.', report: 'I found Ann Lee.' }], assignment: 'Talk to Ann Lee again.' },
      'claude-haiku-5-5',
    )
    expect(request.model).toBe('claude-haiku-5-5')
    expect(request.messages).toEqual([
      { role: 'user', content: 'Find witnesses.' },
      { role: 'assistant', content: 'I found Ann Lee.' },
      // The new assignment carries a reminder to end with the review block.
      {
        role: 'user',
        content: `${buildTeamBlock(context)}\n\nAssignment from Team 3:\n\nTalk to Ann Lee again.\n\nReport back, ending with your <review> block.`,
      },
    ])
    const system = request.system as Anthropic.Beta.Messages.BetaTextBlockParam[]
    expect(system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' })
    expect(request).not.toHaveProperty('fallbacks')
  })
})

describe('reading a report', () => {
  it('splits off the review block and reads its lists', () => {
    const parsed = parseReport(REPORT)
    expect(parsed.body).toMatch(/^1\. I photographed/)
    expect(parsed.body).not.toContain('<review>')
    expect(parsed.facts).toEqual([
      'A traffic camera is mounted on the northeast corner of 5th and Main.',
      'The camera points south, away from the crosswalk.',
    ])
    // Files cited in the report itself count too.
    expect(parsed.accessTitles).toEqual(['Maintenance log', "A report that isn't in the file", 'Fact pattern'])
    expect(parsed.hasReviewBlock).toBe(true)
    expect(parsed.records).toEqual(["Northstar's dispatch audio, by subpoena."])
  })

  it('treats "none" as nothing, and a report without a block as all report', () => {
    expect(parseReport('Done.\n<review>\nNEW FACTS\nnone\nNEW ACCESS\nnone\nRECORDS REQUESTED\nnone\n</review>')).toEqual({
      body: 'Done.',
      hasReviewBlock: true,
      facts: [],
      accessTitles: [],
      records: [],
    })
    expect(parseReport('Just a report.')).toEqual({ body: 'Just a report.', hasReviewBlock: false, facts: [], accessTitles: [], records: [] })
  })

  it('reads headings in bold or with a colon', () => {
    const parsed = parseReport('Report.\n<review>\n**NEW FACTS**\n- A fact.\nNEW ACCESS:\n- A file\n**RECORDS REQUESTED:**\n- A record\n</review>')
    expect(parsed).toMatchObject({ facts: ['A fact.'], accessTitles: ['A file'], records: ['A record'] })
  })

  it('matches the files he names to the case file, ignoring case and quotes', () => {
    const files = [{ title: 'Maintenance log' }, { title: 'Fact pattern' }]
    expect(matchTitles(['"maintenance log"', 'Nothing like it', 'Maintenance Log'], files)).toEqual([files[0]])
  })
})

describe("the team's clean report", () => {
  it('drops the source tags without asking the AI when nothing was turned down', async () => {
    const create = vi.fn()
    const report = await finalizeReport({ messages: { create } } as EditClient, {
      investigatorName: 'Nora Vance',
      body: parseReport(REPORT).body,
      deniedFacts: [],
      deniedTitles: [],
    })
    expect(create).not.toHaveBeenCalled()
    expect(report).toBe(stripTags(parseReport(REPORT).body))
    expect(report).not.toMatch(/\[(NEW|CASE|EXISTING)/)
    expect(report).toContain('3. The city’s maintenance log'.replace('’', "'"))
    // A tag he left the title off comes out too.
    expect(stripTags('8. The state record is public. [NEW ACCESS]')).toBe('8. The state record is public.')
  })

  it('asks the AI to cut what was denied', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '1. I photographed the intersection. [NEW FACT]' }],
    })
    const input = { investigatorName: 'Nora Vance', body: 'report', deniedFacts: ['The camera points south.'], deniedTitles: ['Maintenance log'] }
    const report = await finalizeReport({ messages: { create } } as unknown as EditClient, input)

    expect(report).toBe('1. I photographed the intersection.')
    const sent = buildFinalizeRequest(input, 'claude-haiku-5-5')
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ messages: sent.messages }))
    expect(sent.messages[0].content).toContain('- The camera points south.')
    expect(sent.messages[0].content).toContain('<documents_the_team_may_not_have>\n- Maintenance log')
  })
})
