import { FilePen, Mail, ScrollText, Search } from 'lucide-react'
import { Modal } from '../../components/Modal'
import type {
  CaseParties,
  ClientEmail,
  ClientEmailInput,
  ExchangeKind,
  InteractionLimit,
  Investigation,
  MessageDraftActions,
  PlannerGap,
  PlannerGapTool,
  StudentExchange,
  SubpoenaInput,
  WorkspaceWitness,
} from '../../courses/types'
import { ClientCompose } from '../client/ClientInbox'
import { RequestCompose } from '../exchange/RequestsSection'
import { SubpoenaCompose } from '../exchange/SubpoenasSection'
import type { DraftActions } from '../exchange/useDraft'
import { InvestigatorEmail } from '../InvestigatorPanel'
import '../exchange/exchange.css'
import '../client/clientInbox.css'

/** What the planner can open in a window: a set, a subpoena, or an email. */
export type ComposeKind = ExchangeKind | 'subpoena' | 'investigator' | 'client'

const OTHER_SIDE = { plaintiff: 'Defense', defense: 'Plaintiff' } as const

const TITLE: Record<ComposeKind, string> = {
  interrogatories: 'Draft interrogatories',
  rfas: 'Draft requests for admission',
  subpoena: 'Create the subpoena',
  investigator: 'Email the investigator',
  client: 'Email your client',
}

/** Everything the regular pages have, so the window is the same form with the same limits. */
export interface ComposeContext {
  exchange?: StudentExchange | null
  exchangeDrafts?: DraftActions
  onSendRequest?(kind: ExchangeKind, items: string[], checkId?: string, draftId?: string): Promise<void>
  onServeSubpoena?(subpoena: SubpoenaInput, checkId?: string, draftId?: string): Promise<void>
  subpoenaForm: { caseId: string; parties: CaseParties; attorney: string | null }
  investigator?: { name: string; limit?: InteractionLimit } | null
  investigatorAvailable: boolean
  investigations?: Investigation[]
  onSendInvestigation?(assignment: string, draftId?: string): Promise<void>
  clients: WorkspaceWitness[]
  clientEmails?: ClientEmail[]
  clientEmailLimit?: InteractionLimit
  onSendClientEmail?(email: ClientEmailInput): Promise<void>
  messageDraftActions?: MessageDraftActions
  teamName: string | null
  reviewLite: boolean
}

/** What's in the gap's tool, to start the form with: its specifics, else what's missing. */
const ask = (gap: PlannerGap, tool: PlannerGapTool) => (tool.specifics.trim() || gap.description.trim()).slice(0, 1000)

/** Why the form can't be used now, as the regular page says it; null when it can. */
function blocked(kind: ComposeKind, ctx: ComposeContext): string | null {
  if (!ctx.teamName) return 'Your team can do this once it’s in a case world.'
  if (kind === 'interrogatories' || kind === 'rfas' || kind === 'subpoena') {
    const part = kind === 'subpoena' ? ctx.exchange?.subpoenas : ctx.exchange?.[kind]
    if (!ctx.exchange || !part) return 'This case doesn’t include that kind of request.'
    if (!ctx.exchange.requestsOpen) return 'Requests open in the information exchange phase.'
    if (part.remaining <= 0) return 'Your team has used all it’s allowed of these.'
    return null
  }
  if (kind === 'investigator') {
    const inv = ctx.investigator
    if (!inv) return 'This case has no background investigator.'
    if (!ctx.investigatorAvailable) return `${inv.name} becomes available in the investigate phase.`
    if (ctx.investigations?.some((i) => i.status === 'working')) return `${inv.name} is still on your last assignment. You can send the next one when his report is back.`
    const limit = inv.limit
    const used = limit && ctx.investigations ? ctx.investigations.filter((i) => limit.per === 'team' || i.mine).length : 0
    if (limit && used >= limit.max) return `${limit.per === 'student' ? 'You’ve' : 'Your team has'} used all the requests your instructor allows.`
    return null
  }
  if (ctx.clients.length === 0) return 'Your side has no client to email in this case.'
  if (ctx.clientEmails?.some((e) => e.status === 'working')) return 'Wait for the reply to your last email first.'
  const limit = ctx.clientEmailLimit
  const used = limit && ctx.clientEmails ? ctx.clientEmails.filter((e) => limit.per === 'team' || e.mine).length : 0
  if (limit && used >= limit.max) return `${limit.per === 'student' ? 'You’ve' : 'Your team has'} used all the emails your instructor allows.`
  return null
}

