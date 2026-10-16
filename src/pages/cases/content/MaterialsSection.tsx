import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useCourseService } from '../../../courses/CourseServiceContext'
import { AUDIENCE_LABEL, fileTypeLabel, formatSize, shortDate } from '../../../courses/caseLabels'
import { MATERIAL_AUDIENCES, type CaseMaterial, type MaterialAudience } from '../../../courses/types'
import { PublishToggle } from './PublishToggle'

const MAX_BYTES = 100 * 1024 * 1024 // matches the server's limit
const ACCEPT = [
  '.pdf,.doc,.docx,.txt', // documents
  '.png,.jpg,.jpeg,.gif,.webp', // images
  '.mp3,.m4a,.wav', // audio
  '.mp4,.mov,.webm', // video
].join(',')

/** How often the list refreshes while files are still being transcribed. */
const POLL_MS = 5000

/**
 * The case file: the pieces of the fact pattern (documents, images, audio,
 * video), each shown to everyone in the case, only to one side, or only to
 * instructors. Every file is also transcribed for the AI witnesses to read.
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
  const [audience, setAudience] = useState<MaterialAudience>('all')
  const [retrying, setRetrying] = useState<string | null>(null)
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

  // Transcription runs in the background after an upload; check back until it's done.
  const pending = materials?.some((m) => m.textStatus === 'pending') ?? false
  useEffect(() => {
    if (!pending) return
    const timer = setInterval(() => {
      service
        .listMaterials(courseId, caseId)
        .then(setMaterials)
        .catch(() => {}) // keep the current list; the next tick tries again
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [service, courseId, caseId, pending])

  async function handleRetry(material: CaseMaterial) {
    setErrors([])
    setRetrying(material.id)
    try {
      const updated = await service.retryTranscription(courseId, caseId, material.id)
      setMaterials((prev) => prev?.map((m) => (m.id === updated.id ? updated : m)) ?? null)
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'Something went wrong.'])
    } finally {
      setRetrying(null)
    }
  }

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

  async function handleAudience(material: CaseMaterial, next: MaterialAudience) {
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

  async function handlePublished(material: CaseMaterial, published: boolean) {
    setErrors([])
    try {
      const updated = await service.setMaterialPublished(courseId, caseId, material.id, published)
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
        Case file tab, grouped by type. Choose who can see each file: keep a witness&rsquo;s deposition
        to instructors only, so the AI witness can read it but students can&rsquo;t. New files are
        drafts: students see a file once you publish it. Each file is transcribed for the AI
        witnesses once it&rsquo;s uploaded.
      </p>

      <div className="panel-form content-form" role="group" aria-label="Upload to the case file">
        <label>
          Visible to
          <select value={audience} onChange={(e) => setAudience(e.target.value as MaterialAudience)}>
            {MATERIAL_AUDIENCES.map((a) => (
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
                <th scope="col">Students</th>
                <th scope="col">AI text</th>
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
                      onChange={(e) => handleAudience(m, e.target.value as MaterialAudience)}
                      aria-label={`Who can see ${m.filename}`}
                    >
                      {MATERIAL_AUDIENCES.map((a) => (
                        <option key={a} value={a}>
                          {AUDIENCE_LABEL[a]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {m.audience === 'instructor' ? (
                      <span className="muted">Never shown</span>
                    ) : (
                      <PublishToggle
                        label={m.filename}
                        published={m.published}
                        onChange={(next) => handlePublished(m, next)}
                      />
                    )}
                  </td>
                  <td>
                    <TextStatusCell
                      material={m}
                      textUrl={service.materialTextUrl(courseId, caseId, m.id)}
                      retrying={retrying === m.id}
                      onRetry={() => handleRetry(m)}
                    />
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

/** Whether the AI witnesses can read the file yet, with its transcription to check. */
function TextStatusCell({
  material: m,
  textUrl,
  retrying,
  onRetry,
}: {
  material: CaseMaterial
  textUrl: string
  retrying: boolean
  onRetry(): void
}) {
  if (retrying || m.textStatus === 'pending') return <span className="muted">Reading…</span>
  if (m.textStatus === 'none') return <span className="muted">Nothing to read</span>
  if (m.textStatus === 'ready') {
    return (
      <a href={textUrl} target="_blank" rel="noreferrer" aria-label={`View the text of ${m.filename}`}>
        View text
      </a>
    )
  }
  return (
    <span className="content-text-failed">
      <span className="form-error">{m.textError ?? 'Could not read this file.'}</span>{' '}
      <button type="button" className="link-button" onClick={onRetry} aria-label={`Read ${m.filename} again`}>
        Retry
      </button>
    </span>
  )
}
