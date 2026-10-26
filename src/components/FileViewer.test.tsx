import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FileViewer } from './FileViewer'

const word = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

describe('FileViewer', () => {
  it('shows a Word file as its text version, with a download', async () => {
    const loadText = vi.fn().mockResolvedValue({ status: 'ready', text: 'COMPLAINT. Plaintiff Paige Winston…' })
    render(
      <FileViewer
        file={{ id: 'm1', title: 'Complaint', filename: 'Complaint.docx', contentType: word, sizeBytes: 2048 }}
        downloadUrl="/files/m1"
        loadText={loadText}
        onClose={vi.fn()}
      />,
    )

    expect(await screen.findByText('COMPLAINT. Plaintiff Paige Winston…')).toBeInTheDocument()
    expect(screen.getByText('Text version')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute('href', '/files/m1')
    expect(loadText).toHaveBeenCalledTimes(1)
  })

  it("offers a download for a file it can't show", async () => {
    render(
      <FileViewer
        file={{ id: 'm2', title: 'Diagram', filename: 'diagram.svg', contentType: 'image/svg+xml' }}
        downloadUrl="/files/m2"
        loadText={vi.fn().mockResolvedValue({ status: 'none', text: null })}
        onClose={vi.fn()}
      />,
    )

    expect(await screen.findByText(/can.t be shown here/)).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
