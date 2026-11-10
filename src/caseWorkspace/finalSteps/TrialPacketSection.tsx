import { useEffect, useState } from 'react'
import { AlertTriangle, FolderArchive } from 'lucide-react'
import type { PacketContents, PacketFolder } from '../../courses/types'
import { PacketFolders } from './PacketFolders'
import './exhibits.css'

/** What the team's packet needs from the page. */
export interface PacketActions {
  load(): Promise<PacketContents | null>
  /** Leave out on a closed case: the folders are then shown as they are. */
  save?(folders: PacketFolder[]): Promise<void>
  zipUrl: string
  pdfUrl: string
}

/**
 * The team's trial packet, once it has submitted its exhibit list: all of it
 * as a zip, or what the team files in its own folders as one PDF for court.
 */
export function TrialPacketSection({ actions }: { actions: PacketActions }) {
  const [contents, setContents] = useState<PacketContents | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    actions
      .load()
      .then((c) => !cancelled && setContents(c))
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [actions])

  return (
    <section className="cw-card ex-section" aria-labelledby="tp-title">
      <header className="ex-section-head">
        <div>
          <span className="ws-eyebrow">Final steps · Trial packet</span>
          <h2 id="tp-title">Your trial packet</h2>
        </div>
        <a className="ws-btn ws-btn-secondary tp-download" href={actions.zipUrl} download>
          <FolderArchive aria-hidden="true" /> Download everything (.zip)
        </a>
      </header>
      <p className="muted">
        The zip has everything from the case, file by file. For court, arrange your own PDF: name and order its folders, and file
        the documents you want in each. The folders become its table of contents, and anything you don’t file stays out.
        Admitted exhibits join the packet as the exhibits settle, so check your folders and download it again once the list is
        final.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {contents?.warnings.map((w) => (
        <p key={w} className="xl-warning">
          <AlertTriangle aria-hidden="true" />
          <span>{w}</span>
        </p>
      ))}
      {contents ? <PacketFolders contents={contents} pdfUrl={actions.pdfUrl} onSave={actions.save} /> : !error && <p className="muted">Loading…</p>}
    </section>
  )
}
