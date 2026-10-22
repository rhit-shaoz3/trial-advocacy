import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import {
  askWitness,
  buildMessages,
  buildRequest,
  splitObjection,
  WitnessRefusalError,
  type MessagesClient,
} from './deposition.ts'
import { modelFor } from '../ai/models.ts'
import { buildSystemPrompt, type DepositionSettings, type WitnessProfile } from './prompt.ts'

// A made-up witness (a grocery slip-and-fall), so no real case material is in the repo.
const profile: WitnessProfile = {
  name: 'Dana Lee',
  title: 'Night stocker, FreshMart',
  roleInCase: 'You were stocking aisle 5 when the customer fell.',
  alignedPartyRole: 'defendant',
  alignedPartyName: 'FreshMart',
  personaNotes: 'Quiet and careful; has worked nights for six years.',
  caseName: 'Ortiz v. FreshMart',
  plaintiffName: 'Ana Ortiz',
  defendantName: 'FreshMart',
  caseSummary: 'Ana Ortiz slipped in aisle 5 and broke her wrist.',
  inWorldDate: 'March 15, 2026',
  keyDisputedIssues: 'whether the floor was wet before the fall',
  importantFacts: {
    plaintiff: ['Nobody mopped aisle 5 after 8 p.m.', 'The "Wet floor" sign was in the back room.'],
    defense: ['Ms. Ortiz was looking at her phone when she fell.'],
  },
  documents: [
    {
      title: 'Dana Lee\'s incident statement',
      type: 'own_statement',
      witnessKnows: true,
      content: 'I walked aisle 5 around 9 and it was dry. "Clean-up" calls go to Sam & Jo.',
    },
    { title: 'Store camera log', type: 'record', witnessKnows: false, content: 'Camera 4 offline 8:50-9:20.' },
  ],
}

const adverse: DepositionSettings = { examiningPartyRole: 'plaintiff', examiningPartyName: 'Ana Ortiz' }
const friendly: DepositionSettings = { examiningPartyRole: 'defendant', examiningPartyName: 'FreshMart' }

