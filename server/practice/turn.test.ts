import { describe, expect, it } from 'vitest'
import { buildSystemPrompt, type DepositionSettings, type PracticeSettings, type WitnessProfile } from '../witness/prompt.ts'
import { buildPracticeRequest, parsePracticeReply } from './turn.ts'

// A made-up witness (a grocery slip-and-fall), so no real case material is in the repo.
const profile: WitnessProfile = {
  name: 'Dana Lee',
  title: 'Night stocker, FreshMart',
  roleInCase: 'You were stocking aisle 5 when the customer fell.',
  alignedPartyRole: 'defendant',
  alignedPartyName: 'FreshMart',
  caseName: 'Ortiz v. FreshMart',
  plaintiffName: 'Ana Ortiz',
  defendantName: 'FreshMart',
  caseSummary: 'Ana Ortiz slipped in aisle 5 and broke her wrist.',
  inWorldDate: 'March 15, 2026',
  documents: [{ title: 'Dana Lee’s statement', type: 'own_statement', witnessKnows: true, content: 'Aisle 5 was dry at 9.' }],
}

const adverse: DepositionSettings = { examiningPartyRole: 'plaintiff', examiningPartyName: 'Ana Ortiz', defendingCounselName: 'Ms. Park' }
const friendly: DepositionSettings = { examiningPartyRole: 'defendant', examiningPartyName: 'FreshMart' }
const practice = (over: Partial<PracticeSettings> = {}): PracticeSettings => ({
  type: 'cross',
  goal: 'Pin down that she never checked aisle 5 after 9.',
  cooperation: 'regular',
  opposingCounselName: 'Mr. Grant',
  ...over,
})

describe('the practice prompt', () => {
  it('adds the supplement after both witness templates, with its fields filled in', () => {
    const prompt = buildSystemPrompt(profile, { ...adverse, defendingCounselName: undefined }, practice({ toneNotes: 'Tired and short.' }))
    const supplement = prompt.indexOf('# Practice mode')
    expect(supplement).toBeGreaterThan(prompt.indexOf('# This session: a deposition'))
    expect(prompt).toContain('# The setting: cross-examination')
    expect(prompt).toContain('Opposing counsel, Mr. Grant, who objects when a real lawyer would.')
    expect(prompt).toContain('Pin down that she never checked aisle 5 after 9.')
    expect(prompt).toContain('- Tone: Tired and short.')
    expect(prompt).toContain('<objection by="Mr. Grant">')
    // Without a summary, cross starts partway through.
    expect(prompt).toContain('Assume the earlier testimony matched your own statements.')
    // At trial, the witness's own lawyer doesn't object.
    expect(prompt).not.toContain('Ms. Park')
    expect(prompt).not.toMatch(/\{\{|\}\}/)
  })

  it('holds leading questions on direct, and keeps the deposition lawyer in a deposition', () => {
    const direct = buildSystemPrompt(profile, friendly, practice({ type: 'direct', priorTestimony: 'She described her shift.' }))
    expect(direct).toContain("If the question is leading and no exception applies, don't answer it.")
    expect(direct).toContain('<prior_testimony>\nShe described her shift.\n</prior_testimony>')
    expect(direct).not.toContain('Assume the earlier testimony matched')

    const deposition = buildSystemPrompt(profile, adverse, practice({ type: 'deposition' }))
    expect(deposition).toContain('Ms. Park')
    expect(deposition).toContain('In this setting, no questions are held for leading.')
    expect(deposition).toContain("There's no judge in this setting.")
    expect(deposition).toContain('<objection by="counsel">')
  })

  it('leaves the supplement out of a real session', () => {
    expect(buildSystemPrompt(profile, adverse)).not.toContain('# Practice mode')
  })
})

