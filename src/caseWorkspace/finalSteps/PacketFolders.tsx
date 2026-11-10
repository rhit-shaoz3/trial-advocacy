import { useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, FileText, FolderPlus, RotateCcw, Trash2, X } from 'lucide-react'
import type { PacketContents, PacketFolder } from '../../courses/types'
import { defaultFolders } from './defaultFolders'
import './exhibits.css'

/** `list` with the entry at `from` moved by `by` (one up or down). */
function shift<T>(list: T[], from: number, by: -1 | 1) {
  const to = from + by
  if (to < 0 || to >= list.length) return list
  const next = [...list]
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}

/** A name for a new folder that no other folder has. */
function newFolderName(folders: PacketFolder[]) {
  const taken = new Set(folders.map((f) => f.name.toLowerCase()))
  for (let n = 1; ; n++) {
    const name = n === 1 ? 'New folder' : `New folder ${n}`
    if (!taken.has(name.toLowerCase())) return name
  }
}

/**
 * The team's PDF for court, in folders: the team names and orders the
 * folders, and files the documents it wants in each. What isn't filed stays
 * out of the PDF, and the folders become its table of contents. Audio, video
 * and the like have no pages, so they stay in the zip. Without `onSave` (the
 * instructor, or a closed case) it's the team's folders as they are.
 */
