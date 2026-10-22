import Anthropic from '@anthropic-ai/sdk'
import { modelFor } from './models.ts'

/** Largest file sent to Claude inline (base64 grows it by a third; requests cap at 32 MB). */
export const MAX_TRANSCRIBE_BYTES = 23 * 1024 * 1024

export interface FileToTranscribe {
  filename: string
  contentType: string
  data: Buffer
}

export class TranscriptionError extends Error {}

const INSTRUCTIONS = `Transcribe this case file into plain text for a legal training app. AI witnesses will read your transcription instead of the file, so it must be faithful.

- Keep every word, name, number, date, and line of testimony exactly as written. Don't summarize, correct, reorder, or add commentary.
- Leave out page numbers, the line numbers in a transcript's margin, and headers or footers repeated on every page.
- Write each table row on its own line, with the columns separated by " | " in their original order, and write an empty cell as "-". Read rows by where values sit on the page: each value goes in the row it is printed on, level with the other values beside it.
- Never fix a document. If a table looks inconsistent (a value with nothing else on its line, dates in a column that says FALSE, rows that seem shifted), transcribe it exactly as printed anyway; in a legal case, errors in a record can be evidence.
- For a photograph, diagram, or screenshot, write a short factual description in square brackets, such as [Photo: ...], including any visible text. In a chat or text-message screenshot, give each message on its own line, labelled with who sent it if the screenshot shows that.
- Output only the transcription, with no introduction.`

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const

/**
 * The request for one file. No thinking: copying a file out word for word
 * doesn't need reasoning, and thinking is billed as output. No caching
 * either, since each file is read once.
 */
export function buildTranscribeRequest(
  filename: string,
  source: Anthropic.Messages.ContentBlockParam,
): Anthropic.Messages.MessageStreamParams {
  return {
    model: modelFor('transcribe'),
    max_tokens: 64000,
    messages: [{ role: 'user', content: [source, { type: 'text', text: `File name: ${filename}\n\n${INSTRUCTIONS}` }] }],
  }
}

/**
 * Text files are used as they are; PDFs and images are transcribed by Claude.
 * Audio and video aren't supported yet (returns null: nothing to read).
 */
export async function transcribeFile(client: Anthropic, file: FileToTranscribe): Promise<string | null> {
  if (file.contentType.startsWith('text/')) return file.data.toString('utf8').trim()

  let source: Anthropic.Messages.ContentBlockParam
  if (file.contentType === 'application/pdf') {
    source = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.data.toString('base64') } }
  } else if ((IMAGE_TYPES as readonly string[]).includes(file.contentType)) {
    source = {
      type: 'image',
      source: { type: 'base64', media_type: file.contentType as (typeof IMAGE_TYPES)[number], data: file.data.toString('base64') },
    }
  } else {
    return null
  }
  if (file.data.length > MAX_TRANSCRIBE_BYTES) {
    throw new TranscriptionError(`The file is too large to read (over ${MAX_TRANSCRIBE_BYTES / (1024 * 1024)} MB). Split it into smaller files.`)
  }

  // Transcriptions can be long, so stream to stay clear of request timeouts.
  const message = await client.messages.stream(buildTranscribeRequest(file.filename, source)).finalMessage()

  if (message.stop_reason === 'refusal') throw new TranscriptionError('Claude declined to read this file.')
  if (message.stop_reason === 'max_tokens') throw new TranscriptionError('The file is too long to read in one go. Split it into smaller files.')
  const text = message.content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim()
  if (!text) throw new TranscriptionError('No text could be read from this file.')
  return text
}
