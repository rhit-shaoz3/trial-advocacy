import type { DocumentDecision, FactDecision } from '../../courses/types'

export const DECISION_LABEL: Record<FactDecision, string> = {
  accept_world: 'Accept for this world',
  deny_world: 'Deny for this world',
  accept_case: 'Accept for all worlds',
  deny_case: 'Deny for all worlds',
}

export const DOCUMENT_LABEL: Record<DocumentDecision, string> = { allow: 'Allow', deny: "Don't allow" }

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
