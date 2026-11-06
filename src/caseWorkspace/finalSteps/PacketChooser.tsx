import { useMemo, useRef, useState } from 'react'
import { FileText } from 'lucide-react'
import type { PacketContents, PacketItem } from '../../courses/types'
import './exhibits.css'

/**
 * Picks what goes in a team's single PDF: everything the packet holds, by
 * section. What's chosen becomes the PDF's table of contents. Audio, video and
 * the like have no pages, so they stay in the zip.
 */
export function PacketChooser({
  contents,
  pdfUrl,
  onSave,
}: {
  contents: PacketContents
  pdfUrl(leftOut: string[]): string
  /** Keeps the choices; leave out when they're only for this download. */
  onSave?(leftOut: string[]): Promise<void>
}) {
  const [leftOut, setLeftOut] = useState(() => new Set(contents.leftOut))
  const [error, setError] = useState<string | null>(null)
  const saving = useRef(Promise.resolve())

  const sections = useMemo(() => {
    const bySection = new Map<string, PacketItem[]>()
    for (const item of contents.items) bySection.set(item.section, [...(bySection.get(item.section) ?? []), item])
    return [...bySection]
  }, [contents.items])

  const printable = contents.items.filter((i) => i.printable)
  const chosen = printable.filter((i) => !leftOut.has(i.id))
  // Only what's in this packet: a choice can outlive the file it was about.
  const left = printable.filter((i) => leftOut.has(i.id)).map((i) => i.id)

  function choose(next: Set<string>) {
    setLeftOut(next)
    setError(null)
    if (!onSave) return
    // One save at a time, so the last choice is the one that stays.
    saving.current = saving.current.then(() =>
      onSave([...next]).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Your choices couldn’t be saved.')),
    )
  }

  function toggle(id: string, on: boolean) {
    const next = new Set(leftOut)
    if (on) next.delete(id)
    else next.add(id)
    choose(next)
  }

  return (
    <div className="tp-chooser">
      <div className="tp-chooser-bar">
        <span className="muted">
          {chosen.length} of {printable.length} chosen
        </span>
        <button type="button" className="link-button" onClick={() => choose(new Set())}>
          Choose all
        </button>
        <button type="button" className="link-button" onClick={() => choose(new Set(printable.map((i) => i.id)))}>
          Clear
        </button>
      </div>
      {sections.map(([section, items]) => (
        <fieldset key={section} className="tp-group">
          <legend>{section}</legend>
          {items.map((item) => (
            <label key={item.id} className={item.printable ? 'tp-item' : 'tp-item tp-item-off'}>
              <input
                type="checkbox"
                checked={item.printable && !leftOut.has(item.id)}
                disabled={!item.printable}
                onChange={(e) => toggle(item.id, e.target.checked)}
              />
              <span>{item.title}</span>
              {!item.printable && <small>Zip only</small>}
            </label>
          ))}
        </fieldset>
      ))}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="tp-chooser-actions">
        {chosen.length === 0 ? (
          <span className="muted">Choose at least one thing for the PDF.</span>
        ) : (
          <a className="ws-btn ws-btn-primary tp-download" href={pdfUrl(left)} download>
            <FileText aria-hidden="true" /> Download PDF
          </a>
        )}
      </div>
    </div>
  )
}
