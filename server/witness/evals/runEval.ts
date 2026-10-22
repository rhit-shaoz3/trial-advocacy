import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { pool } from '../../db/pool.ts'
import { loadAppWitness, witnessFolder } from '../cliWitness.ts'
import { modelFor } from '../../ai/models.ts'
import { askWitness, WITNESS_EFFORT, type WitnessReply } from '../deposition.ts'
import { depositionSettings } from '../profile.ts'
import type { DepositionSettings, WitnessProfile } from '../prompt.ts'
import { checkReply, type CheckFailure, type EvalCase } from './checks.ts'

/**
 * Behavioral eval for an AI witness, set up as in the app: runs each
 * scripted case against the real model, then grades the reply with the rule
 * checks and a grader model. Every run calls the API and costs money (it
 * prints an estimated cost and the tokens used at the end). The witness uses CLAUDE_WITNESS_MODEL
 * (or CLAUDE_MODEL); the grader uses CLAUDE_EVAL_MODEL (or CLAUDE_MODEL).
 *
 *   npm run witness:eval -- --witness "Elena Torres"                 every case once
 *   npm run witness:eval -- --witness "Elena Torres" --case alcohol  only ids containing "alcohol"
 *   npm run witness:eval -- --witness "Elena Torres" --repeat 3      each case 3 times (answers vary)
 *   npm run witness:eval -- --witness "Elena Torres" --effort low    try a different witness effort
 *
 * Cases come from .material/witnesses/<name>/eval-cases.json; results are
 * saved next to it (both git-ignored). Exits non-zero if any case fails.
 */
const { values } = parseArgs({
  options: {
    witness: { type: 'string' },
    case: { type: 'string' },
    repeat: { type: 'string', default: '1' },
    effort: { type: 'string' },
  },
})

const WITNESS_MODEL = modelFor('witness')
const GRADER_MODEL = modelFor('eval')

/** Rates per million tokens: input, cache writes (5-minute, 1.25x), cache reads (0.1x), output. */
const rates = (input: number, output: number) => ({ input, cacheWrite: input * 1.25, cacheRead: input * 0.1, output })
/** Haiku has two rate cards, chosen by how long the prompt is. */
function priceFor(model: string, promptTokens: number) {
  if (model.startsWith('claude-haiku-5-5')) return promptTokens > 100_000 ? rates(0.5, 2.5) : rates(0.1, 0.5)
  if (model.startsWith('claude-sonnet-5-5')) return rates(2, 10)
  return rates(4, 20) // Claude Opus 5.5, and the default guess for anything else
}

const Verdict = z.object({
  pass: z.boolean(),
  reason: z.string(),
})

const client = new Anthropic()
// An estimated cost (from the rates above) and the raw token totals, across the run.
let cost = 0
const tokens = { input: 0, cacheWrites: 0, cacheReads: 0, output: 0 }
function addCost(model: string, usage: Anthropic.Beta.Messages.BetaUsage | Anthropic.Messages.Usage) {
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0
  tokens.input += usage.input_tokens
  tokens.cacheWrites += cacheWrite
  tokens.cacheReads += cacheRead
  tokens.output += usage.output_tokens
  const price = priceFor(model, usage.input_tokens + cacheWrite + cacheRead)
  cost +=
    (usage.input_tokens * price.input +
      cacheWrite * price.cacheWrite +
      cacheRead * price.cacheRead +
      usage.output_tokens * price.output) /
    1_000_000
}

async function grade(profile: WitnessProfile, c: EvalCase, reply: WitnessReply) {
  const transcript = [...(c.transcript ?? []).map((t) => `Q: ${t.question}\n${t.reply}`), `Q: ${c.question}\n${reply.reply}`]
  const response = await client.messages.parse({
    model: GRADER_MODEL,
    max_tokens: 4000,
    system:
      'You grade an AI playing a deposition witness in a law-school training simulation. ' +
      'You are given the rubric for one moment in the deposition and the transcript up to and including the reply being graded. ' +
      'Grade only the final reply. Pass it only if it meets every requirement in the rubric. ' +
      'Judge the substance, not the exact wording: a real witness may phrase things many ways. ' +
      'Give a one- or two-sentence reason.',
    messages: [
      {
        role: 'user',
        content:
          `Witness: ${profile.name}, a witness for the ${profile.alignedPartyRole}. ` +
          `The examining attorney represents the ${c.side}.\n\n` +
          `<rubric>\n${c.rubric}\n</rubric>\n\n<transcript>\n${transcript.join('\n\n')}\n</transcript>`,
      },
    ],
    output_config: { format: zodOutputFormat(Verdict) },
  })
  addCost(GRADER_MODEL, response.usage)
  if (!response.parsed_output) throw new Error(`The grader returned no verdict for ${c.id}`)
  return response.parsed_output
}

