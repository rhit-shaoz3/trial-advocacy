// Which Claude model each AI step uses. Set CLAUDE_MODEL (in .env.local, or
// as a Heroku config var) to change every step at once, or a step's own
// variable to change just that one. Read on each call; restart the server
// after editing .env.local.

export const DEFAULT_MODEL = 'claude-haiku-5-5'

export type AiStep = 'witness' | 'investigator' | 'subpoena' | 'mentor' | 'transcribe' | 'review' | 'setup' | 'eval'

const STEP_VARIABLE: Record<AiStep, string> = {
  witness: 'CLAUDE_WITNESS_MODEL',
  investigator: 'CLAUDE_INVESTIGATOR_MODEL',
  subpoena: 'CLAUDE_SUBPOENA_MODEL',
  mentor: 'CLAUDE_MENTOR_MODEL',
  transcribe: 'CLAUDE_TRANSCRIBE_MODEL',
  review: 'CLAUDE_REVIEW_MODEL',
  setup: 'CLAUDE_SETUP_MODEL',
  eval: 'CLAUDE_EVAL_MODEL',
}

/**
 * Steps that use their own model unless their own variable says otherwise,
 * whatever CLAUDE_MODEL is: the discovery mentor needs Sonnet to keep its
 * feedback in proportion (Haiku quibbles over wording students can't improve).
 */
const STEP_DEFAULT: Partial<Record<AiStep, string>> = {
  mentor: 'claude-sonnet-5-5',
}

/**
 * The step's own setting, else the step's own default (the mentor's Sonnet),
 * else CLAUDE_MODEL, else the default (Haiku). For the witness, WITNESS_MODEL
 * (the older name) also works.
 */
export function modelFor(step: AiStep, env: NodeJS.ProcessEnv = process.env): string {
  const own = env[STEP_VARIABLE[step]]?.trim() || (step === 'witness' ? env.WITNESS_MODEL?.trim() : '')
  return own || STEP_DEFAULT[step] || env.CLAUDE_MODEL?.trim() || DEFAULT_MODEL
}
