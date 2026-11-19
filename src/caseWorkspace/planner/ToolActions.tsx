import { useState } from 'react'
import { Check, ClipboardList, FilePen, Mail, ScrollText, Search } from 'lucide-react'
import type { PlannerGap, PlannerGapTool, WorkspaceWitness } from '../../courses/types'
import type { ComposeKind } from './ComposeModal'

const COMPOSE: Partial<Record<PlannerGapTool['tool'], { kind: ComposeKind; label: string; icon: typeof Mail }>> = {
  interrogatories: { kind: 'interrogatories', label: 'Draft as interrogatories', icon: FilePen },
  rfas: { kind: 'rfas', label: 'Draft as requests for admission', icon: FilePen },
  subpoena: { kind: 'subpoena', label: 'Create the subpoena', icon: ScrollText },
  client: { kind: 'client', label: 'Email your client', icon: Mail },
  investigator: { kind: 'investigator', label: 'Email the investigator', icon: Search },
}

/**
 * What a team can do with one of a gap's tools, right from the planner: open
 * the request or email it means, filled in from the gap, or (for a witness)
 * add the question to the team's tasks, where it shows on that witness's
 * interview too.
 */
export function ToolActions({
  gap,
  tool,
  witnesses,
  onCompose,
  onCreateTask,
}: {
  gap: PlannerGap
  tool: PlannerGapTool
  witnesses: Pick<WorkspaceWitness, 'id' | 'name'>[]
  onCompose?(kind: ComposeKind): void
  onCreateTask?(task: { title: string; witnessId: string | null; gapId: string }): Promise<void>
}) {
  const [added, setAdded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const compose = COMPOSE[tool.tool]
  if (compose && onCompose) {
    const Icon = compose.icon
    return (
      <button type="button" className="ws-btn" onClick={() => onCompose(compose.kind)}>
        <Icon aria-hidden="true" />
        {compose.label}
      </button>
    )
  }
  if ((tool.tool === 'interview' || tool.tool === 'deposition') && onCreateTask) {
    const witness = witnesses.find((w) => w.id === tool.witnessId)
    const what = (tool.specifics.trim() || gap.description.trim()).slice(0, 400)
    const title = `${tool.tool === 'deposition' ? 'Depose' : 'Ask'} ${witness?.name ?? 'a witness'}: ${what}`
    if (added) {
      return (
        <span className="pl-added" role="status">
          <Check aria-hidden="true" />
          Added to your tasks{witness ? ` and to ${witness.name}’s interview` : ''}
        </span>
      )
    }
    return (
      <>
        <button
          type="button"
          className="ws-btn"
          disabled={busy || !what}
          title={what ? undefined : 'Write the specifics first.'}
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              await onCreateTask({ title, witnessId: witness?.id ?? null, gapId: gap.id })
              setAdded(true)
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Something went wrong.')
            } finally {
              setBusy(false)
            }
          }}
        >
          <ClipboardList aria-hidden="true" />
          Add to your tasks
        </button>
        {error && (
          <span className="pl-error" role="alert">
            {error}
          </span>
        )}
      </>
    )
  }
  return null
}
