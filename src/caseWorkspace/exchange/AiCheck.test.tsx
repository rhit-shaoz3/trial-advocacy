import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { DiscoveryCheck } from '../../courses/types'
import { AiCheck } from './AiCheck'

/** A one-field draft with the check under it. */
function Draft({ onCheck, onSubmit }: { onCheck?(): Promise<DiscoveryCheck>; onSubmit(checkId?: string): Promise<void> }) {
  const [text, setText] = useState('Who inspected it?')
  return (
    <>
      <label>
        Draft
        <textarea value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <AiCheck
        ready={text.trim() !== ''}
        draftKey={text}
        onCheck={onCheck}
        onSubmit={onSubmit}
        submitLabel="Send"
        busyLabel="Sending…"
        anywayLabel="Send anyway"
      />
    </>
  )
}

const check = (tag: DiscoveryCheck['tag'], feedback = 'Interrogatory 1: Knowledge of what?'): DiscoveryCheck => ({ id: 'chk1', tag, feedback })

describe('Check with AI', () => {
  it('comes before sending; Looks good reveals Send and keeps the feedback to itself', async () => {
    let resolve!: (c: DiscoveryCheck) => void
    const onCheck = vi.fn(() => new Promise<DiscoveryCheck>((r) => (resolve = r)))
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<Draft onCheck={onCheck} onSubmit={onSubmit} />)

    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Check with AI' }))
    expect(screen.getByRole('status')).toHaveTextContent('Checking your draft…')
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled()

    resolve(check('LOOKS_GOOD', 'Tight and focused.'))
    expect(await screen.findByText('Looks good')).toBeInTheDocument()
    expect(screen.queryByText('Tight and focused.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSubmit).toHaveBeenCalledWith('chk1')
  })

  it.each([
    ['SMALL_EDITS', 'Small edits', '~'],
    ['NEEDS_IMPROVEMENT', 'Needs improvement', ''],
  ] as const)('shows the questions on %s, with Check again first and sending anyway still there', async (tag, label, icon) => {
    const onCheck = vi.fn().mockResolvedValueOnce(check(tag)).mockResolvedValueOnce(check('LOOKS_GOOD'))
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    const { container } = render(<Draft onCheck={onCheck} onSubmit={onSubmit} />)

    await user.click(screen.getByRole('button', { name: 'Check with AI' }))
    expect(await screen.findByText(label)).toBeInTheDocument()
    if (icon) expect(container.querySelector('.ai-check-icon')).toHaveTextContent(icon)
    expect(screen.getByLabelText('AI feedback')).toHaveTextContent('Interrogatory 1: Knowledge of what?')
    expect(screen.getByRole('button', { name: 'Check again' })).toHaveClass('ws-btn-primary')
    expect(screen.getByRole('button', { name: 'Send anyway' })).toHaveClass('ws-btn-secondary')

    // Editing makes the check out of date; checking again can clear it.
    await user.type(screen.getByLabelText('Draft'), ' About the harness?')
    expect(screen.getByRole('status')).toHaveTextContent('You’ve edited since this check.')
    await user.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByText('Looks good')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })

  it('lets the team send without a check when the AI is down', async () => {
    const onCheck = vi.fn().mockRejectedValue(new Error('The AI couldn’t check your draft just now.'))
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<Draft onCheck={onCheck} onSubmit={onSubmit} />)
    await user.click(screen.getByRole('button', { name: 'Check with AI' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The AI couldn’t check your draft just now.')
    await user.click(screen.getByRole('button', { name: 'Send without a check' }))
    expect(onSubmit).toHaveBeenCalledWith(undefined)
  })

  it('is just the send button without a checker', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<Draft onSubmit={onSubmit} />)
    expect(screen.queryByRole('button', { name: 'Check with AI' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSubmit).toHaveBeenCalled()
  })
})
