import Anthropic from '@anthropic-ai/sdk'
import { mkdir, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { pool } from '../db/pool.ts'
import { loadAppWitness, witnessFolder } from './cliWitness.ts'
import { askWitness, WitnessRefusalError, type TranscriptTurn } from './deposition.ts'
import { depositionSettings } from './profile.ts'

/**
 * Depose an AI witness from the terminal, set up exactly as in the app (its
 * deposition, the files it has seen, the case's date and disputed issues).
 * Each line you type is a question; an empty line or "exit" ends the
 * deposition and saves the transcript under .material/witnesses/ (git-ignored).
 * Nothing is stored in the app.
 *
 *   npm run witness:chat -- --witness "Elena Torres" --side plaintiff --attorney "Mr. Kingston"
 *
 * --witness   the witness's name in the app
 * --side      which side the examining attorney represents: plaintiff (default) or defense
 * --attorney  the examining attorney's name (optional)
 */
const { values } = parseArgs({
  options: {
    witness: { type: 'string' },
    side: { type: 'string', default: 'plaintiff' },
    attorney: { type: 'string' },
  },
})
const side = values.side
if (side !== 'plaintiff' && side !== 'defense') throw new Error('--side must be plaintiff or defense')

const { witness, profile } = await loadAppWitness(values.witness)
const settings = { ...depositionSettings(profile, witness, side), examiningAttorneyName: values.attorney }

const client = new Anthropic()
const transcript: TranscriptTurn[] = []
const io = createInterface({ input: process.stdin, output: process.stdout })
console.log(`Deposing ${profile.name} for the ${side}. Empty line or "exit" to finish.\n`)

for (;;) {
  const question = (await io.question('Q: ')).trim()
  if (!question || question.toLowerCase() === 'exit') break
  try {
    const result = await askWitness(client, { profile, settings, transcript, question })
    if (result.objection) console.log(`\n${result.objection.speaker}: ${result.objection.text}`)
    console.log(`A: ${result.answer}\n`)
    const cached = result.usage.cache_read_input_tokens ?? 0
    console.log(`   (${result.model}; ${cached} cached / ${result.usage.input_tokens} uncached input tokens)\n`)
    transcript.push({ question, reply: result.reply })
  } catch (err) {
    if (err instanceof WitnessRefusalError || err instanceof Anthropic.APIError) console.error(`\n${err.message}\n`)
    else throw err
  }
}
io.close()
await pool.end()

if (transcript.length > 0) {
  const dir = new URL('transcripts/', witnessFolder(profile.name))
  await mkdir(dir, { recursive: true })
  const file = new URL(`${new Date().toISOString().replace(/[:.]/g, '-')}-${side}.txt`, dir)
  await writeFile(file, transcript.map((t) => `Q: ${t.question}\n${t.reply}\n`).join('\n'))
  console.log(`Saved the transcript to ${fileURLToPath(file)}`)
}
