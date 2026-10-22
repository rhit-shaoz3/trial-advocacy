// Which Claude model each AI step uses. Set CLAUDE_MODEL (in .env.local, or
// as a Heroku config var) to change every step at once, or a step's own
// variable to change just that one. Read on each call; restart the server
// after editing .env.local.

export const DEFAULT_MODEL = 'claude-haiku-5-5'

export type AiStep = 'witness' | 'transcribe' | 'review' | 'eval'

const STEP_VARIABLE: Record<AiStep, string> = {
  witness: 'CLAUDE_WITNESS_MODEL',
  transcribe: 'CLAUDE_TRANSCRIBE_MODEL',
  review: 'CLAUDE_REVIEW_MODEL',
  eval: 'CLAUDE_EVAL_MODEL',
}

/** The step's own setting, else CLAUDE_MODEL, else the default (Haiku). */
export function modelFor(step: AiStep, env: NodeJS.ProcessEnv = process.env): string {
  return env[STEP_VARIABLE[step]]?.trim() || env.CLAUDE_MODEL?.trim() || DEFAULT_MODEL
}
