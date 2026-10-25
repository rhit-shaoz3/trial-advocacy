import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { StudentExchange, StudentPart } from '../../courses/types'
import { ExchangePanel } from './ExchangePanel'

const now = new Date('2026-11-01T12:00:00Z')

const part = (overrides: Partial<StudentPart> = {}): StudentPart => ({
  limit: 3,
  days: 14,
  used: 0,
  remaining: 3,
  requests: [],
  ...overrides,
})

const base: StudentExchange = {
  phase: 'introduction',
  requestsOpen: false,
  side: 'plaintiff',
  teamNumber: 1,
  opponentNumber: 2,
  firm: { firm: 'Hale & Whitford LLP', partner: 'Margaret Hale' },
  disclosures: {
    open: true,
    options: [
      { kind: 'witness', id: 'w1', side: 'plaintiff', name: 'Elena Ramirez', detail: 'Plaintiff', avatarUrl: null },
      { kind: 'material', id: 'm1', side: 'plaintiff', name: 'Medical records.pdf', detail: '', avatarUrl: null },
    ],
    submission: null,
    review: null,
  },
  interrogatories: part({ limit: 15, days: 30, remaining: 15 }),
  rfas: part(),
}

const set = {
  id: 'r1',
  worldNumber: 1,
  sentBy: 'Cy Counsel',
  sentAt: '2026-10-28T12:00:00Z',
  dueAt: '2026-11-11T12:00:00Z',
  respondedAt: null,
  respondedBy: null,
  seen: false,
}

function renderPanel(exchange: StudentExchange, handlers: Partial<Parameters<typeof ExchangePanel>[0]> = {}) {
  const user = userEvent.setup()
  render(<ExchangePanel exchange={exchange} now={now} {...handlers} />)
  return user
}