describe('buildPracticeRequest', () => {
  it('labels each turn the way the supplement says, on Sonnet with the case file cached', () => {
    const request = buildPracticeRequest({
      profile,
      settings: friendly,
      practice: practice({ type: 'direct' }),
      transcript: [
        { kind: 'question', text: 'You were in aisle 5, weren’t you?', reply: '<coach kind="leading" quote="weren’t you">Leading.</coach>\n<hold/>' },
        { kind: 'as_written', text: 'You were in aisle 5, weren’t you?', reply: '<objection by="Mr. Grant">Objection, leading.</objection>\n<await_response/>' },
      ],
      kind: 'objection_response',
      text: 'It’s preliminary, Your Honor.',
    })
    expect(request.model).toBe('claude-sonnet-5-5')
    expect(request.output_config).toEqual({ effort: 'medium' })
    expect(request.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'You were in aisle 5, weren’t you?'],
      ['assistant', expect.stringContaining('<hold/>')],
      ['user', '[Asked as written] You were in aisle 5, weren’t you?'],
      ['assistant', expect.stringContaining('<await_response/>')],
      ['user', '[Response to objection] It’s preliminary, Your Honor.'],
    ])
    const system = request.system as { text: string; cache_control: unknown }[]
    expect(system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' })
    expect(system[0].text).toContain('# The setting: direct examination')
  })
})

describe('parsePracticeReply', () => {
  it('reads the coach’s notes, anchored to words really in the question', () => {
    const blocks = parsePracticeReply(
      [
        '<coach kind="good" quote="What did you see">Open and simple, so the jury hears it from her.</coach>',
        '<coach kind="off_target" quote="words she never said">Not hers.</coach>',
        '<coach kind="sparkle" quote="aisle">Odd kind.</coach>',
        '<witness>A: I saw the floor was dry.</witness>',
      ].join('\n'),
      'What did you see in aisle 5?',
    )
    expect(blocks.coach).toEqual([
      { kind: 'good', quote: 'What did you see', text: 'Open and simple, so the jury hears it from her.' },
      { kind: 'off_target', quote: null, text: 'Not hers.' },
    ])
    expect(blocks.witness).toBe('I saw the floor was dry.')
    expect(blocks).toMatchObject({ hold: false, objection: null, awaitResponse: false, ruling: null })
  })

  it('keeps the witness quiet after a hold or an objection waiting for a response', () => {
    // Straight and curly quotes match each other.
    expect(parsePracticeReply('<coach kind="leading" quote="didn\'t you">Leading.</coach><hold/>', 'You saw it, didn’t you?')).toMatchObject({
      hold: true,
      witness: null,
      coach: [{ kind: 'leading', quote: "didn't you" }],
    })
    expect(parsePracticeReply('<objection by="Mr. Grant">Objection, hearsay.</objection>\n<await_response/>\n<witness>Oops.</witness>', 'What did Sam say?')).toMatchObject({
      objection: { by: 'Mr. Grant', text: 'Objection, hearsay.' },
      awaitResponse: true,
      witness: null,
    })
  })

  it('answers only when an objection is overruled', () => {
    const overruled = parsePracticeReply('<ruling result="overruled">Overruled. It goes to her state of mind.</ruling>\n<witness>He said it was wet.</witness>', 'x')
    expect(overruled).toMatchObject({ ruling: { result: 'overruled' }, awaitResponse: false, witness: 'He said it was wet.' })
    const sustained = parsePracticeReply('<ruling result="Sustained">Sustained.</ruling>\n<witness>He said…</witness>', 'x')
    expect(sustained).toMatchObject({ ruling: { result: 'sustained', text: 'Sustained.' }, witness: null })
  })

  it('takes a reply with no tags as the witness speaking, and keeps a deposition lawyer’s objection', () => {
    expect(parsePracticeReply('A: I don’t recall.', 'Who mopped?').witness).toBe('I don’t recall.')
    expect(parsePracticeReply('<counsel>Ms. Park: Objection, form.</counsel>\n<witness>Around nine.</witness>', 'When?')).toMatchObject({
      counsel: 'Ms. Park: Objection, form.',
      witness: 'Around nine.',
    })
  })
})
