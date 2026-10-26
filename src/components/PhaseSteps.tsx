import { PHASE_LABEL } from '../courses/caseLabels'
import type { CasePhase } from '../courses/types'
import './PhaseSteps.css'

/**
 * A case's phases in order, with the ones done, the current one, and the ones
 * still to come marked. `onBrand` is for a dark (navy) background.
 */
export function PhaseSteps({ phase, phases, onBrand = false }: { phase: CasePhase; phases: CasePhase[]; onBrand?: boolean }) {
  const current = phases.indexOf(phase)
  return (
    <ol
      className={onBrand ? 'ws-phases ws-phases-on-brand' : 'ws-phases'}
      aria-label={`Phase ${current + 1} of ${phases.length}: ${PHASE_LABEL[phase]}`}
    >
      {phases.map((p, i) => (
        <li
          key={p}
          className={i < current ? 'ws-phase-done' : i === current ? 'ws-phase-current' : undefined}
          aria-current={i === current ? 'step' : undefined}
        >
          {PHASE_LABEL[p]}
        </li>
      ))}
    </ol>
  )
}
