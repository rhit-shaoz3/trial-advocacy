import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Investigation, MessageDraft, PlannerGap, PlannerGapTool, StudentExchange, StudentPart, WorkspaceWitness } from '../../courses/types'
import { ClientInbox } from '../client/ClientInbox'
import { InvestigatorPanel } from '../InvestigatorPanel'
import { ComposeModal, type ComposeContext, type ComposeKind } from './ComposeModal'
import { ToolActions } from './ToolActions'

// The planner's buttons open the regular forms, filled in from the gap and
// without "Check with AI"; their drafts land with the team's others.

const part = (over: Partial<StudentPart> = {}): StudentPart => ({ limit: 5, days: 14, used: 0, remaining: 5, requests: [], drafts: [], ...over })

const exchange = (over: Partial<StudentExchange> = {}): StudentExchange => ({
  phase: 'information_exchange',
  requestsOpen: true,
  side: 'plaintiff',
  teamNumber: 1,
  opponentNumber: 2,
  firm: { firm: 'Hale LLP', partner: 'M. Hale' },
  disclosures: null,
  subpoenas: null,
  interrogatories: part(),
  rfas: part(),
  ...over,
})

const gap: PlannerGap = {
  id: 'g1',
  cardId: null,
  description: 'Was the light working?',
  position: 0,
  tools: [],
  updatedBy: null,
  updatedAt: '2026-11-18T12:00:00Z',
}
const tool = (over: Partial<PlannerGapTool>): PlannerGapTool => ({
  tool: 'interrogatories',
  priority: 1,
  reason: 'Pins down who maintained it.',
  specifics: 'Identify everyone who inspected the light in June 2019.',
  witnessId: null,
  ...over,
})

const paige: WorkspaceWitness = { id: 'w1', name: 'Paige Winston', role: 'Plaintiff', description: '', side: 'plaintiff', canInterview: true, client: true }

const ctx = (over: Partial<ComposeContext> = {}): ComposeContext => ({
  exchange: exchange(),
  exchangeDrafts: { save: vi.fn(async (kind, _id, content) => ({ id: 'd1', kind, content, lastCheck: null, updatedAt: '2026-11-18T12:00:00Z', updatedBy: 'Ada' })), remove: vi.fn() },
  onSendRequest: vi.fn(async () => {}),
  onServeSubpoena: vi.fn(async () => {}),
  subpoenaForm: { caseId: 'k1', parties: { plaintiff: 'Winston', defendant: 'Thrillville' }, attorney: 'Ada Lawyer' },
  investigator: { name: 'John Hastings', limit: { max: 2, per: 'team' } },
  investigatorAvailable: true,
  investigations: [],
  onSendInvestigation: vi.fn(async () => {}),
  clients: [paige],
  clientEmails: [],
  clientEmailLimit: { max: 2, per: 'team' },
  onSendClientEmail: vi.fn(async () => {}),
  messageDraftActions: {
    save: vi.fn(async (kind, id, content) => ({ id: id ?? 'm1', kind, content, updatedAt: '2026-11-18T12:00:00Z', updatedBy: 'Ada Lawyer' })),
    remove: vi.fn(async () => {}),
  },
  teamName: 'Team 1',
  reviewLite: false,
  ...over,
})

const open = (kind: ComposeKind, c: ComposeContext, t = tool({})) => {
  const onClose = vi.fn()
  render(<ComposeModal kind={kind} gap={gap} tool={t} ctx={c} onClose={onClose} />)
  return { user: userEvent.setup(), onClose, dialog: screen.getByRole('dialog') }
}

