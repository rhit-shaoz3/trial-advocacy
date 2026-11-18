import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { CaseWorkspace, ClientEmail } from '../../courses/types'
import { CaseWorkspaceView } from '../CaseWorkspaceView'
import { splitReply } from './splitReply'

const member = (name: string, you = false) => ({ email: `${name.split(' ')[0].toLowerCase()}@example.com`, name, joined: true, you })

const workspace: CaseWorkspace = {
  case: { id: 'k1', title: 'Winston v. Thrillville', summary: 'A rider was hurt.', status: 'active', phase: 'introduction', instructorNote: '' },
  team: { number: 2, members: [member('Ada Lawyer', true), member('Bo Partner')] },
  world: { number: 1, side: 'plaintiff', opponents: { number: 3, members: [member('Cy Counsel')] } },
  side: 'plaintiff',
  materials: [],
  witnesses: [
    { id: 'w1', name: 'Paige Winston', role: 'Plaintiff', description: '', side: 'plaintiff', canInterview: true, client: true },
    { id: 'w2', name: 'Dana Winston', role: 'Sister', description: '', side: 'plaintiff', canInterview: false, client: true },
    { id: 'w3', name: 'Tom Becker', role: 'Operator', description: '', side: 'defense', canInterview: false, locked: true },
  ],
  investigator: null,
  investigatorAvailable: false,
  clientEmailLimit: { max: 2, per: 'team' },
  tasks: [],
  preview: false,
}

const email = (over: Partial<ClientEmail> = {}): ClientEmail => ({
  id: 'e1',
  to: ['Paige Winston', 'Dana Winston'],
  subject: 'Your records',
  body: 'Can you send your receipts?',
  from: 'Ada Lawyer',
  mine: true,
  sentAt: '2026-10-10T15:00:00.000Z',
  status: 'completed',
  repliedAt: '2026-10-11T15:00:00.000Z',
  reply: 'From: Paige Winston\nTo: the attorneys\nDate: Oct 11\nSubject: Re: Your records\n\nHi,\n\nThe receipts are attached.\n\nPaige\n\nAttachments:\nReceipts',
  attachments: [{ id: 'm9', title: 'Receipts', filename: 'Receipts.pdf', contentType: 'application/pdf', sizeBytes: 2048 }],
  facts: [],
  seen: false,
  ...over,
})

function renderView(props: Partial<Parameters<typeof CaseWorkspaceView>[0]> = {}) {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <CaseWorkspaceView workspace={workspace} downloadUrl={(id) => `/files/${id}`} now={new Date('2026-10-15T09:00:00')} {...props} />
    </MemoryRouter>,
  )
  return { user }
}

