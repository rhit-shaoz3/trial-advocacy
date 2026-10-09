import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useCourseService } from '../../courses/CourseServiceContext'
import type { FactPattern } from '../../courses/types'

const MAX_BYTES = 10 * 1024 * 1024 // matches the server's limit
const ACCEPT = '.pdf,.doc,.docx,.txt'

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function FactPatternsSection({ courseId }: { courseId: string }) {
  const service = useCourseService()
  const fileInput = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<FactPattern[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    let cancelled = false
    service
      .listFactPatterns(courseId)
      .then((list) => !cancelled && setFiles(list))
      .catch((err: Error) => !cancelled && setLoadError(err.message))
    return () => {
      cancelled = true
    }
  }, [service, courseId])

  async function handleChosen(e: ChangeEvent<HTMLInputElement>) {
    const chosen = [...(e.target.files ?? [])]
    e.target.value = '' // so choosing the same file again still fires a change
    if (chosen.length === 0) return

    setErrors([])
    setUploading(true)
    const failures: string[] = []
    for (const file of chosen) {
      if (file.size > MAX_BYTES) {
        failures.push(`${file.name}: That file is too large. The limit is 10 MB.`)
        continue
      }
      try {
        const uploaded = await service.uploadFactPattern(courseId, file)
        setFiles((prev) => [...(prev ?? []), uploaded])
      } catch (err) {
        failures.push(`${file.name}: ${err instanceof Error ? err.message : 'Upload failed.'}`)
      }
    }
    setErrors(failures)
    setUploading(false)
  }

  async function handleDelete(file: FactPattern) {
    if (!window.confirm(`Delete ${file.filename}? This cannot be undone.`)) return
    setErrors([])
    try {
      await service.deleteFactPattern(courseId, file.id)
      setFiles((prev) => prev?.filter((f) => f.id !== file.id) ?? null)
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'Something went wrong.'])
    }
  }

  return (
    <section className="course-section" aria-labelledby="fact-patterns-heading">
      <div className="section-header">
        <h2 id="fact-patterns-heading">Fact patterns</h2>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={handleChosen}
          data-testid="fact-pattern-input"
        />
        <button
          type="button"
          className="btn-primary"
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
        >
          {uploading ? 'Uploading…' : 'Upload fact pattern'}
        </button>
      </div>
      <p className="muted section-hint">PDF, Word, or text files, up to 10 MB each.</p>

      {errors.length > 0 && (
        <div className="form-error" role="alert">
          {errors.map((msg) => (
            <p key={msg}>{msg}</p>
          ))}
        </div>
      )}

      {loadError ? (
        <p className="form-error" role="alert">
          Could not load the fact patterns. {loadError}
        </p>
      ) : files === null ? (
        <p className="muted">Loading fact patterns…</p>
      ) : files.length === 0 ? (
        <p className="muted">No fact patterns uploaded yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col">Size</th>
                <th scope="col">Uploaded</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.id}>
                  <td>
                    <a href={service.factPatternDownloadUrl(courseId, file.id)} download>
                      {file.filename}
                    </a>
                  </td>
                  <td>{formatSize(file.sizeBytes)}</td>
                  <td>{formatDate(file.uploadedAt)}</td>
                  <td className="cell-actions">
                    <button
                      type="button"
                      className="btn-danger"
                      onClick={() => handleDelete(file)}
                      aria-label={`Delete ${file.filename}`}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
