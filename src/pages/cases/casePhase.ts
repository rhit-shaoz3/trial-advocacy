import type { CasePhase } from '../../courses/types'

export { PHASE_LABEL } from '../../courses/caseLabels'

/** What the phase means for every team, shown to the instructor. */
export const PHASE_HINT: Record<CasePhase, string> = {
  introduction:
    "Teams have the case and their side's witnesses. With information exchange set up, they also have the welcome email, and each student picks their initial disclosures.",
  information_exchange:
    'Your initial disclosures are shared with both sides. Teams send each other interrogatories and requests for admission.',
  investigate: "Teams can use the background investigator. The other side's witnesses can't be interviewed yet.",
  deposition: 'Every witness is revealed to both sides and can be deposed.',
}

/** Asked before moving to `phase`; it applies to every case world at once. */
export const PHASE_CONFIRM: Record<CasePhase, string> = {
  introduction:
    "Move every case world back to the introduction phase? Teams lose the other side's witnesses, and your disclosed files go back to their side.",
  information_exchange: 'Move every case world to the information exchange phase?',
  investigate:
    "Move every case world to the investigate phase? Teams get the background investigator, and the other side's witnesses stay closed to interviews.",
  deposition:
    'Move every case world to the deposition phase? This reveals every witness to both sides, and teams can depose them.',
}

/** The hint and confirmation for a phase. */
export function phaseText(phase: CasePhase) {
  return { hint: PHASE_HINT[phase], confirm: PHASE_CONFIRM[phase] }
}