describe('client email', () => {
  it('shows the clients on the dashboard, with the latest message and Compose', async () => {
    const onSendClientEmail = vi.fn().mockResolvedValue(undefined)
    const { user } = renderView({ clientEmails: [email()], onSendClientEmail })
    const card = screen.getByRole('region', { name: /Email your client/ })
    expect(card).toHaveTextContent('Paige Winston')
    expect(card).toHaveTextContent('Dana Winston')
    expect(card).toHaveTextContent('Re: Your records')
    expect(card).toHaveTextContent('1 new')

    await user.click(within(card).getByRole('button', { name: 'Compose' }))
    const form = screen.getByRole('form', { name: 'New email to your client' })
    expect(within(form).getByRole('checkbox', { name: 'Paige Winston' })).toBeChecked()
    expect(within(form).getByRole('checkbox', { name: 'Dana Winston' })).toBeChecked()
    await user.type(within(form).getByRole('textbox', { name: /Subject/ }), 'Photos')
    await user.type(within(form).getByLabelText('Your email'), 'Do you have photos of the ride?')
    await user.click(within(form).getByRole('button', { name: 'Send' }))
    expect(onSendClientEmail).toHaveBeenCalledWith({ to: ['w1', 'w2'], subject: 'Photos', body: 'Do you have photos of the ride?' })
  })

  it('has no client email without clients', () => {
    renderView({ workspace: { ...workspace, witnesses: workspace.witnesses.filter((w) => !w.client) } })
    expect(screen.queryByRole('tab', { name: /Client email/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /Email your client/ })).not.toBeInTheDocument()
  })

  it('reads the reply as an email, with its attachments, and marks it read', async () => {
    const onOpenClient = vi.fn()
    const { user } = renderView({ clientEmails: [email()], onOpenClient, onSendClientEmail: vi.fn() })
    await user.click(screen.getByRole('tab', { name: /Client email/ }))
    expect(onOpenClient).toHaveBeenCalled()
    expect(screen.getByText('1 of 2 emails used by your team · 1 left')).toBeInTheDocument()

    const message = screen.getByRole('article', { name: 'Re: Your records' })
    expect(within(message).getByText('Paige Winston')).toBeInTheDocument()
    expect(message).toHaveTextContent('The receipts are attached.')
    // The attachments are listed as files, not repeated at the end.
    expect(within(message).queryByText(/^Attachments:/)).not.toBeInTheDocument()
    expect(within(message).getByRole('link', { name: 'Download Receipts' })).toHaveAttribute('href', '/files/m9')

    await user.click(screen.getByRole('tab', { name: 'Sent' }))
    expect(screen.getByRole('article', { name: 'Your records' })).toHaveTextContent('Can you send your receipts?')
  })

  it('waits for a reply before the next email, and stops at the limit', async () => {
    const { user } = renderView({
      clientEmails: [email({ id: 'e2', status: 'working', reply: null, repliedAt: null, attachments: [] })],
      onSendClientEmail: vi.fn(),
    })
    await user.click(screen.getByRole('tab', { name: /Client email/ }))
    expect(screen.getByRole('button', { name: 'Compose' })).toBeDisabled()
    expect(screen.getByText(/Waiting for a reply to your last email/)).toBeInTheDocument()
  })

  it('stops at a per-student limit, counting only your own', async () => {
    const limited = { ...workspace, clientEmailLimit: { max: 1, per: 'student' as const } }
    const { user } = renderView({
      workspace: limited,
      clientEmails: [email({ id: 'e2', mine: false }), email({ mine: true, seen: true })],
      onSendClientEmail: vi.fn(),
    })
    await user.click(screen.getByRole('tab', { name: /Client email/ }))
    expect(screen.getByText('1 of 1 email used by you · 0 left')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Compose' })).toBeDisabled()
  })

  it("emails one client from the Witnesses tab, next to Interview", async () => {
    const { user } = renderView({ clientEmails: [], onSendClientEmail: vi.fn() })
    await user.click(screen.getByRole('tab', { name: /Witnesses/ }))
    const dana = screen.getAllByRole('listitem').find((li) => li.textContent?.includes('Dana Winston'))!
    expect(dana).toHaveTextContent('Your client')
    // Both ways to reach a client: Paige can be interviewed; Dana has no interview file yet, so hers is greyed out.
    const paige = screen.getAllByRole('listitem').find((li) => li.textContent?.includes('Paige Winston'))!
    expect(within(paige).getByRole('button', { name: 'Email Paige Winston' })).toBeInTheDocument()
    expect(within(paige).getByText('Interview')).not.toHaveAttribute('title')
    expect(within(dana).getByText('Interview').closest('[aria-disabled]')).toHaveAttribute('title', expect.stringMatching(/hasn't set up interviews/))
    // Tom is the other side's witness, not a client.
    const tom = screen.getAllByRole('listitem').find((li) => li.textContent?.includes('Tom Becker'))!
    expect(within(tom).queryByRole('button', { name: /Email/ })).not.toBeInTheDocument()
    await user.click(within(dana).getByRole('button', { name: 'Email Dana Winston' }))
    const form = await screen.findByRole('form', { name: 'New email to your client' })
    expect(within(form).getByRole('checkbox', { name: 'Dana Winston' })).toBeChecked()
    expect(within(form).getByRole('checkbox', { name: 'Paige Winston' })).not.toBeChecked()
  })

  it('teaches what clients can give, and that it may be discoverable', async () => {
    const { user } = renderView({ clientEmails: [] })
    await user.click(screen.getByRole('tab', { name: /Client email/ }))
    await user.click(screen.getByRole('button', { name: 'Teach me' }))
    const guide = await screen.findByRole('dialog', { name: 'What can your client get you?' })
    expect(guide).toHaveTextContent('FRE 501')
    expect(guide).toHaveTextContent('FRCP 26(b)(1) and 34')
    expect(guide).toHaveTextContent('privilege log (FRCP 26(b)(5)(A))')
  })

  it('shows the inbox in the preview without Compose', async () => {
    const { user } = renderView({ workspace: { ...workspace, preview: true } })
    await user.click(screen.getByRole('tab', { name: /Client email/ }))
    expect(screen.queryByRole('button', { name: 'Compose' })).not.toBeInTheDocument()
    expect(screen.getByText('No replies yet.')).toBeInTheDocument()
  })
})

describe('splitReply', () => {
  it('takes the header lines off the top and the attachment list off the end', () => {
    expect(splitReply(email().reply!)).toEqual({
      headers: { from: 'Paige Winston', to: 'the attorneys', date: 'Oct 11', subject: 'Re: Your records' },
      body: 'Hi,\n\nThe receipts are attached.\n\nPaige',
    })
  })
})
