import { CloudUpload, FileText, Trash2 } from 'lucide-react'
import { useState, type ChangeEvent, type DragEvent } from 'react'
import { errorMessage } from '../api/useLoad'
import { useCasesApi } from './CasesApiContext'
import { formatBytes, SIDE_LABELS } from './format'
import { documentUrl } from './httpCasesApi'
import { PublishControl } from './PublishControl'
import { SideSelect } from './SideSelect'
import type { DocSide, InstructorCase } from './types'

// Same rules as fact patterns (server/courses/factPatternRoutes.ts).
const MAX_FILE_MB = 10
const ACCEPT = '.pdf,.doc,.docx,.txt'

interface Props {
  c: InstructorCase
  onChanged(): Promise<void>
  onPublish(published: boolean): Promise<void>
}

export function DocumentsSection({ c, onChanged, onPublish }: Props) {
  const api = useCasesApi()
  const [uploadSide, setUploadSide] = useState<DocSide>('both')
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
      await onChanged()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function upload(files: File[]) {
    if (files.length === 0) return
    const tooBig = files.find((f) => f.size > MAX_FILE_MB * 1024 * 1024)
    if (tooBig) {
      setError(`${tooBig.name} is larger than ${MAX_FILE_MB} MB.`)
      return
    }
    setUploading(true)
    await run(() => api.uploadDocuments(c.id, files, uploadSide))
    setUploading(false)
  }

  function handleFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    void upload(files)
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    void upload([...e.dataTransfer.files])
  }

  return (
    <section className="ws-panel case-panel" aria-labelledby="documents-heading">
      <div className="case-panel-head">
        <h2 id="documents-heading">Case files</h2>
        <PublishControl label="case files" published={c.published.documents} onChange={onPublish} />
      </div>

      <div className="upload-row">
        <label
          className={`case-drop-zone${dragging ? 'drop-over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <CloudUpload size={24} aria-hidden />
          <span className="case-drop-zone-text">
            <strong>Upload files: drop them here, or browse</strong>
            <span className="case-hint">
              PDF, Word or text files · up to {MAX_FILE_MB} MB each
            </span>
          </span>
          <input type="file" multiple accept={ACCEPT} onChange={handleFiles} disabled={uploading} />
        </label>
        <label className="case-field upload-side">
          Visible to
          <SideSelect
            label="Visible to (new uploads)"
            value={uploadSide}
            onChange={setUploadSide}
            className="case-input"
          />
        </label>
      </div>
      {uploading && <p className="case-hint">Uploading…</p>}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {c.documents.length === 0 ? (
        <p className="case-hint section-empty">No files yet.</p>
      ) : (
        <ul className="case-rows">
          {c.documents.map((doc) => (
            <li key={doc.id}>
              <span className="case-icon-tile" aria-hidden>
                <FileText size={18} />
              </span>
              <span className="case-row-main">
                <a href={documentUrl(c.id, doc.id)} className="case-row-link">
                  {doc.filename}
                </a>
                <span>
                  {formatBytes(doc.sizeBytes)} · {SIDE_LABELS[doc.side]}
                </span>
              </span>
              <SideSelect
                label={`Visible to for ${doc.filename}`}
                value={doc.side}
                onChange={(side) => run(() => api.setDocumentSide(c.id, doc.id, side))}
              />
              <button
                type="button"
                className="case-icon-btn"
                aria-label={`Delete ${doc.filename}`}
                onClick={() => {
                  if (window.confirm(`Delete ${doc.filename}?`)) {
                    void run(() => api.deleteDocument(c.id, doc.id))
                  }
                }}
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