export function PacketFolders({
  contents,
  pdfUrl,
  onSave,
}: {
  contents: PacketContents
  pdfUrl: string
  /** Keeps the folders for the team; leave out to show them read-only. */
  onSave?(folders: PacketFolder[]): Promise<void>
}) {
  const [folders, setFolders] = useState(contents.folders)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(0)
  const [named, setNamed] = useState<number | null>(null)
  const queue = useRef(Promise.resolve())
  const editable = Boolean(onSave)

  const byId = useMemo(() => new Map(contents.items.map((i) => [i.id, i])), [contents.items])
  const filed = new Set(folders.flatMap((f) => f.items))
  const unfiled = contents.items.filter((i) => !filed.has(i.id))
  const documents = filed.size

  function change(next: PacketFolder[]) {
    setFolders(next)
    setError(null)
    if (!onSave) return
    setSaving((n) => n + 1)
    // One save at a time, so the last change is the one that stays.
    queue.current = queue.current
      .then(() => onSave(next))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Your folders couldn’t be saved.'))
      .finally(() => setSaving((n) => n - 1))
  }

  const setFolder = (index: number, folder: PacketFolder) => change(folders.map((f, i) => (i === index ? folder : f)))

  function rename(index: number, name: string) {
    const clean = name.trim()
    if (clean === folders[index].name) return
    if (!clean) return setError('A folder needs a name.')
    if (folders.some((f, i) => i !== index && f.name.toLowerCase() === clean.toLowerCase())) {
      return setError(`There’s already a folder named “${clean}”.`)
    }
    setFolder(index, { ...folders[index], name: clean })
  }

  function addFolder() {
    setNamed(folders.length)
    change([...folders, { name: newFolderName(folders), items: [] }])
  }

  /** Moves an item into folder `to`, at its end, from wherever it was. */
  function file(id: string, to: number) {
    change(folders.map((f, i) => ({ ...f, items: i === to ? [...f.items.filter((x) => x !== id), id] : f.items.filter((x) => x !== id) })))
  }

  const unfile = (id: string) => change(folders.map((f) => ({ ...f, items: f.items.filter((x) => x !== id) })))

  const sections = [...new Set(unfiled.map((i) => i.section))]

  return (
    <div className="pf">
      {editable && (
        <div className="pf-bar">
          <span className="muted">
            {documents} {documents === 1 ? 'document' : 'documents'} in {folders.length} {folders.length === 1 ? 'folder' : 'folders'}
          </span>
          <button type="button" className="ws-btn ws-btn-secondary" onClick={addFolder}>
            <FolderPlus aria-hidden="true" /> Add folder
          </button>
          <button type="button" className="link-button" onClick={() => change(defaultFolders(contents.items))}>
            <RotateCcw aria-hidden="true" /> Start over
          </button>
        </div>
      )}

      {folders.length === 0 ? (
        <p className="cw-empty">{editable ? 'No folders yet. Add one, then file documents in it.' : 'The team hasn’t filed anything.'}</p>
      ) : (
        <ol className="pf-folders">
          {folders.map((folder, index) => (
            <li key={index} className="pf-folder">
              <div className="pf-folder-head">
                {editable ? (
                  <input
                    className="pf-name"
                    aria-label={`Name of folder ${index + 1}`}
                    defaultValue={folder.name}
                    key={folder.name}
                    autoFocus={named === index}
                    onFocus={(e) => named === index && e.target.select()}
                    onBlur={(e) => {
                      setNamed(null)
                      rename(index, e.target.value)
                      e.target.value = folders[index].name
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  />
                ) : (
                  <h3 className="pf-name-text">{folder.name}</h3>
                )}
                {editable && (
                  <span className="pf-tools">
                    <button type="button" className="pf-icon" aria-label={`Move ${folder.name} up`} disabled={index === 0} onClick={() => change(shift(folders, index, -1))}>
                      <ArrowUp aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="pf-icon"
                      aria-label={`Move ${folder.name} down`}
                      disabled={index === folders.length - 1}
                      onClick={() => change(shift(folders, index, 1))}
                    >
                      <ArrowDown aria-hidden="true" />
                    </button>
                    <button type="button" className="pf-icon" aria-label={`Delete ${folder.name}`} onClick={() => change(folders.filter((_, i) => i !== index))}>
                      <Trash2 aria-hidden="true" />
                    </button>
                  </span>
                )}
              </div>
              {folder.items.length === 0 ? (
                <p className="pf-empty muted">{editable ? 'Empty. File documents in it from the list below.' : 'Empty.'}</p>
              ) : (
                <ol className="pf-docs">
                  {folder.items.map((id, at) => {
                    const item = byId.get(id)
                    if (!item) return null
                    return (
                      <li key={id} className="pf-doc">
                        <span className="pf-doc-text">
                          <span>{item.title}</span>
                          <small>{item.section}</small>
                        </span>
                        {editable && (
                          <span className="pf-tools">
                            <button
                              type="button"
                              className="pf-icon"
                              aria-label={`Move ${item.title} up`}
                              disabled={at === 0}
                              onClick={() => setFolder(index, { ...folder, items: shift(folder.items, at, -1) })}
                            >
                              <ArrowUp aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="pf-icon"
                              aria-label={`Move ${item.title} down`}
                              disabled={at === folder.items.length - 1}
                              onClick={() => setFolder(index, { ...folder, items: shift(folder.items, at, 1) })}
                            >
                              <ArrowDown aria-hidden="true" />
                            </button>
                            {folders.length > 1 && (
                              <select
                                className="pf-move"
                                aria-label={`Move ${item.title} to another folder`}
                                value=""
                                onChange={(e) => e.target.value && file(id, Number(e.target.value))}
                              >
                                <option value="">Move to…</option>
                                {folders.map((f, i) =>
                                  i === index ? null : (
                                    <option key={i} value={i}>
                                      {f.name}
                                    </option>
                                  ),
                                )}
                              </select>
                            )}
                            <button type="button" className="pf-icon" aria-label={`Take ${item.title} out of the PDF`} onClick={() => unfile(id)}>
                              <X aria-hidden="true" />
                            </button>
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ol>
              )}
            </li>
          ))}
        </ol>
      )}

      {editable && unfiled.length > 0 && (
        <section className="pf-unfiled" aria-labelledby="pf-unfiled-title">
          <h3 id="pf-unfiled-title">Not in the PDF</h3>
          {sections.map((section) => (
            <div key={section} className="pf-group">
              <h4>{section}</h4>
              <ul className="pf-docs">
                {unfiled
                  .filter((i) => i.section === section)
                  .map((item) => (
                    <li key={item.id} className={item.printable ? 'pf-doc' : 'pf-doc pf-doc-off'}>
                      <span className="pf-doc-text">
                        <span>{item.title}</span>
                      </span>
                      {!item.printable ? (
                        <small>Zip only</small>
                      ) : folders.length === 0 ? null : (
                        <select
                          className="pf-move"
                          aria-label={`File ${item.title} in a folder`}
                          value=""
                          onChange={(e) => e.target.value && file(item.id, Number(e.target.value))}
                        >
                          <option value="">File in…</option>
                          {folders.map((f, i) => (
                            <option key={i} value={i}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="pf-actions">
        {saving > 0 ? (
          <span className="muted" role="status">
            Saving…
          </span>
        ) : documents === 0 ? (
          <span className="muted">File at least one document in a folder for the PDF.</span>
        ) : (
          <a className="ws-btn ws-btn-primary tp-download" href={pdfUrl} download>
            <FileText aria-hidden="true" /> Download PDF
          </a>
        )}
      </div>
    </div>
  )
}
