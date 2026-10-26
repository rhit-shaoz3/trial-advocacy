import { useEffect, useRef, useState } from 'react'
import { Download, FileText } from 'lucide-react'
import { fileCategory, fileTypeLabel, formatSize } from '../courses/caseLabels'
import { Modal } from './Modal'
import './FileViewer.css'

/** What the viewer needs to know about a file. */
export interface ViewableFile {
  id: string
  /** What to call it: its description, or its filename. */
  title: string
  filename: string
  contentType: string
  sizeBytes?: number
}

/** Types the server will show in the page (see canViewInline in server/storage/shared.ts). */
const INLINE = /^(application\/pdf|image\/(png|jpeg|gif|webp)|audio\/|video\/|text\/plain)/i

type TextState = { status: 'loading' } | { status: 'ready'; text: string } | { status: 'none' }

/**
 * A case file opened in the app: PDFs, pictures, audio, video and plain text
 * shown as themselves, a Word file as its text version, and anything else
 * offered as a download.
 */
export function FileViewer({
  file,
  downloadUrl,
  loadText,
  onClose,
}: {
  file: ViewableFile
  /** The file's download link; `?view=1` shows it in the page instead. */
  downloadUrl: string
  /** The file's text version, for a document the browser can't show. */
  loadText?(): Promise<{ status: string; text: string | null }>
  onClose(): void
}) {
  const inline = INLINE.test(file.contentType)
  const category = fileCategory(file.contentType)
  const viewUrl = `${downloadUrl}?view=1`
  const [text, setText] = useState<TextState>({ status: 'loading' })
  // The parent passes a new function each render; load the text once per file.
  const loadTextRef = useRef(loadText)
  useEffect(() => {
    loadTextRef.current = loadText
  })
  const canLoadText = Boolean(loadText)

  useEffect(() => {
    const load = loadTextRef.current
    if (inline || !load) return
    let cancelled = false
    load()
      .then((r) => !cancelled && setText(r.status === 'ready' && r.text ? { status: 'ready', text: r.text } : { status: 'none' }))
      .catch(() => !cancelled && setText({ status: 'none' }))
    return () => {
      cancelled = true
    }
  }, [inline, file.id])

  return (
    <Modal
      wide
      eyebrow={`${fileTypeLabel(file.contentType)}${file.sizeBytes != null ? ` · ${formatSize(file.sizeBytes)}` : ''}`}
      title={file.title}
      icon={<FileText />}
      onClose={onClose}
      footer={
        <a className="ws-btn ws-btn-secondary" href={downloadUrl} download={file.filename}>
          <Download aria-hidden="true" />
          Download
        </a>
      }
    >
      <div className="file-viewer">
        {inline && file.contentType.startsWith('application/pdf') ? (
          <iframe className="file-viewer-frame" src={viewUrl} title={file.title} />
        ) : inline && category === 'image' ? (
          <img className="file-viewer-image" src={viewUrl} alt={file.title} />
        ) : inline && category === 'audio' ? (
          <audio className="file-viewer-media" src={viewUrl} controls />
        ) : inline && category === 'video' ? (
          <video className="file-viewer-media" src={viewUrl} controls />
        ) : inline ? (
          <iframe className="file-viewer-frame file-viewer-text" src={viewUrl} title={file.title} />
        ) : text.status === 'loading' && canLoadText ? (
          <p className="muted">Loading the text…</p>
        ) : text.status === 'ready' ? (
          <div className="file-viewer-doc">
            <span className="ws-eyebrow">Text version</span>
            <pre>{text.text}</pre>
          </div>
        ) : (
          <p className="file-viewer-none">
            This file can&rsquo;t be shown here. Download it to open it on your computer.
          </p>
        )}
      </div>
    </Modal>
  )
}
