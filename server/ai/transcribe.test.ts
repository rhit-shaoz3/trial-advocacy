import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { modelFor } from './models.ts'
import { buildTranscribeRequest } from './transcribe.ts'

describe('buildTranscribeRequest', () => {
  it('reads the file with the transcription model, without thinking or caching', () => {
    const source: Anthropic.Messages.ContentBlockParam = {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0=' },
    }
    const request = buildTranscribeRequest('Ride log.pdf', source)

    expect(request.model).toBe(modelFor('transcribe'))
    expect(request).not.toHaveProperty('thinking')
    expect(request).not.toHaveProperty('output_config')
    const [file, text] = request.messages[0].content as Anthropic.Messages.ContentBlockParam[]
    expect(file).toBe(source)
    expect(file).not.toHaveProperty('cache_control')
    expect((text as Anthropic.Messages.TextBlockParam).text).toMatch(/^File name: Ride log\.pdf\n\nTranscribe this case file/)
  })
})
