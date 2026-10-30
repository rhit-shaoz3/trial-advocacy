import { describe, expect, it } from 'vitest'
import { DEFAULT_MODEL, modelFor } from './models.ts'

describe('modelFor', () => {
  it('uses Haiku unless a setting says otherwise', () => {
    expect(DEFAULT_MODEL).toBe('claude-haiku-5-5')
    expect(modelFor('witness', {})).toBe('claude-haiku-5-5')
    expect(modelFor('transcribe', { CLAUDE_MODEL: '  ' })).toBe('claude-haiku-5-5')
  })

  it('uses CLAUDE_MODEL for every step, and a step setting for just that step', () => {
    const env = { CLAUDE_MODEL: 'claude-sonnet-5-5', CLAUDE_WITNESS_MODEL: 'claude-opus-5-5' }
    expect(modelFor('witness', env)).toBe('claude-opus-5-5')
    expect(modelFor('transcribe', env)).toBe('claude-sonnet-5-5')
    expect(modelFor('review', env)).toBe('claude-sonnet-5-5')
    expect(modelFor('eval', { CLAUDE_EVAL_MODEL: 'claude-opus-5-5' })).toBe('claude-opus-5-5')
    // The witness also accepts the older WITNESS_MODEL name; its own CLAUDE_ name wins.
    expect(modelFor('witness', { WITNESS_MODEL: 'claude-sonnet-5-5', CLAUDE_MODEL: 'claude-haiku-5-5' })).toBe('claude-sonnet-5-5')
    expect(modelFor('witness', { WITNESS_MODEL: 'claude-sonnet-5-5', CLAUDE_WITNESS_MODEL: 'claude-opus-5-5' })).toBe('claude-opus-5-5')
    expect(modelFor('review', { WITNESS_MODEL: 'claude-sonnet-5-5' })).toBe('claude-haiku-5-5')
  })

  it('uses Sonnet for the discovery mentor, whatever CLAUDE_MODEL says, unless its own setting does', () => {
    expect(modelFor('mentor', {})).toBe('claude-sonnet-5-5')
    expect(modelFor('mentor', { CLAUDE_MODEL: 'claude-haiku-5-5' })).toBe('claude-sonnet-5-5')
    expect(modelFor('mentor', { CLAUDE_MENTOR_MODEL: 'claude-opus-5-5' })).toBe('claude-opus-5-5')
  })
})
