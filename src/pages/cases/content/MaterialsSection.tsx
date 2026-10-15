import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useCourseService } from '../../../courses/CourseServiceContext'
import { AUDIENCE_LABEL, fileTypeLabel, formatSize, shortDate } from '../../../courses/caseLabels'
import { AUDIENCES, type Audience, type CaseMaterial } from '../../../courses/types'

const MAX_BYTES = 100 * 1024 * 1024 // matches the server's limit
const ACCEPT = [
  '.pdf,.doc,.docx,.txt', // documents
  '.png,.jpg,.jpeg,.gif,.webp', // images
  '.mp3,.m4a,.wav', // audio
  '.mp4,.mov,.webm', // video
].join(',')

/**
 * The case file: the pieces of the fact pattern (documents, images, audio,
 * video), each shown to everyone in the case or only to one side.
 */
export function MaterialsSection({
  courseId,
  caseId,
  onChange,
}: {
  courseId: string
  caseId: string
  /** Called after any upload, edit, or delete (e.g. to refresh the launch checklist). */
  onChange?(): void
}) {
  const service = useCourseService()
  const fileInput = useRef<HTMLInputElement>(null)
  const [materials, setMaterials] = useState<CaseMaterial[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [audience, setAudience] = useState<Audience>('all')
  const [description, setDescription] = useState('')

  useEffect(() => {
    let cancelled = false
    service
      .listMaterials(courseId, caseId)
      .then((list) => !cancelled && setMaterials(list))
      .catch((err: Error) => !cancelled && setLoadError(err.message))
    return () => {
      cancelled = true
    }
  }, [service, courseId, caseId])

  async function handleChosen(e: ChangeEvent<HTMLInputElement>) {
    const chosen = [...(e.target.files ?? [])]
    e.target.value = '' // so choosing the same file again still fires a change
    if (chosen.length === 0) return

    setErrors([])
    setUploading(true)
    const failures: string[] = []
    for (const file of chosen) {
      if (file.size > MAX_BYTES) {
        failures.push(`${file.name}: That file is too large. The limit is 100 MB.`)
        continue
      }
      try {
        const uploaded = await service.uploadMaterial(courseId, caseId, file, { audience, description })
        setMaterials((prev) => [...(prev ?? []), uploaded])
      } catch (err) {
        failures.push(`${file.name}: ${err instanceof Error ? err.message : 'Upload failed.'}`)
      }
    }
    if (failures.length < chosen.length) setDescription('')
    setErrors(failures)
    setUploading(false)
    onChange?.()
  }

  async function handleAudience(material: CaseMaterial, next: Audience) {
    setErrors([])
    try {
      const updated = await service.updateMaterial(courseId, caseId, material.id, {
        audience: next,
        description: material.description,
      })
      setMaterials((prev) => prev?.map((m) => (m.id === updated.id ? updated : m)) ?? null)
      onChange?.()
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'Something went wrong.'])
    }
  }

  async function handleDelete(material: CaseMaterial) {
    if (!window.confirm(`Delete ${material.filename}? Students will no longer see it.`)) return
    setErrors([])
    try {
      await service.deleteMaterial(courseId, caseId, material.id)
      setMaterials((prev) => prev?.filter((m) => m.id !== material.id) ?? null)
      onChange?.()
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'Something went wrong.'])
    }
  }

  return (
    <section className="course-section" aria-labelledby="materials-heading">
      <h2 id="materials-heading">Case file</h2>
      <p className="muted section-hint">
        Split the fact pattern into sections and upload each piece (documents, images, audio, and
        video, up to 100 MB each) so students can find what they need. They see the files in their
        Case file tab, grouped by type. Choose who can see each file.
      </p>

      <div className="panel-form content-form" role="group" aria-label="Upload to the case file">
        <label>
          Visible to
          <select value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
            {AUDIENCES.map((a) => (
              <option key={a} value={a}>
                {AUDIENCE_LABEL[a]}
              </option>
            ))}
          </select>
        </label>
        <label className="content-form-grow">
          Description (optional)
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ride maintenance log, March–October"
            maxLength={400}
          />
        </label>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={handleChosen}
          data-testid="material-input"
        />
        <button
          type="button"
          className="btn-primary"
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
        >
          {uploading ? 'Uploading…' : 'Choose files to upload'}
        </button>
      </div>

      {errors.length > 0 && (
        <div className="form-error" role="alert">
          {errors.map((msg) => (
            <p key={msg}>{msg}</p>
          ))}
        </div>
      )}

      {loadError ? (
        <p className="form-error" role="alert">
          Could not load the case file. {loadError}
        </p>
      ) : !materials ? (
        <p className="muted">Loading the case file…</p>
      ) : materials.length === 0 ? (
        <p className="muted">No files uploaded yet. Start with the fact pattern.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col">Type</th>
                <th scope="col">Visible to</th>
                <th scope="col">Added</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {materials.map((m) => (
                <tr key={m.id}>
                  <td>
                    <a href={service.materialDownloadUrl(courseId, caseId, m.id)} download>
                      {m.filename}
                    </a>
                    <small className="muted content-meta">
                      {formatSize(m.sizeBytes)}
                      {m.description && ` · ${m.description}`}
                    </small>
                  </td>
                  <td>{fileTypeLabel(m.contentType)}</td>
                  <td>
                    <select
                      className="inline-select"
                      value={m.audience}
                      onChange={(e) => handleAudience(m, e.target.value as Audience)}
                      aria-label={`Who can see ${m.filename}`}
                    >
                      {AUDIENCES.map((a) => (
                        <option key={a} value={a}>
                          {AUDIENCE_LABEL[a]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{shortDate(m.uploadedAt)}</td>
                  <td className="cell-actions">
                    <button
                      type="button"
                      className="btn-danger"
                      onClick={() => handleDelete(m)}
                      aria-label={`Delete ${m.filename}`}
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