/**
 * One of the regular forms, opened from a gap's tool in the planner and
 * started from what the team wrote there. It's the same form, with the same
 * limits, but without "Check with AI": the planner's feedback came first.
 * Saving it as a draft puts it with the team's other drafts.
 */
export function ComposeModal({
  kind,
  gap,
  tool,
  ctx,
  onClose,
}: {
  kind: ComposeKind
  gap: PlannerGap
  tool: PlannerGapTool
  ctx: ComposeContext
  onClose(): void
}) {
  const reason = blocked(kind, ctx)
  const icon = kind === 'investigator' ? <Search /> : kind === 'client' ? <Mail /> : kind === 'subpoena' ? <ScrollText /> : <FilePen />
  const exchange = ctx.exchange
  let form = null
  if (!reason && (kind === 'interrogatories' || kind === 'rfas') && exchange && exchange[kind] && ctx.onSendRequest) {
    const send = ctx.onSendRequest
    form = (
      <RequestCompose
        kind={kind}
        part={exchange[kind]!}
        to={`Team ${exchange.opponentNumber} (${OTHER_SIDE[exchange.side]})`}
        prefill={[ask(gap, tool)]}
        actions={ctx.exchangeDrafts}
        rounds={null}
        onSend={async (items, checkId, draftId) => {
          await send(kind, items, checkId, draftId)
          onClose()
        }}
        onBack={onClose}
      />
    )
  } else if (!reason && kind === 'subpoena' && exchange?.subpoenas && ctx.onServeSubpoena) {
    const serve = ctx.onServeSubpoena
    form = (
      <SubpoenaCompose
        part={exchange.subpoenas}
        form={{ ...ctx.subpoenaForm, side: exchange.side, firm: exchange.firm }}
        prefill={{ records: ask(gap, tool), justification: tool.reason.trim() }}
        actions={ctx.exchangeDrafts}
        onServe={async (subpoena, checkId, draftId) => {
          await serve(subpoena, checkId, draftId)
          onClose()
        }}
        onBack={onClose}
      />
    )
  } else if (!reason && kind === 'investigator' && ctx.investigator && ctx.onSendInvestigation && ctx.teamName) {
    const send = ctx.onSendInvestigation
    form = (
      <InvestigatorEmail
        name={ctx.investigator.name}
        teamName={ctx.teamName}
        prefill={ask(gap, tool)}
        draftActions={ctx.messageDraftActions}
        reviewLite={ctx.reviewLite}
        onSend={async (assignment, draftId) => {
          await send(assignment, draftId)
          onClose()
        }}
        onDraftSaved={onClose}
      />
    )
  } else if (!reason && kind === 'client' && ctx.onSendClientEmail && ctx.teamName) {
    const send = ctx.onSendClientEmail
    form = (
      <ClientCompose
        clients={ctx.clients}
        initialTo={ctx.clients.map((c) => c.id)}
        prefill={{ subject: gap.description.trim().slice(0, 200), body: ask(gap, tool) }}
        teamName={ctx.teamName}
        reviewLite={ctx.reviewLite}
        draftActions={ctx.messageDraftActions}
        onSend={async (email) => {
          await send(email)
          onClose()
        }}
        onDraftSaved={onClose}
        onCancel={onClose}
      />
    )
  }
  return (
    // Only the subpoena form itself needs the full-height window; a line saying why it can't be used doesn't.
    <Modal eyebrow="From your planner" title={TITLE[kind]} icon={icon} wide={kind === 'subpoena' && form !== null} onClose={onClose}>
      <div className="pl-compose">
        {reason ? (
          <p className="pl-compose-blocked" role="status">
            {reason}
          </p>
        ) : (
          (form ?? <p className="pl-compose-blocked">This can’t be sent from here.</p>)
        )}
      </div>
    </Modal>
  )
}