describe('ExchangePanel: initial disclosures', () => {
  it('needs a reason for each pick and for holding back, then submits', async () => {
    const onSubmitDisclosures = vi.fn().mockResolvedValue(undefined)
    const user = renderPanel(base, { onSubmitDisclosures })

    expect(screen.getByRole('heading', { name: 'Select what to submit in initial disclosures' })).toBeInTheDocument()
    // Interrogatories wait for the information exchange phase.
    expect(screen.getByText('Interrogatories and requests for admission open in the information exchange phase.')).toBeInTheDocument()

    const submit = screen.getByRole('button', { name: 'Submit initial disclosures' })
    await user.click(screen.getByRole('checkbox', { name: /Elena Ramirez/ }))
    expect(submit).toBeDisabled()
    expect(screen.getByText(/Write a reason for Elena Ramirez to submit/)).toBeInTheDocument()

    await user.type(screen.getByLabelText('Why disclose this?'), 'Our client.')
    expect(submit).toBeDisabled()
    await user.type(screen.getByLabelText('Why are you holding back the rest?'), 'Private records.')
    await user.click(submit)
    expect(onSubmitDisclosures).toHaveBeenCalledWith([{ kind: 'witness', id: 'w1', reason: 'Our client.' }], 'Private records.')
  })

  it('compares the picks with the instructor’s once the case moves on', async () => {
    const elena = { kind: 'witness' as const, id: 'w1', name: 'Elena Ramirez', detail: 'Plaintiff', avatarUrl: null, reason: 'Our client.' }
    renderPanel({
      ...base,
      phase: 'information_exchange',
      requestsOpen: true,
      disclosures: {
        ...base.disclosures!,
        open: false,
        submission: { submittedAt: '2026-10-28T12:00:00Z', heldBackReason: 'x', items: [elena] },
        review: { matched: [elena], extra: [], missing: [] },
      },
    })
    await userEvent.setup().click(screen.getByRole('button', { name: /Initial disclosures/ }))
    expect(screen.getByText('Nicely done: your picks match your instructor’s exactly.')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Your score' })).getByText('Matched').closest('li')).toHaveTextContent('1')
  })
})

describe('ExchangePanel: interrogatories and requests for admission', () => {
  const open: StudentExchange = {
    ...base,
    phase: 'information_exchange',
    requestsOpen: true,
    disclosures: { ...base.disclosures!, open: false, review: { matched: [], extra: [], missing: [] } },
  }

  it('counts what is left, counts subparts, and stops at the limit', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined)
    const user = renderPanel({ ...open, interrogatories: part({ limit: 3, used: 0, remaining: 3 }) }, { onSend })
    await user.click(screen.getByRole('button', { name: /^Interrogatories/ }))
    expect(screen.getByText(/You have/).textContent).toBe('You have 3/3 interrogatories left')

    await user.click(screen.getByRole('button', { name: 'Write interrogatories' }))
    await user.type(screen.getByLabelText('Question 1'), 'Was it replaced, (a) when and (b) by whom?')
    expect(screen.getByText('Has 2 subparts, so it counts as 2 questions.')).toBeInTheDocument()
    expect(screen.getByText(/1 of 3 left after sending/)).toBeInTheDocument()

    // Return starts a new line; the last question fills the limit.
    await user.keyboard('{Enter}')
    await user.type(screen.getByLabelText('Question 2'), 'Who inspected it?')
    expect(screen.getByRole('button', { name: 'Add another' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent("You're out of interrogatories. Your team has used all 3.")

    await user.click(screen.getByRole('button', { name: 'Send to Team 2' }))
    expect(onSend).toHaveBeenCalledWith('interrogatories', ['Was it replaced, (a) when and (b) by whom?', 'Who inspected it?'])
  })

  it('greys out writing more once the team is out', async () => {
    const user = renderPanel({ ...open, interrogatories: part({ limit: 3, used: 3, remaining: 0 }) }, { onSend: vi.fn() })
    await user.click(screen.getByRole('button', { name: /^Interrogatories/ }))
    expect(screen.getByRole('button', { name: 'Write interrogatories' })).toBeDisabled()
  })

  it('responds to requests for admission with agree, disagree, or partial', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    const received = {
      ...set,
      kind: 'rfas' as const,
      direction: 'received' as const,
      fromTeam: { id: 't2', number: 2, side: 'defense' as const },
      toTeam: { id: 't1', number: 1, side: 'plaintiff' as const },
      items: [
        { position: 1, text: 'Admit she drank two beers.', weight: 1, answer: null, objection: false, admission: null, agreePart: null, disagreePart: null },
        { position: 2, text: 'Admit the harness was latched.', weight: 1, answer: null, objection: false, admission: null, agreePart: null, disagreePart: null },
      ],
    }
    const user = renderPanel({ ...open, rfas: part({ requests: [received] }) }, { onRespond })
    // A set to respond to opens its part first.
    expect(screen.getByRole('heading', { name: 'Requests for admission' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Respond' }))

    const send = screen.getByRole('button', { name: 'Send responses' })
    await user.click(within(screen.getByRole('radiogroup', { name: 'Response to request 1' })).getByRole('radio', { name: 'Agree' }))
    await user.click(within(screen.getByRole('radiogroup', { name: 'Response to request 2' })).getByRole('radio', { name: 'Partial' }))
    expect(send).toBeDisabled()
    await user.type(screen.getByLabelText('What you agree with'), 'It was closed.')
    await user.type(screen.getByLabelText('What you disagree with'), 'It never latched.')
    await user.click(send)
    expect(onRespond).toHaveBeenCalledWith('r1', [
      expect.objectContaining({ position: 1, admission: 'agree' }),
      expect.objectContaining({ position: 2, admission: 'partial', agreePart: 'It was closed.', disagreePart: 'It never latched.' }),
    ])
  })

  it('teaches the rule and says how the case differs', async () => {
    const user = renderPanel(open)
    await user.click(screen.getByRole('button', { name: /^Interrogatories/ }))
    await user.click(screen.getByRole('button', { name: 'Teach me' }))
    const dialog = screen.getByRole('dialog', { name: 'What are interrogatories?' })
    expect(dialog).toHaveTextContent('Your instructor allows 15 interrogatories per team instead of 25.')
  })
})