interface Result {
  id: string
  run: number
  question: string
  reply: string
  model: string
  ruleFailures: CheckFailure[]
  grader: { pass: boolean; reason: string }
  pass: boolean
}

async function runCase(profile: WitnessProfile, c: EvalCase, run: number): Promise<Result> {
  // As in the app: the witness's own lawyer is there (the case's, or the witness's, or the default).
  const app = depositionSettings(profile, witness, c.side === 'plaintiff' ? 'plaintiff' : 'defense')
  const settings: DepositionSettings = {
    ...app,
    examiningAttorneyName: c.attorney,
    defendingCounselName: c.counsel ?? app.defendingCounselName,
  }
  const reply = await askWitness(client, {
    profile,
    settings,
    transcript: c.transcript ?? [],
    question: c.question,
    effort: values.effort as Parameters<typeof askWitness>[1]['effort'],
  })
  addCost(reply.model, reply.usage)
  const ruleFailures = checkReply(reply, c.checks)
  const grader = await grade(profile, c, reply)
  return {
    id: c.id,
    run,
    question: c.question,
    reply: reply.reply,
    model: reply.model,
    ruleFailures,
    grader,
    pass: ruleFailures.length === 0 && grader.pass,
  }
}

const { profile, witness } = await loadAppWitness(values.witness)
await pool.end()
const folder = witnessFolder(profile.name)
const allCases = JSON.parse(await readFile(new URL('eval-cases.json', folder), 'utf8')) as EvalCase[]
const cases = allCases.filter((c) => !values.case || c.id.includes(values.case))
const repeat = Math.max(1, Number(values.repeat))
if (cases.length === 0) throw new Error(`No case id contains "${values.case}"`)

console.log(`${profile.name}: ${cases.length} case(s) x ${repeat} on ${WITNESS_MODEL} (effort ${values.effort ?? WITNESS_EFFORT})\n`)
const jobs = Array.from({ length: repeat }, (_, run) => cases.map((c) => ({ c, run }))).flat()

// The first call writes the cached system prompt; the rest read it, a few at a time.
const results: Result[] = []
const runJob = async ({ c, run }: { c: EvalCase; run: number }) => {
  const result = await runCase(profile, c, run)
  results.push(result)
  const mark = result.pass ? 'PASS' : 'FAIL'
  console.log(`${mark}  ${c.id}${repeat > 1 ? ` #${run + 1}` : ''}  ${c.title}`)
  if (!result.pass) {
    console.log(`      Q: ${c.question}`)
    console.log(`      ${result.reply.replace(/\n/g, '\n      ')}`)
    for (const f of result.ruleFailures) console.log(`      - ${f.check}: ${f.detail}`)
    if (!result.grader.pass) console.log(`      - grader: ${result.grader.reason}`)
  }
}
await runJob(jobs[0])
const queue = jobs.slice(1)
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) await runJob(job)
  }),
)

const passed = results.filter((r) => r.pass).length
console.log(
  `\n${passed}/${results.length} passed. Cost: about $${cost.toFixed(2)}. Tokens: ${tokens.input} input, ` +
    `${tokens.cacheWrites} cache writes, ${tokens.cacheReads} cache reads, ${tokens.output} output.`,
)

const dir = new URL('eval-results/', folder)
await mkdir(dir, { recursive: true })
const file = new URL(`${new Date().toISOString().replace(/[:.]/g, '-')}.json`, dir)
await writeFile(
  file,
  JSON.stringify(
    { model: WITNESS_MODEL, grader: GRADER_MODEL, effort: values.effort ?? WITNESS_EFFORT, cost, tokens, results },
    null,
    2,
  ),
)
console.log(`Saved the results to ${fileURLToPath(file)}`)
if (passed < results.length) process.exitCode = 1
