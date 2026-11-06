import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PacketContents } from '../../courses/types'
import { TrialPacketSection, type PacketActions } from './TrialPacketSection'

const contents: PacketContents = {
  items: [
    { id: 'exhibit-list', section: 'Exhibits', title: 'Joint exhibit list', printable: true },
    { id: 'deposition:1', section: 'Depositions', title: 'Tom Becker, taken by Team 1', printable: true },
    { id: 'file:1', section: 'Case file', title: 'Ride.mp4', printable: false },
  ],
  leftOut: ['deposition:1', 'gone'],
  warnings: ['1 deposition is still open or under review.'],
}

function renderSection(overrides: Partial<PacketActions> = {}) {
  const actions: PacketActions = {
    load: vi.fn().mockResolvedValue(contents),
    save: vi.fn().mockResolvedValue(undefined),
    zipUrl: '/my-packet',
    pdfUrl: (leftOut) => `/my-packet/pdf?out=${leftOut.join(',')}`,
    ...overrides,
  }
  render(<TrialPacketSection actions={actions} />)
  return { actions, user: userEvent.setup() }
}

afterEach(() => vi.restoreAllMocks())

describe('TrialPacketSection', () => {
  it('offers the zip, and the PDF as the team left it', async () => {
    renderSection()
    expect(await screen.findByRole('checkbox', { name: /Tom Becker/ })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Joint exhibit list' })).toBeChecked()
    expect(screen.getByRole('link', { name: /Download everything/ })).toHaveAttribute('href', '/my-packet')
    expect(screen.getByRole('link', { name: 'Download PDF' })).toHaveAttribute('href', '/my-packet/pdf?out=deposition:1')
    expect(screen.getByText('1 of 2 chosen')).toBeInTheDocument()
    expect(screen.getByText('1 deposition is still open or under review.')).toBeInTheDocument()
  })

  it('keeps what has no pages to the zip', async () => {
    renderSection()
    const video = await screen.findByRole('checkbox', { name: /Ride\.mp4/ })
    expect(video).toBeDisabled()
    expect(video).not.toBeChecked()
    expect(screen.getByText('Zip only')).toBeInTheDocument()
  })

  it('saves each choice and follows it in the link', async () => {
    const { actions, user } = renderSection()
    await user.click(await screen.findByRole('checkbox', { name: /Tom Becker/ }))
    expect(screen.getByRole('link', { name: 'Download PDF' })).toHaveAttribute('href', '/my-packet/pdf?out=')
    await waitFor(() => expect(actions.save).toHaveBeenCalledWith(['gone']))
  })

  it('needs something chosen to download', async () => {
    const { user } = renderSection()
    await user.click(await screen.findByRole('button', { name: 'Clear' }))
    expect(screen.queryByRole('link', { name: 'Download PDF' })).not.toBeInTheDocument()
    expect(screen.getByText('Choose at least one thing for the PDF.')).toBeInTheDocument()
  })

  it('says when a choice couldn’t be saved, and still offers the PDF', async () => {
    const { user } = renderSection({ save: vi.fn().mockRejectedValue(new Error('This case is closed.')) })
    await user.click(await screen.findByRole('checkbox', { name: /Tom Becker/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This case is closed.')
    expect(screen.getByRole('link', { name: 'Download PDF' })).toBeInTheDocument()
  })
})
