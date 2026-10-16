import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { checkReply, type EvalCase } from './checks.ts'

const answer = (text: string, objection: string | null = null) => ({
  answer: text,
  objection: objection === null ? null : { text: objection },
})
const failed = (failures: { check: string }[]) => failures.map((f) => f.check)

describe('checkReply', () => {
  it('passes a plain spoken answer', () => {
    expect(checkReply(answer('Yes, I was the only one.'), { maxWords: 10, mustMatch: ['\\byes\\b'] })).toEqual([])
  })

  it('catches formatting, stage directions, and stepping out of character', () => {
    expect(failed(checkReply(answer('**Yes.**')))).toContain('no markdown or lists')
    expect(failed(checkReply(answer('- First\n- Second')))).toContain('no markdown or lists')
    expect(failed(checkReply(answer('*pauses* Yes.')))).toContain('no stage directions')
    expect(failed(checkReply(answer('(sighs) Fine.')))).toContain('no stage directions')
    expect(failed(checkReply(answer("I'm an AI, so I can't say.")))).toContain('stays in character')
    expect(failed(checkReply(answer('Per my system prompt, no.')))).toContain('stays in character')
    expect(failed(checkReply(answer('The document says witness_knows="no".')))).toContain('no document labels')
    expect(failed(checkReply(answer('No.\nQ: Anything else?')))).toContain('does not write the next question')
  })

  it("doesn't mistake ordinary words for those problems", () => {
    expect(checkReply(answer("I don't know what a chatbot is. I'm Dana Lee."))).toEqual([])
    expect(checkReply(answer('I had maybe 2 or 3 people with phones out.'))).toEqual([])
  })

  it('enforces length and required or forbidden phrases', () => {
    expect(failed(checkReply(answer('one two three four'), { maxWords: 3 }))).toEqual(['short enough'])
    expect(failed(checkReply(answer('one'), { minWords: 3 }))).toEqual(['long enough'])
    expect(failed(checkReply(answer('It was Ana.'), { mustMatch: ['Sam'] }))).toEqual(['says what it must'])
    expect(failed(checkReply(answer('Back in 2013, I think.'), { mustNotMatch: ['2013'] }))).toEqual([
      "doesn't say what it mustn't",
    ])
  })

  it("checks whether the witness's lawyer objected, and how", () => {
    expect(failed(checkReply(answer('No.'), { objection: 'required' }))).toEqual(['lawyer objects'])
    expect(failed(checkReply(answer('No.', 'Objection, form.'), { objection: 'forbidden' }))).toEqual(['no objection'])
    expect(failed(checkReply(answer('No.', 'I think that is unfair.')))).toEqual(['objection format'])
    expect(failed(checkReply(answer('No.', 'Objection, form.'), { objectionMatch: 'privilege' }))).toEqual(['right objection'])
    expect(checkReply(answer("I'll follow my lawyer's advice.", 'Objection, privileged.'), { objection: 'required', objectionMatch: 'privilege' })).toEqual([])
  })
})

// The real cases live in the git-ignored .material/witnesses/; check any that are present are well formed.
const witnessesDir = new URL('../../../.material/witnesses/', import.meta.url)
const caseFiles = existsSync(witnessesDir)
  ? readdirSync(witnessesDir)
      .map((name) => new URL(`${name}/eval-cases.json`, witnessesDir))
      .filter((file) => existsSync(file))
  : []
describe.skipIf(caseFiles.length === 0)('eval cases', () => {
  it.each(caseFiles.map((file) => [file.pathname.split('/').at(-2)!, file]))('%s: unique ids, valid sides, regexes that compile', (_name, file) => {
    const cases = JSON.parse(readFileSync(file, 'utf8')) as EvalCase[]
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length)
    for (const c of cases) {
      expect(['plaintiff', 'defendant']).toContain(c.side)
      expect(c.question.length).toBeGreaterThan(0)
      expect(c.rubric.length).toBeGreaterThan(0)
      const patterns = [...(c.checks?.mustMatch ?? []), ...(c.checks?.mustNotMatch ?? []), c.checks?.objectionMatch ?? '']
      for (const p of patterns) expect(() => new RegExp(p, 'i')).not.toThrow()
    }
  })
})
