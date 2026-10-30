import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DiscoveryDraft, DraftContent, DraftKind, KeyedCheck, StudentExchange, StudentPart } from '../../courses/types'
import { ExchangePanel } from './ExchangePanel'
import type { DraftActions } from './useDraft'

const now = new Date('2026-11-01T12:00:00Z')

const part = (overrides: Partial<StudentPart> = {}): StudentPart => ({ limit: 5, days: 14, used: 0, remaining: 5, requests: [], drafts: [], ...overrides })

const exchange = (overrides: Partial<StudentExchange> = {}): StudentExchange => ({
  phase: 'information_exchange',
  requestsOpen: true,
  side: 'plaintiff',
  teamNumber: 1,
  opponentNumber: 2,
  firm: { firm: 'Hale & Whitford LLP', partner: 'Margaret Hale' },
  disclosures: null,
  subpoenas: { types: ['documents'], limit: 3, days: 14, used: 0, remaining: 3, served: [], notices: [], drafts: [] },
  interrogatories: part(),
  rfas: null,
  ...overrides,
})

const draft = (kind: DraftKind, content: DraftContent, lastCheck: KeyedCheck | null = null): DiscoveryDraft => ({
  id: 'd1',
  kind,
  content,
  lastCheck,
  updatedAt: '2026-10-31T15:00:00Z',
  updatedBy: 'Bo Brief',
})

function actions(): DraftActions & { save: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> } {
  return {
    save: vi.fn(async (kind: DraftKind, id: string | null, content: DraftContent, lastCheck: KeyedCheck | null) => ({
      ...draft(kind, content, lastCheck),
      id: id ?? 'd1',
    })),
    remove: vi.fn().mockResolvedValue(undefined),
  }
}

function renderPanel(ex: StudentExchange, props: Partial<Parameters<typeof ExchangePanel>[0]> = {}) {
  const user = userEvent.setup()
  render(
    <ExchangePanel
      exchange={ex}
      now={now}
      subpoenaForm={{ caseId: 'c1', parties: { plaintiff: 'Elena Ramirez', defendant: 'Thrillville Parks' }, attorney: 'Ada Lawyer' }}
      onSend={vi.fn().mockResolvedValue(undefined)}
      onServeSubpoena={vi.fn().mockResolvedValue(undefined)}
      {...props}
    />,
  )
  return user
}

const openInterrogatories = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /^Interrogatories/ }))
  await user.click(screen.getByRole('button', { name: 'Write interrogatories' }))
}

