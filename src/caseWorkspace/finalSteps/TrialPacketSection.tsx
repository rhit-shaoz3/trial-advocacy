import { useEffect, useState } from 'react'
import { AlertTriangle, FolderArchive } from 'lucide-react'
import type { PacketContents } from '../../courses/types'
import { PacketChooser } from './PacketChooser'
import './exhibits.css'

/** What the team's packet needs from the page. */
export interface PacketActions {
  load(): Promise<PacketContents | null>
  /** Leave out on a closed case: choices are then only for the download. */
  save?(leftOut: string[]): Promise<void>
  zipUrl: string
  pdfUrl(leftOut: string[]): string
}

/**
 * The team's trial packet, once it has submitted its exhibit list: all of it
 * as a zip, or what the team chooses as one PDF for court.
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
        The zip has everything from the case, file by file. For court, choose what you want below and download it as one PDF
        with a table of contents. Admitted exhibits join the packet as the exhibits settle, so download it again once the list
        is final.
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
      {contents ? <PacketChooser contents={contents} pdfUrl={actions.pdfUrl} onSave={actions.save} /> : !error && <p className="muted">Loading…</p>}
    </section>
  )
}
