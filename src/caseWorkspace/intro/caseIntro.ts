import { DEFAULT_INVESTIGATOR_NAME, INVESTIGATOR_AVATAR_URL, type CaseWorkspace, type CasePhase, type StudentExchange } from '../../courses/types'

// The short animated welcome a student gets each time the case enters a
// phase: the welcome email flying in when the case launches, then one for each
// phase that opens something new (again if the case moves back and forth). Each says only what the
// instructor has turned on; a phase with nothing on gets none.

export type ExchangePart = 'interrogatories' | 'rfas' | 'subpoenas'

export type CaseIntro =
  | { kind: 'launch' }
  | { kind: 'information_exchange'; parts: ExchangePart[] }
  | { kind: 'investigate'; investigator: { name: string; avatarUrl: string } }
  | { kind: 'deposition'; witnesses: { id: string; name: string; role: string; avatarUrl: string | null }[] }
  /** `judging`: the instructor rules on the challenges teams keep (otherwise the judge does, at trial). */
  | { kind: 'final_steps'; judging: boolean }

/**
 * Recorded with the guided tours (users.tours_seen): one per student each time
 * the case enters a phase, so moving back to a phase welcomes them again.
 */
export const introKey = (caseId: string, phase: CasePhase, enteredAt?: string | null) =>
  `intro:${caseId}:${phase}:${enteredAt ? Date.parse(enteredAt) : 'start'}`

/** The intro for the case's phase, from what this case has turned on; null when there's nothing to show. */
export function pickIntro(workspace: CaseWorkspace, exchange: StudentExchange | null): CaseIntro | null {
  switch (workspace.case.phase) {
    case 'introduction':
      return { kind: 'launch' }
    case 'information_exchange': {
      const parts: ExchangePart[] = []
      if (exchange?.interrogatories) parts.push('interrogatories')
      if (exchange?.rfas) parts.push('rfas')
      if (exchange?.subpoenas) parts.push('subpoenas')
      return parts.length ? { kind: 'information_exchange', parts } : null
    }
    case 'investigate': {
      // Cases from before the investigator setting have him; null means this case has none.
      const investigator =
        workspace.investigator === undefined ? { name: DEFAULT_INVESTIGATOR_NAME, avatarUrl: INVESTIGATOR_AVATAR_URL } : workspace.investigator
      return investigator && workspace.investigatorAvailable ? { kind: 'investigate', investigator } : null
    }
    case 'deposition': {
      // The other side's witnesses the team can depose now.
      const witnesses = workspace.witnesses
        .filter((w) => w.canInterview && w.side !== null && workspace.side !== null && w.side !== workspace.side)
        .map((w) => ({ id: w.id, name: w.name, role: w.role, avatarUrl: w.avatarUrl ?? null }))
      return witnesses.length ? { kind: 'deposition', witnesses } : null
    }
    case 'final_steps':
      return workspace.exhibitListEnabled === false ? null : { kind: 'final_steps', judging: workspace.exhibitJudicialReview !== false }
  }
}