describe('Drafts of new discovery', () => {
  it('saves a pause after typing, first as a new draft and then over it, and puts it in the address', async () => {
    const drafts = actions()
    const onOpenDraft = vi.fn()
    const user = renderPanel(exchange(), { drafts, onOpenDraft })
    await openInterrogatories(user)

    // Nothing written, nothing saved.
    await new Promise((r) => setTimeout(r, 900))
    expect(drafts.save).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('Question 1'), 'Who inspected it?')
    await waitFor(() => expect(drafts.save).toHaveBeenCalledTimes(1), { timeout: 2000 })
    expect(drafts.save).toHaveBeenLastCalledWith('interrogatories', null, { items: ['Who inspected it?'] }, null, undefined)
    expect(await screen.findByText(/^Draft saved/)).toBeInTheDocument()
    expect(onOpenDraft).toHaveBeenLastCalledWith('d1')

    await user.type(screen.getByLabelText('Question 1'), ' When?')
    await waitFor(() => expect(drafts.save).toHaveBeenCalledTimes(2), { timeout: 2000 })
    expect(drafts.save).toHaveBeenLastCalledWith('interrogatories', 'd1', { items: ['Who inspected it? When?'] }, null, undefined)

    // Leaving right after an edit saves it then and there, and takes it out of the address.
    await user.type(screen.getByLabelText('Question 1'), ' Where?')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(drafts.save).toHaveBeenCalledTimes(3))
    expect(drafts.save).toHaveBeenLastCalledWith('interrogatories', 'd1', { items: ['Who inspected it? When? Where?'] }, null, undefined)
    expect(onOpenDraft).toHaveBeenLastCalledWith(null)
  })

  it('saves and goes back with Save as draft', async () => {
    const drafts = actions()
    const user = renderPanel(exchange(), { drafts })
    await openInterrogatories(user)
    expect(screen.getByRole('button', { name: 'Save as draft' })).toBeDisabled()
    await user.type(screen.getByLabelText('Question 1'), 'Who inspected it?')
    await user.click(screen.getByRole('button', { name: 'Save as draft' }))
    expect(drafts.save).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Write interrogatories' })).toBeInTheDocument()
  })

  it('asks before Cancel deletes a draft with something in it', async () => {
    const drafts = actions()
    const user = renderPanel(exchange(), { drafts })
    await openInterrogatories(user)
    // An empty one just closes.
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(drafts.remove).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Write interrogatories' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Write interrogatories' }))
    await user.type(screen.getByLabelText('Question 1'), 'Who inspected it?')
    await user.click(screen.getByRole('button', { name: 'Save as draft' }))
    // Opened again from the list, then cancelled.
    await user.click(screen.getByRole('button', { name: 'Write interrogatories' }))
    await user.type(screen.getByLabelText('Question 1'), 'Who?')
    await waitFor(() => expect(drafts.save).toHaveBeenCalledTimes(2), { timeout: 2000 })
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('group', { name: 'Delete this draft?' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByLabelText('Question 1')).toHaveValue('Who?')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Delete draft' }))
    expect(drafts.remove).toHaveBeenCalledWith('d1')
    expect(screen.getByRole('button', { name: 'Write interrogatories' })).toBeInTheDocument()
    // Nothing more is saved once it's deleted.
    await new Promise((r) => setTimeout(r, 900))
    expect(drafts.save).toHaveBeenCalledTimes(2)
  })

  it('lists the drafts, opens one where the team left off with its last AI check, and deletes from the list', async () => {
    const drafts = actions()
    const items = ['Who inspected it?', 'When?']
    const saved = draft('interrogatories', { items }, { id: 'chk1', tag: 'SMALL_EDITS', feedback: 'Interrogatory 2: When what?', key: JSON.stringify(items) })
    const user = renderPanel(exchange({ interrogatories: part({ drafts: [saved] }) }), { drafts, onCheck: vi.fn() })
    await user.click(screen.getByRole('button', { name: /^Interrogatories/ }))

    const list = screen.getByRole('region', { name: 'Drafts' })
    const row = within(list).getByRole('button', { name: /^Who inspected it\?/ })
    expect(row).toHaveTextContent('2 questions · Edited')
    expect(row).toHaveTextContent('by Bo Brief')
    expect(row).toHaveTextContent('AI: Small edits')
    // Drafts don't use up the team's interrogatories.
    expect(screen.getByText('5/5')).toBeInTheDocument()

    await user.click(row)
    expect(screen.getByLabelText('Question 1')).toHaveValue('Who inspected it?')
    expect(screen.getByLabelText('Question 2')).toHaveValue('When?')
    expect(screen.getByLabelText('AI feedback')).toHaveTextContent('Interrogatory 2: When what?')
    expect(screen.getByRole('button', { name: 'Send anyway' })).toBeInTheDocument()
    // Opening it doesn't save it.
    await new Promise((r) => setTimeout(r, 900))
    expect(drafts.save).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Delete draft: Who inspected it?' }))
    await user.click(screen.getByRole('button', { name: 'Delete draft' }))
    expect(drafts.remove).toHaveBeenCalledWith('d1')
  })

  it('opens straight into a draft named in the address, and sending it passes the draft', async () => {
    const drafts = actions()
    const onServeSubpoena = vi.fn().mockResolvedValue(undefined)
    const content = {
      recipient: 'Mercy Hospital',
      recipientDescription: '',
      requestType: 'documents' as const,
      records: 'ER records for June 10.',
      justification: 'Only the hospital has them.',
    }
    const ex = exchange()
    ex.subpoenas!.drafts = [draft('subpoena', content)]
    const user = renderPanel(ex, { drafts, onServeSubpoena, initialDraftId: 'd1' })

    expect(screen.getByLabelText('To')).toHaveValue('Mercy Hospital')
    expect(screen.getByLabelText('What you want')).toHaveValue('ER records for June 10.')
    expect(screen.getByLabelText(/^Justification/)).toHaveValue('Only the hospital has them.')
    await user.click(screen.getByRole('button', { name: 'Serve subpoena' }))
    expect(onServeSubpoena).toHaveBeenCalledWith(expect.objectContaining({ recipient: 'Mercy Hospital' }), undefined, 'd1')
    await new Promise((r) => setTimeout(r, 900))
    expect(drafts.save).not.toHaveBeenCalled()
  })
})