describe('opening a form from the planner', () => {
  it('opens interrogatories filled in from the gap, without Check with AI, and sends them', async () => {
    const c = ctx()
    const { user, onClose, dialog } = open('interrogatories', c)
    expect(within(dialog).getByLabelText('Question 1')).toHaveValue('Identify everyone who inspected the light in June 2019.')
    expect(within(dialog).queryByRole('button', { name: /Check with AI/ })).not.toBeInTheDocument()
    expect(within(dialog).getByText(/4 of 5 left after sending/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Send to Team 2' }))
    await waitFor(() => expect(c.onSendRequest).toHaveBeenCalledWith('interrogatories', ['Identify everyone who inspected the light in June 2019.'], undefined, undefined))
    expect(onClose).toHaveBeenCalled()
  })

  it('saves the filled-in set as one of the team’s drafts', async () => {
    const c = ctx()
    const { user, dialog } = open('rfas', c, tool({ tool: 'rfas', specifics: 'Admit the light was red.' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save as draft' }))
    await waitFor(() => expect(c.exchangeDrafts!.save).toHaveBeenCalledWith('rfas', null, { items: ['Admit the light was red.'] }, null, undefined))
  })

  it('says why, as the regular page does, when the form can’t be used', () => {
    open('interrogatories', ctx({ exchange: exchange({ requestsOpen: false }) }))
    expect(screen.getByRole('status')).toHaveTextContent('Requests open in the information exchange phase.')
    expect(screen.queryByLabelText('Question 1')).not.toBeInTheDocument()
  })

  it('stops at the investigator’s limit, and while he’s on an assignment', () => {
    const sent = { id: 'i1', status: 'working', mine: true } as Investigation
    open('investigator', ctx({ investigations: [sent] }))
    expect(screen.getByRole('status')).toHaveTextContent('John Hastings is still on your last assignment.')
  })

  it('emails the investigator, or saves the email as a draft', async () => {
    const c = ctx()
    const { user, dialog } = open('investigator', c, tool({ tool: 'investigator', specifics: 'Find the maintenance tech.' }))
    expect(within(dialog).getByLabelText('Your assignment')).toHaveValue('Find the maintenance tech.')
    await user.click(within(dialog).getByRole('button', { name: 'Save as draft' }))
    await waitFor(() => expect(c.messageDraftActions!.save).toHaveBeenCalledWith('investigator', null, { assignment: 'Find the maintenance tech.' }))
  })

  it('emails the client, with the gap as the subject', async () => {
    const c = ctx()
    const { user, dialog } = open('client', c, tool({ tool: 'client', specifics: 'Do you have the ride photos?' }))
    const form = within(dialog).getByRole('form', { name: 'New email to your client' })
    expect(within(form).getByRole('checkbox', { name: 'Paige Winston' })).toBeChecked()
    expect(within(form).getByLabelText('Subject')).toHaveValue('Was the light working?')
    await user.click(within(form).getByRole('button', { name: 'Send' }))
    await waitFor(() =>
      expect(c.onSendClientEmail).toHaveBeenCalledWith({ to: ['w1'], subject: 'Was the light working?', body: 'Do you have the ride photos?' }),
    )
  })

  it('adds a witness’s question to the team’s tasks', async () => {
    const onCreateTask = vi.fn(async () => {})
    render(
      <ToolActions
        gap={gap}
        tool={tool({ tool: 'interview', witnessId: 'w1', specifics: 'Who else saw the light?' })}
        witnesses={[paige]}
        onCreateTask={onCreateTask}
      />,
    )
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add to your tasks' }))
    expect(onCreateTask).toHaveBeenCalledWith({ title: 'Ask Paige Winston: Who else saw the light?', witnessId: 'w1', gapId: 'g1' })
    expect(await screen.findByRole('status')).toHaveTextContent('Added to your tasks and to Paige Winston’s interview')
  })
})

describe('email drafts in the regular pages', () => {
  const draft = (over: Partial<MessageDraft>): MessageDraft => ({
    id: 'm1',
    kind: 'client_email',
    content: { to: ['w1'], subject: 'The photos', body: 'Do you have them?' },
    updatedAt: '2026-11-18T12:00:00Z',
    updatedBy: 'Bo Partner',
    ...over,
  })

  it('lists the client drafts in their own folder, and sends one', async () => {
    const onSend = vi.fn(async () => {})
    const user = userEvent.setup()
    render(
      <ClientInbox
        clients={[paige]}
        emails={[]}
        limit={{ max: 2, per: 'team' }}
        teamName="Team 1"
        downloadUrl={() => ''}
        onSend={onSend}
        drafts={[draft({}), draft({ id: 'm2', kind: 'investigator', content: { assignment: 'x' } })]}
        draftActions={{ save: vi.fn(), remove: vi.fn() }}
      />,
    )
    await user.click(screen.getByRole('tab', { name: /Drafts/ }))
    const item = screen.getByRole('button', { name: /The photos/ })
    expect(item).toHaveTextContent('Saved by Bo Partner')
    await user.click(item)
    const form = screen.getByRole('form', { name: 'New email to your client' })
    expect(within(form).getByLabelText('Your email')).toHaveValue('Do you have them?')
    await user.click(within(form).getByRole('button', { name: 'Send' }))
    expect(onSend).toHaveBeenCalledWith({ to: ['w1'], subject: 'The photos', body: 'Do you have them?', draftId: 'm1' })
  })

  it('lists the investigator drafts under his email, to open and send', async () => {
    const onSend = vi.fn(async () => {})
    const user = userEvent.setup()
    render(
      <InvestigatorPanel
        investigator={{ name: 'John Hastings', avatarUrl: '', limit: { max: 2, per: 'team' } }}
        available
        teamName="Team 1"
        investigations={[]}
        downloadUrl={() => ''}
        onSend={onSend}
        drafts={[draft({ id: 'm2', kind: 'investigator', content: { assignment: 'Find the maintenance tech.' } })]}
        draftActions={{ save: vi.fn(), remove: vi.fn() }}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Find the maintenance tech\./ }))
    expect(screen.getByLabelText('Your assignment')).toHaveValue('Find the maintenance tech.')
    await user.click(screen.getByRole('button', { name: 'Send to John Hastings' }))
    expect(onSend).toHaveBeenCalledWith('Find the maintenance tech.', 'm2')
  })
})
