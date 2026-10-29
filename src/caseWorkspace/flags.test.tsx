import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { TeamFlag } from '../courses/types'
import { FlagButton } from './flags'
import { FlagsContext } from './flagsContext'

const flag = (over: Partial<TeamFlag>): TeamFlag => ({
  id: 'fl1',
  kind: 'fact',
  targetId: 'f1',
  reviewId: null,
  reason: 'Nothing was burning.',
  status: 'open',
  resolution: null,
  createdAt: '2026-10-16T15:00:00.000Z',
  resolvedAt: null,
  seen: false,
  ...over,
})

function renderButton(flags: TeamFlag[], raise = vi.fn().mockResolvedValue(undefined), markSeen = vi.fn()) {
  render(
    <FlagsContext.Provider value={{ flags, raise, markSeen }}>
      <FlagButton kind="fact" targetId="f1" what="Torres smelled smoke." />
    </FlagsContext.Provider>,
  )
  return { raise, markSeen, user: userEvent.setup() }
}

describe('FlagButton', () => {
  it('sends a flag with the team’s reason', async () => {
    const { raise, user } = renderButton([])
    await user.click(screen.getByRole('button', { name: 'Flag for your instructor: Torres smelled smoke.' }))
    const send = screen.getByRole('button', { name: 'Send to your instructor' })
    expect(send).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'What do you think is wrong?' }), 'Nothing was burning.')
    await user.click(send)
    expect(raise).toHaveBeenCalledWith({ kind: 'fact', targetId: 'f1', reviewId: undefined, reason: 'Nothing was burning.' })
  })

  it('shows where a flag stands, and marks the answer read once shown', () => {
    const { markSeen } = renderButton([flag({ status: 'resolved', resolution: 'changed' })])
    expect(screen.getByText('Your instructor looked at your flag and changed it')).toBeInTheDocument()
    expect(screen.getByText('New')).toBeInTheDocument()
    expect(markSeen).toHaveBeenCalled()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('says when a flag is waiting', () => {
    renderButton([flag({})])
    expect(screen.getByText('Flagged · waiting for your instructor')).toBeInTheDocument()
  })

  it('is hidden in the instructor’s preview', () => {
    render(<FlagButton kind="fact" targetId="f1" what="Torres smelled smoke." />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
