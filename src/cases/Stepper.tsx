import { Check } from 'lucide-react'

const STEPS = ['Build teams', 'Set match-ups']

/** The two-step progress bar shown on the team and match-up builders. */
export function Stepper({ current }: { current: 1 | 2 }) {
  return (
    <ol className="case-stepper" aria-label="Progress">
      {STEPS.map((label, i) => {
        const step = i + 1
        const state = step < current ? 'done' : step === current ? 'current' : ''
        return (
          <li key={label} className={state} aria-current={step === current ? 'step' : undefined}>
            <span className="case-step-dot" aria-hidden>
              {step < current ? <Check size={14} /> : step}
            </span>
            {label}
          </li>
        )
      })}
    </ol>
  )
}
