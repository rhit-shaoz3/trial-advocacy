import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PacketContents } from '../../courses/types'
import { TrialPacketSection, type PacketActions } from './TrialPacketSection'

const contents: PacketContents = {
  items: [
    { id: 'exhibit-list', section: 'Exhibits', title: 'Joint exhibit list', printable: true },
    { id: 'deposition:1', section: 'Depositions', title: 'Tom Becker, taken by Team 1', printable: true },
    { id: 'file:1', section: 'Case file', title: 'Waiver.pdf', printable: true },
    { id: 'file:2', section: 'Case file', title: 'Ride.mp4', printable: false },
  ],
  folders: [
    { name: 'For trial', items: ['exhibit-list', 'file:1'] },
    { name: 'Witnesses', items: [] },
  ],
  warnings: ['1 deposition is still open or under review.'],
}

function renderSection(overrides: Partial<PacketActions> = {}) {
  const actions: PacketActions = {
    load: vi.fn().mockResolvedValue(contents),
    save: vi.fn().mockResolvedValue(undefined),
    zipUrl: '/my-packet',
    pdfUrl: '/my-packet/pdf',
    ...overrides,
  }
  render(<TrialPacketSection actions={actions} />)
  return { actions, user: userEvent.setup() }
}

/** The documents in a folder, in order. */
const folderDocs = (name: string) =>
  within(screen.getByDisplayValue(name).closest('li')!)
    .queryAllByRole('listitem')
    .map((li) => li.querySelector('.pf-doc-text > span')!.textContent)

afterEach(() => vi.restoreAllMocks())

describe('TrialPacketSection', () => {
  it('shows the team’s folders, what isn’t filed, the zip, and the PDF', async () => {
    renderSection()
    expect(await screen.findByDisplayValue('For trial')).toBeInTheDocument()
    expect(folderDocs('For trial')).toEqual(['Joint exhibit list', 'Waiver.pdf'])
    expect(screen.getByText(/Empty\. File documents/)).toBeInTheDocument()
    const unfiled = screen.getByRole('region', { name: 'Not in the PDF' })
    expect(within(unfiled).getByText('Tom Becker, taken by Team 1')).toBeInTheDocument()
    expect(within(unfiled).getByText('Zip only')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Download everything/ })).toHaveAttribute('href', '/my-packet')
    expect(screen.getByRole('link', { name: 'Download PDF' })).toHaveAttribute('href', '/my-packet/pdf')
    expect(screen.getByText('1 deposition is still open or under review.')).toBeInTheDocument()
  })

  it('files a document in a folder, and saves the folders', async () => {
    const { actions, user } = renderSection()
    await user.selectOptions(await screen.findByRole('combobox', { name: 'File Tom Becker, taken by Team 1 in a folder' }), 'Witnesses')
    expect(folderDocs('Witnesses')).toEqual(['Tom Becker, taken by Team 1'])
    await waitFor(() =>
      expect(actions.save).toHaveBeenLastCalledWith([
        { name: 'For trial', items: ['exhibit-list', 'file:1'] },
        { name: 'Witnesses', items: ['deposition:1'] },
      ]),
    )
  })

  it('orders documents and folders, moves a document, and takes one out', async () => {
    const { actions, user } = renderSection()
    await user.click(await screen.findByRole('button', { name: 'Move Waiver.pdf up' }))
    expect(folderDocs('For trial')).toEqual(['Waiver.pdf', 'Joint exhibit list'])

    await user.selectOptions(screen.getByRole('combobox', { name: 'Move Joint exhibit list to another folder' }), 'Witnesses')
    expect(folderDocs('Witnesses')).toEqual(['Joint exhibit list'])

    await user.click(screen.getByRole('button', { name: 'Move Witnesses up' }))
    await user.click(screen.getByRole('button', { name: 'Take Waiver.pdf out of the PDF' }))
    await waitFor(() =>
      expect(actions.save).toHaveBeenLastCalledWith([
        { name: 'Witnesses', items: ['exhibit-list'] },
        { name: 'For trial', items: [] },
      ]),
    )
  })

  it('adds, renames and deletes folders, and won’t take a name twice', async () => {
    const { actions, user } = renderSection()
    await user.click(await screen.findByRole('button', { name: /Add folder/ }))
    const name = screen.getByDisplayValue('New folder')
    expect(name).toHaveFocus()
    await user.clear(name)
    await user.type(name, 'Pleadings{Enter}')
    expect(screen.getByDisplayValue('Pleadings')).toBeInTheDocument()

    await user.clear(screen.getByDisplayValue('Pleadings'))
    await user.type(screen.getByLabelText('Name of folder 3'), 'witnesses{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent('There’s already a folder named “witnesses”.')
    expect(screen.getByDisplayValue('Pleadings')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete For trial' }))
    await waitFor(() =>
      expect(actions.save).toHaveBeenLastCalledWith([
        { name: 'Witnesses', items: [] },
        { name: 'Pleadings', items: [] },
      ]),
    )
    // What was in it goes back to the list of what isn't filed.
    expect(within(screen.getByRole('region', { name: 'Not in the PDF' })).getByText('Waiver.pdf')).toBeInTheDocument()
    expect(screen.getByText('File at least one document in a folder for the PDF.')).toBeInTheDocument()
  })

  it('starts over with a folder for each kind of document', async () => {
    const { actions, user } = renderSection()
    await user.click(await screen.findByRole('button', { name: /Start over/ }))
    await waitFor(() =>
      expect(actions.save).toHaveBeenLastCalledWith([
        { name: 'Exhibits', items: ['exhibit-list'] },
        { name: 'Depositions', items: ['deposition:1'] },
        { name: 'Case file', items: ['file:1'] },
      ]),
    )
  })

  it('says when the folders couldn’t be saved', async () => {
    const { user } = renderSection({ save: vi.fn().mockRejectedValue(new Error('This case is closed.')) })
    await user.click(await screen.findByRole('button', { name: 'Move Waiver.pdf up' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This case is closed.')
  })

  it('shows the folders as they are on a closed case', async () => {
    renderSection({ save: undefined })
    expect(await screen.findByRole('heading', { name: 'For trial' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add folder/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Not in the PDF' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Download PDF' })).toBeInTheDocument()
  })
})
