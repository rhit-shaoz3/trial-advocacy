import { Fragment, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { Upload, X } from 'lucide-react'
import { useCourseService } from '../../../courses/CourseServiceContext'
import { AUDIENCE_LABEL, fileTypeLabel, formatSize, shortDate } from '../../../courses/caseLabels'
import {
  MATERIAL_AUDIENCES,
  type CaseMaterial,
  type CaseTeams,
  type MaterialAudience,
  type MaterialShares,
} from '../../../courses/types'
import { sharesLabel } from './shares'
import { SharePicker } from './SharePicker'

const MAX_BYTES = 100 * 1024 * 1024 // matches the server's limit
const ACCEPT = [
  '.pdf,.doc,.docx,.txt', // documents
  '.png,.jpg,.jpeg,.gif,.webp', // images
  '.mp3,.m4a,.wav', // audio
  '.mp4,.mov,.webm', // video
].join(',')

/** How often the list refreshes while files are still being transcribed. */
const POLL_MS = 5000

/** A file waiting to be uploaded, with the label and audience the instructor picks for it. */
interface QueuedFile {
  key: number
  file: File
  label: string
  audience: MaterialAudience
}

let nextKey = 0
/** "Ride log (March).pdf" → "Ride log (March)" */
const defaultLabel = (filename: string) => filename.replace(/\.[^.]+$/, '') || filename

/** The audience select's extra choice: instructors only, plus the worlds and teams picked. */
const SPECIFIC = 'specific'

/**
 * The case file: the pieces of the fact pattern (documents, images, audio,
 * video), each shown to everyone in the case, only to one side, or only to
 * instructors, and on top of that to particular case worlds or teams. Every
 * file is also transcribed for the AI witnesses to read.
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
  // Teams start from the initial file and ask for the rest, so new files stay with the instructor.
  const [audience, setAudience] = useState<MaterialAudience>('instructor')
  const [retrying, setRetrying] = useState<string | null>(null)
  const [queued, setQueued] = useState<QueuedFile[]>([])
  const [dragging, setDragging] = useState(false)
  /** The case's teams and worlds, for sharing files with them. */
  const [teams, setTeams] = useState<CaseTeams | null>(null)
  /** The file whose sharing is being edited. */
  const [sharing, setSharing] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    service
      .listTeams(courseId, caseId)
      .then((t) => !cancelled && setTeams(t))
      .catch(() => {}) // sharing just isn't offered
    return () => {
      cancelled = true
    }
  }, [service, courseId, caseId])

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

  /** Adds chosen or dropped files to the list to label; nothing uploads until "Upload". */
  function addFiles(files: File[]) {
    if (files.length === 0) return
    const tooLarge = files.filter((f) => f.size > MAX_BYTES)
    setErrors(tooLarge.map((f) => `${f.name}: That file is too large. The limit is 100 MB.`))
    const accepted = files.filter((f) => f.size <= MAX_BYTES)
    setQueued((prev) => [
      ...prev,
      ...accepted.map((file) => ({ key: nextKey++, file, label: defaultLabel(file.name), audience })),
    ])
  }

  function handleChosen(e: ChangeEvent<HTMLInputElement>) {
    const chosen = [...(e.target.files ?? [])]
    e.target.value = '' // so choosing the same file again still fires a change
    addFiles(chosen)
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    if (!uploading) addFiles([...e.dataTransfer.files])
  }

  const updateQueued = (key: number, fields: Partial<QueuedFile>) =>
    setQueued((prev) => prev.map((p) => (p.key === key ? { ...p, ...fields } : p)))

  /** Uploads every listed file with its own label and audience. Files that fail stay listed. */
  async function handleUpload() {
    setErrors([])
    setUploading(true)
    const failures: string[] = []
    for (const item of queued) {
      try {
        const uploaded = await service.uploadMaterial(courseId, caseId, item.file, {
          audience: item.audience,
          description: item.label.trim(),
        })
        setMaterials((prev) => [...(prev ?? []), uploaded])
        setQueued((prev) => prev.filter((p) => p.key !== item.key))
      } catch (err) {
        failures.push(`${item.file.name}: ${err instanceof Error ? err.message : 'Upload failed.'}`)
      }
    }
    setErrors(failures)
    setUploading(false)
    onChange?.()
  }

  const unlabeled = queued.some((p) => !p.label.trim())

  async function handleAudience(material: CaseMaterial, choice: MaterialAudience | typeof SPECIFIC) {
    setErrors([])
    // Specific worlds or teams: only instructors see it, plus whoever is picked.
    if (choice === SPECIFIC) setSharing(material.id)
    const next = choice === SPECIFIC ? 'instructor' : choice
    if (next === material.audience) return
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

  async function handleShares(material: CaseMaterial, shares: MaterialShares) {
    const updated = await service.setMaterialShares(courseId, caseId, material.id, shares)
    setMaterials((prev) => prev?.map((m) => (m.id === updated.id ? updated : m)) ?? null)
    setSharing(null)
    onChange?.()
  }

  async function handleInitial(material: CaseMaterial) {
    setErrors([])
    try {
      setMaterials(await service.setInitialMaterial(courseId, caseId, material.id))
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
        video, up to 100 MB each). Drag files in or choose them, then give each one a label: students
        see it as the file&rsquo;s title. Make one file the <strong>initial file</strong>, such as the
        complaint: every team starts from it on their Overview. The rest stay with instructors until a
        team asks for them; then change who can see the file, and it appears in that side&rsquo;s Case
        file tab. Keep witnesses&rsquo; depositions to instructors only, so the AI witness can read them
        but students can&rsquo;t. Each file is transcribed for the AI witnesses once it&rsquo;s uploaded.
      </p>

      <div
        className={`panel-form content-form upload-drop${dragging ? ' upload-drop-over' : ''}`}
        role="group"
        aria-label="Upload to the case file"
        data-testid="material-drop"
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
        }}
        onDrop={handleDrop}
      >
        <p className="upload-drop-prompt">
          <Upload aria-hidden="true" />
          Drag files here, or choose them.
        </p>
        <label>
          Visible to (new files)
          <select value={audience} onChange={(e) => setAudience(e.target.value as MaterialAudience)}>
            {MATERIAL_AUDIENCES.map((a) => (
              <option key={a} value={a}>
                {AUDIENCE_LABEL[a]}
              </option>
            ))}
          </select>
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
          className="btn-secondary"
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
        >
          Choose files
        </button>
      </div>

      {queued.length > 0 && (
        <section className="upload-queue" aria-labelledby="upload-queue-heading">
          <h3 id="upload-queue-heading">Ready to upload ({queued.length})</h3>
          <ul>
            {queued.map((p) => (
              <li key={p.key}>
                <span className="upload-queue-file">
                  {p.file.name}
                  <small className="muted">{formatSize(p.file.size)}</small>
                </span>
                <input
                  type="text"
                  value={p.label}
                  onChange={(e) => updateQueued(p.key, { label: e.target.value })}
                  aria-label={`Label for ${p.file.name}`}
                  aria-invalid={!p.label.trim()}
                  placeholder="Label (required)"
                  maxLength={400}
                  required
                  disabled={uploading}
                />
                <select
                  className="inline-select"
                  value={p.audience}
                  onChange={(e) => updateQueued(p.key, { audience: e.target.value as MaterialAudience })}
                  aria-label={`Who will see ${p.file.name}`}
                  disabled={uploading}
                >
                  {MATERIAL_AUDIENCES.map((a) => (
                    <option key={a} value={a}>
                      {AUDIENCE_LABEL[a]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setQueued((prev) => prev.filter((x) => x.key !== p.key))}
                  aria-label={`Remove ${p.file.name}`}
                  title="Remove"
                  disabled={uploading}
                >
                  <X aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <div className="upload-queue-actions">
            <button type="button" className="btn-primary" onClick={handleUpload} disabled={uploading || unlabeled}>
              {uploading
                ? 'Uploading…'
                : queued.length === 1
                  ? 'Upload 1 file'
                  : `Upload ${queued.length} files`}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setQueued([])} disabled={uploading}>
              Clear
            </button>
            {unlabeled && <span className="muted">Give every file a label to upload.</span>}
          </div>
        </section>
      )}

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
                <th scope="col">AI text</th>
                <th scope="col">Added</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {materials.map((m) => (
                <Fragment key={m.id}>
                  <tr>
                    <td>
                      <a href={service.materialDownloadUrl(courseId, caseId, m.id)} download>
                        {m.filename}
                      </a>
                      <small className="muted content-meta">
                        {formatSize(m.sizeBytes)}
                        {m.description && ` · ${m.description}`}
                      </small>
                      {m.initial ? (
                        <span className="badge badge-case-active badge-initial">Initial file</span>
                      ) : (
                        <button
                          type="button"
                          className="link-button content-meta"
                          onClick={() => handleInitial(m)}
                          aria-label={`Make ${m.filename} the initial file`}
                        >
                          Make initial file
                        </button>
                      )}
                    </td>
                    <td>{fileTypeLabel(m.contentType)}</td>
                    <td>
                      <select
                        className="inline-select"
                        value={m.audience}
                        onChange={(e) => handleAudience(m, e.target.value as MaterialAudience | typeof SPECIFIC)}
                        aria-label={`Who can see ${m.filename}`}
                        // Every team starts from the initial file, so everyone sees it.
                        disabled={m.initial}
                        title={m.initial ? 'Every team sees the initial file.' : undefined}
                      >
                        {MATERIAL_AUDIENCES.map((a) => (
                          <option key={a} value={a}>
                            {AUDIENCE_LABEL[a]}
                          </option>
                        ))}
                        {teams && <option value={SPECIFIC}>Specific worlds or teams…</option>}
                      </select>
                      {sharesLabel(teams, m.shares) && (
                        <small className="share-chips">Also {sharesLabel(teams, m.shares)}</small>
                      )}
                      {teams && !m.initial && sharing !== m.id && (
                        <button
                          type="button"
                          className="link-button content-meta"
                          onClick={() => setSharing(m.id)}
                          aria-label={`Share ${m.filename} with worlds or teams`}
                        >
                          Share with worlds or teams
                        </button>
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
                  {sharing === m.id && teams && (
                    <tr className="share-row">
                      <td colSpan={6}>
                        <SharePicker
                          material={m}
                          teams={teams}
                          onSave={(shares) => handleShares(m, shares)}
                          onCancel={() => setSharing(null)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
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
