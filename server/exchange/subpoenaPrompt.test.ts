import { describe, expect, it } from 'vitest'
import { buildSubpoenaMessage, buildSubpoenaPrompt, parseSubpoenaResponse, type SubpoenaContext } from './subpoenaPrompt.ts'

const context: SubpoenaContext = {
  caseTitle: 'Winston v. Thrillville',
  parties: { plaintiff: 'Paige Winston', defendant: 'Thrillville Parks' },
  caseSummary: 'A rider was hurt on Atlas.',
  disputedIssues: 'Whether the operator checked the harness.',
  side: 'defense',
  recipient: 'paige winston',
  recipientDescription: 'The plaintiff.',
  requestType: 'inspection',
  records: '1. The garage where the bike is stored.',
  documents: [{ id: 'm1', title: 'Complaint', teamHasAccess: true, content: 'Winston & "Atlas"' }],
  importantFacts: { plaintiff: ['Atlas restarted.'], defense: [] },
  settled: { accepted: ['The gate was open.'], denied: ['The operator was asleep.'] },
  worldSubpoenas: [],
  otherWorldResponses: [],
  instructions: '',
  createNew: false,
}

describe('the subpoena prompt', () => {
  it('holds the rules, the case file, and the facts, the same for every subpoena in the world', () => {
    const prompt = buildSubpoenaPrompt(context, new Date('2026-10-28T12:00:00Z'))
    expect(prompt).toContain('You play the person or organization that received it (the recipient)')
    expect(prompt).toContain('<document title="Complaint">\nWinston & "Atlas"\n</document>')
    expect(prompt).toContain('Today\'s date, in the world of the case, is October 28, 2026.')
    expect(prompt).toContain('These issues must stay genuinely disputed: Whether the operator checked the harness.')
    expect(prompt).toContain('- The operator was asleep.')
    expect(prompt).toContain('Federal Rules of Civil Procedure')
    expect(prompt).not.toMatch(/\{\{|Criminal rules|SUBPOENA RESPONSE TEMPLATE|Notes from the reviewer|team_has_access|paige winston/)
    // Another team's subpoena, to someone else, for something else: the same prompt, so the same cache.
    const another = buildSubpoenaPrompt(
      {
        ...context,
        side: 'plaintiff',
        recipient: 'Mercy General',
        requestType: 'esi',
        records: 'Bills.',
        documents: context.documents.map((d) => ({ ...d, teamHasAccess: false })),
        worldSubpoenas: [{ recipient: 'X', requestType: 'documents', records: 'Y', responseTitle: 'Z' }],
        instructions: 'Shorter.',
        createNew: true,
      },
      new Date('2026-10-28T12:00:00Z'),
    )
    expect(another).toBe(prompt)
  })

  it('gives the subpoena itself, and what the team has, in the message', () => {
    const message = buildSubpoenaMessage(context)
    expect(message).toContain('Served by: the defendant, Thrillville Parks')
    // Named like a party, so it answers as one.
    expect(message).toContain('Directed to: paige winston (a party to the case)')
    expect(message).toContain('paige winston is a party, so respond the way a party responds to a Rule 34 request')
    expect(message).toContain('- Inspection of premises\n')
    expect(message).not.toContain('- Documents\n')
    expect(message).toContain('# Inspection of premises\n\n- Write an inspection report.')
    expect(message).not.toContain('# Tangible things')
    expect(message).toContain('<subpoena>\n1. The garage where the bike is stored.\n</subpoena>')
    expect(message).toContain('<team_documents>\n- Complaint\n</team_documents>')
    expect(message).toContain('<world_subpoenas>\n- None\n</world_subpoenas>')
    expect(message).toContain('<other_world_responses>\nNone\n</other_world_responses>')
    expect(message.trimEnd().endsWith('Prepare the response.')).toBe(true)
    expect(message).not.toMatch(/\{\{|SUBPOENA REQUEST TEMPLATE|Notes from the reviewer/)
  })

  it("lists this world's earlier subpoenas and other worlds' responses, to reuse", () => {
    const message = buildSubpoenaMessage({
      ...context,
      worldSubpoenas: [
        { recipient: 'Mercy General', requestType: 'documents', records: '1. ER records\n2. Bills', responseTitle: 'Response of Mercy General to subpoena (Team 1)' },
      ],
      otherWorldResponses: [
        { ref: 'R1', materialId: 'm9', recipient: 'Mercy General', requestType: 'esi', records: '1. ER records, June 2025.', response: 'RESPONSE OF MERCY GENERAL\nMG-000001' },
      ],
    })
    expect(message).toContain('- To Mercy General (documents), asking: 1. ER records 2. Bills\n  Response: "Response of Mercy General to subpoena (Team 1)"')
    expect(message).toContain(
      '<earlier_response ref="R1" recipient="Mercy General" type="electronically stored information">\n<request>\n1. ER records, June 2025.\n</request>\n<response>\nRESPONSE OF MERCY GENERAL\nMG-000001\n</response>\n</earlier_response>',
    )
    expect(message).not.toContain('m9')
  })

  it("adds the reviewer's notes to the message, and asks for a new file when told to", () => {
    const message = buildSubpoenaMessage({ ...context, instructions: 'Keep it to June.', createNew: true })
    expect(message).toMatch(/# Notes from the reviewer for this response\n\nFollow these too, within the rules above:\n\nDon't produce any existing case document.*\n\nKeep it to June\.\n$/)
  })
})

describe('reading the response', () => {
  it('takes the tag lines off the top', () => {
    expect(
      parseSubpoenaResponse('**MODIFY**\n\nEXISTING_DOCUMENT: "Gate log"\nexisting_document: Gate log\nQUASH:\nEXISTING_DOCUMENT: Ride manual\n\nRESPONSE OF X\nMODIFY stays here.'),
    ).toEqual({ body: 'RESPONSE OF X\nMODIFY stays here.', flag: 'quash', existingTitles: ['Gate log', 'Ride manual'], basedOn: null })
    expect(parseSubpoenaResponse('BASED_ON: r2\nBASED_ON: R1\nRESPONSE')).toEqual({ body: 'RESPONSE', flag: null, existingTitles: [], basedOn: 'R2' })
  })

  it('leaves a response with no tags alone', () => {
    expect(parseSubpoenaResponse('RESPONSE OF X\n\nProduced: X-000001')).toEqual({
      body: 'RESPONSE OF X\n\nProduced: X-000001',
      flag: null,
      existingTitles: [],
      basedOn: null,
    })
  })
})