describe('buildSystemPrompt', () => {
  it('fills in the witness, the case, and the date, with the template comments removed', () => {
    const prompt = buildSystemPrompt(profile, adverse)

    expect(prompt).toContain('Stay in character as Dana Lee')
    expect(prompt).toContain('- Job title: Night stocker, FreshMart')
    expect(prompt).toContain('- Your side: you are a witness for the defendant, FreshMart.')
    expect(prompt).toContain('- Background and demeanor: Quiet and careful')
    expect(prompt).toContain("Today's date, in the world of the case, is March 15, 2026.")
    expect(prompt).toContain('These issues must stay genuinely disputed: whether the floor was wet')
    expect(prompt).not.toContain('TEMPLATE 1')
    expect(prompt).not.toContain('TEMPLATE 2')
    expect(prompt).not.toMatch(/\{\{|\}\}/)
  })

  it('labels each document and keeps its text exactly, without HTML escaping', () => {
    const prompt = buildSystemPrompt(profile, adverse)

    expect(prompt).toContain(`<document title="Dana Lee's incident statement" type="own_statement" witness_knows="yes">`)
    expect(prompt).toContain('<document title="Store camera log" type="record" witness_knows="no">')
    expect(prompt).toContain('"Clean-up" calls go to Sam & Jo.')
    expect(prompt).not.toMatch(/&quot;|&amp;|&#39;/)
  })

  it("includes the instructor's rulings on facts from earlier interviews", () => {
    const prompt = buildSystemPrompt(
      { ...profile, settledFacts: { accepted: ['Dana mopped at 8:45.'], denied: ['A sign was posted.', 'Sam was there.'] } },
      adverse,
    )
    expect(prompt).toContain('# Facts settled in earlier interviews')
    expect(prompt).toContain('<settled_facts>\n- Dana mopped at 8:45.\n</settled_facts>')
    expect(prompt).toContain('# Things that are not true')
    expect(prompt).toContain('<untrue_facts>\n- A sign was posted.\n- Sam was there.\n</untrue_facts>')
    expect(prompt).toContain('one of the most important facts, or a settled fact, and never say anything listed as not true')
  })

  it("lists both sides' most important facts, and how to handle questions near them", () => {
    const prompt = buildSystemPrompt(profile, adverse)

    const section = prompt.slice(prompt.indexOf('# The most important facts'), prompt.indexOf('# What you know'))
    expect(section).toContain(
      'For the plaintiff:\n- Nobody mopped aisle 5 after 8 p.m.\n- The "Wet floor" sign was in the back room.\n',
    )
    expect(section).toContain('For the defense:\n- Ms. Ortiz was looking at her phone when she fell.\n')
    expect(section).toContain('Never make up a fact that contradicts any of these important facts.')
    expect(section).toContain('you may say you don\'t know, as long as that doesn\'t damage your credibility')
    expect(section).toContain('say "Let me check" instead, to avoid the question for now')
    expect(prompt).toContain('one of the most important facts, or a settled fact')
  })

  it('leaves out optional sections that do not apply', () => {
    const bare = buildSystemPrompt(
      {
        ...profile,
        personaNotes: undefined,
        keyDisputedIssues: undefined,
        importantFacts: undefined,
        settledFacts: { accepted: [], denied: [] },
      },
      adverse,
    )
    expect(bare).not.toContain('# The most important facts')
    expect(bare).not.toContain('# Facts settled in earlier interviews')
    expect(bare).not.toContain('# Things that are not true')
    expect(bare).not.toContain('Background and demeanor')
    expect(bare).not.toContain('must stay genuinely disputed')
    expect(bare).not.toContain('You are testifying as an expert')

    const expert = buildSystemPrompt({ ...profile, expert: { field: 'floor safety', compensation: '$300 an hour' } }, adverse)
    expect(expert).toContain('opinions in floor safety. You are paid $300 an hour')
  })

  it("puts the witness at ease with their own side's attorney", () => {
    const prompt = buildSystemPrompt(profile, { ...friendly, examiningAttorneyName: 'Mr. Park' })

    expect(prompt).toContain('The attorney questioning you represents the defendant, FreshMart. The attorney\'s name is Mr. Park.')
    expect(prompt).toContain("# Who is questioning you: your own side's attorney")
    expect(prompt).not.toContain("the opposing side's attorney")
  })

  it('keeps the witness guarded with the other side, with their lawyer only when one is set', () => {
    const guarded = buildSystemPrompt(profile, adverse)
    expect(guarded).toContain("# Who is questioning you: the opposing side's attorney")
    expect(guarded).not.toContain('# Your lawyer is present')

    const defended = buildSystemPrompt(profile, { ...adverse, defendingCounselName: 'Ms. Patel' })
    expect(defended).toContain('# Your lawyer is present')
    expect(defended).toContain('Ms. Patel, the lawyer representing you, is defending this deposition.')
    expect(defended).toContain('Ms. Patel: Objection, compound.')
    // Misleading questions: the lawyer objects and the witness won't answer them as asked.
    expect(defended).toContain('Ms. Patel: Objection, misstates the testimony.')
    expect(defended).toContain("Don't answer it the way it's asked")
    expect(defended).toContain('Being misleading is never a reason to instruct you not to answer.')
  })

  it("never lets the witness's own lawyer object to their side's questions", () => {
    const prompt = buildSystemPrompt(profile, { ...friendly, defendingCounselName: 'Ms. Patel' })
    expect(prompt).not.toContain('# Your lawyer is present')
  })
})

describe('buildRequest', () => {
  it('sends the transcript as alternating turns, ending with the new question', () => {
    const messages = buildMessages([{ question: 'Your name?', reply: 'Dana Lee.' }], 'Where do you work?')
    expect(messages).toEqual([
      { role: 'user', content: 'Your name?' },
      { role: 'assistant', content: 'Dana Lee.' },
      { role: 'user', content: 'Where do you work?' },
    ])
  })

  it('takes the model from the settings, or the one asked for', () => {
    const before = process.env.CLAUDE_WITNESS_MODEL
    process.env.CLAUDE_WITNESS_MODEL = 'claude-sonnet-5-5'
    try {
      const request = buildRequest({ profile, settings: adverse, transcript: [], question: 'Hi?' })
      expect(request.model).toBe('claude-sonnet-5-5')
      // Models other than Haiku keep the server-side fallback.
      expect(request.fallbacks).toBe('default')
      expect(request.betas).toEqual(['server-side-fallback-2026-07-01'])
      expect(buildRequest({ profile, settings: adverse, transcript: [], question: 'Hi?', model: 'claude-opus-5-5' }).model).toBe(
        'claude-opus-5-5',
      )
    } finally {
      if (before === undefined) delete process.env.CLAUDE_WITNESS_MODEL
      else process.env.CLAUDE_WITNESS_MODEL = before
    }
  })

  it('uses the witness model (Haiku, which has no server-side fallback) with caching', () => {
    // With no model given, the settings decide (Haiku unless .env says otherwise).
    expect(buildRequest({ profile, settings: adverse, transcript: [], question: 'Your name?' }).model).toBe(modelFor('witness'))
    const request = buildRequest({ profile, settings: adverse, transcript: [], question: 'Your name?', model: 'claude-haiku-5-5' })

    expect(request.model).toBe('claude-haiku-5-5')
    expect(request.thinking).toEqual({ type: 'adaptive' })
    expect(request.output_config).toEqual({ effort: 'high' })
    expect(request).not.toHaveProperty('fallbacks')
    expect(request).not.toHaveProperty('betas')
    // The case file is cached for the hour an interview can last; the transcript for 5 minutes.
    expect(request.cache_control).toEqual({ type: 'ephemeral' })
    const [system] = request.system as Anthropic.Beta.Messages.BetaTextBlockParam[]
    expect(system.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' })
    expect(system.text).toBe(buildSystemPrompt(profile, adverse))
  })

  it('keeps the server-side fallback on models that have one', () => {
    const request = buildRequest({ profile, settings: adverse, transcript: [], question: 'Your name?', model: 'claude-sonnet-5-5' })
    expect(request.fallbacks).toBe('default')
    expect(request.betas).toEqual(['server-side-fallback-2026-07-01'])
  })
})

function fakeClient(response: Partial<Anthropic.Beta.Messages.BetaMessage>): MessagesClient {
  const message = {
    model: 'claude-haiku-5-5',
    stop_reason: 'end_turn',
    stop_details: null,
    usage: { input_tokens: 10, output_tokens: 5 },
    content: [],
    ...response,
  } as unknown as Anthropic.Beta.Messages.BetaMessage
  return { beta: { messages: { create: vi.fn().mockResolvedValue(message) } } }
}

const text = (t: string) => ({ type: 'text', text: t }) as Anthropic.Beta.Messages.BetaTextBlock

describe('askWitness', () => {
  it("returns the witness's spoken answer, ignoring thinking blocks", async () => {
    const client = fakeClient({
      content: [{ type: 'thinking', thinking: '', signature: 's' } as Anthropic.Beta.Messages.BetaThinkingBlock, text('Yes.')],
    })

    const result = await askWitness(client, { profile, settings: adverse, transcript: [], question: 'Were you working?' })

    expect(result).toMatchObject({ reply: 'Yes.', answer: 'Yes.', objection: null, model: 'claude-haiku-5-5' })
  })

  it('separates the defending lawyer\'s objection from the answer', async () => {
    const client = fakeClient({ content: [text('Ms. Patel: Objection, compound.\n\nI only walked it once.')] })

    const result = await askWitness(client, {
      profile,
      settings: { ...adverse, defendingCounselName: 'Ms. Patel' },
      transcript: [],
      question: 'You walked the aisle and saw water?',
    })

    expect(result.objection).toEqual({ speaker: 'Ms. Patel', text: 'Objection, compound.' })
    expect(result.answer).toBe('I only walked it once.')
    expect(result.reply).toBe('Ms. Patel: Objection, compound.\n\nI only walked it once.')
  })

  it('reports a refusal or a cut-off reply instead of returning partial text', async () => {
    const refused = fakeClient({
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'general_harms', explanation: null } as Anthropic.Beta.Messages.BetaRefusalStopDetails,
    })
    await expect(askWitness(refused, { profile, settings: adverse, transcript: [], question: 'Q' })).rejects.toBeInstanceOf(
      WitnessRefusalError,
    )

    const cut = fakeClient({ stop_reason: 'max_tokens', content: [text('I was')] })
    await expect(askWitness(cut, { profile, settings: adverse, transcript: [], question: 'Q' })).rejects.toThrow('cut off')
  })
})

describe('splitObjection', () => {
  it('only treats a leading line from the named lawyer as an objection', () => {
    expect(splitObjection('Ms. Patel: Objection, form.\n\nNo.', 'Ms. Patel')).toEqual({
      objection: { speaker: 'Ms. Patel', text: 'Objection, form.' },
      answer: 'No.',
    })
    expect(splitObjection('I told Ms. Patel: no.', 'Ms. Patel')).toEqual({ objection: null, answer: 'I told Ms. Patel: no.' })
    expect(splitObjection('Ms. Patel: Objection.\n\nNo.')).toEqual({ objection: null, answer: 'Ms. Patel: Objection.\n\nNo.' })
  })

  it('drops a transcript-style answer label', () => {
    expect(splitObjection('A: Yes.')).toEqual({ objection: null, answer: 'Yes.' })
  })
})
