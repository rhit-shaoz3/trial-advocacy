import type { CasePhase } from '../../courses/types'

export { PHASE_LABEL } from '../../courses/caseLabels'

/** What the phase means for every team, shown to the instructor. */
export const PHASE_HINT: Record<CasePhase, string> = {
  subpoena: "Teams see only their own side's witnesses. No background investigator yet.",
  investigate: "Teams can use the background investigator. The other side's witnesses stay hidden.",
  deposition: 'Every witness is revealed to both sides and can be deposed.',
}

/** Asked before moving to `phase`; it applies to every case world at once. */
export const PHASE_CONFIRM: Record<CasePhase, string> = {
  subpoena:
    "Move every case world back to the subpoena phase? Teams lose the investigator and the other side's witnesses.",
  investigate:
    "Move every case world to the investigate phase? Teams get the background investigator, and the other side's witnesses are hidden.",
  deposition:
    'Move every case world to the deposition phase? This reveals every witness to both sides, and teams can depose them.',
}
