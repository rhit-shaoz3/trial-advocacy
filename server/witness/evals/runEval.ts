import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { pool } from '../../db/pool.ts'
import { loadAppWitness, witnessFolder } from '../cliWitness.ts'
import { askWitness, WITNESS_MODEL, type WitnessReply } from '../deposition.ts'
import type { DepositionSettings, WitnessProfile } from '../prompt.ts'
import { checkReply, type CheckFailure, type EvalCase } from './checks.ts'

/**
 * Behavioral eval for an AI witness, set up as in the app: runs each
 * scripted case against the real model, then grades the reply with the rule
 * checks and a grader model. Every run calls the API and costs money (it
 * prints the cost at the end).
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

const GRADER_MODEL = 'claude-opus-5-5'
// Claude Opus 5.5 rates per million tokens: input, cache writes (5-minute, 1.25x), cache reads, output.
const PRICE = { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 }

const Verdict = z.object({
  pass: z.boolean(),
  reason: z.string(),
})

const client = new Anthropic()
let cost = 0
function addCost(usage: Anthropic.Beta.Messages.BetaUsage | Anthropic.Messages.Usage) {
  cost +=
    (usage.input_tokens * PRICE.input +
      (usage.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite +
      (usage.cache_read_input_tokens ?? 0) * PRICE.cacheRead +
      usage.output_tokens * PRICE.output) /
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
  addCost(response.usage)
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
  const settings: DepositionSettings = {
    examiningPartyRole: c.side,
    examiningPartyName: c.side === 'plaintiff' ? profile.plaintiffName : profile.defendantName,
    examiningAttorneyName: c.attorney,
    defendingCounselName: c.counsel,
  }
  const reply = await askWitness(client, {
    profile,
    settings,
    transcript: c.transcript ?? [],
    question: c.question,
    effort: values.effort as Parameters<typeof askWitness>[1]['effort'],
  })
  addCost(reply.usage)
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

const { profile } = await loadAppWitness(values.witness)
await pool.end()
const folder = witnessFolder(profile.name)
const allCases = JSON.parse(await readFile(new URL('eval-cases.json', folder), 'utf8')) as EvalCase[]
const cases = allCases.filter((c) => !values.case || c.id.includes(values.case))
const repeat = Math.max(1, Number(values.repeat))
if (cases.length === 0) throw new Error(`No case id contains "${values.case}"`)

console.log(`${profile.name}: ${cases.length} case(s) x ${repeat} on ${WITNESS_MODEL}${values.effort ? ` (effort ${values.effort})` : ''}\n`)
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
console.log(`\n${passed}/${results.length} passed. Cost: about $${cost.toFixed(2)}.`)

const dir = new URL('eval-results/', folder)
await mkdir(dir, { recursive: true })
const file = new URL(`${new Date().toISOString().replace(/[:.]/g, '-')}.json`, dir)
await writeFile(file, JSON.stringify({ model: WITNESS_MODEL, effort: values.effort ?? 'default', cost, results }, null, 2))
console.log(`Saved the results to ${fileURLToPath(file)}`)
if (passed < results.length) process.exitCode = 1
