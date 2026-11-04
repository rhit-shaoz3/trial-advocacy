import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Highlighter, X } from 'lucide-react'
import { Modal } from '../Modal'
import type {
  ExhibitPart,
  PageRedactionMarks,
  RedactionBox,
  RedactionMarks,
  RedactionMode,
  TextRedactionMarks,
  TextRedactionRange,
} from '../../courses/types'
import { buildRedactedImage, buildRedactedPdf, planPages, redactParts } from './redactFile'
import { useFilePages } from './useFilePages'
import './redaction.css'

/** What was marked, ready to use. */
export interface MarkedRedaction {
  marks: RedactionMarks
  uploadKey?: string
  /** "Admits 2 of 5 pages", to show beside it. */
  summary: string
}

type PageMark = { removed: boolean; boxes: RedactionBox[] }
type PartMark = { removed: boolean; ranges: TextRedactionRange[] }

/** The words for the judge's partial admission, or for a team blacking out its own exhibit. */
const WORDS = {
  judge: {
    title: 'Mark the redaction',
    modes: { redact: 'Mark what’s redacted', admit: 'Mark what’s admitted' },
    preview: 'Show what’s admitted',
    kept: 'admitted',
    keeps: 'Admits',
    nothing: 'Mark what’s redacted or what’s admitted.',
    empty: 'Nothing is left to admit. To keep the whole exhibit out, sustain the objection instead.',
    cantShow: 'The exhibit couldn’t be shown for marking. Describe the redaction instead.',
    save: 'Use these marks',
  },
  team: {
    title: 'Black out parts',
    modes: { redact: 'Mark what to black out', admit: 'Mark what to keep' },
    preview: 'Show your copy',
    kept: 'kept',
    keeps: 'Keeps',
    nothing: 'Mark what to black out or what to keep.',
    empty: 'Nothing is left. To leave it all out, take it off your list.',
    cantShow: 'This file couldn’t be shown here. List it as it is, or only some of its pages.',
    save: 'Use this copy',
  },
}
type Words = (typeof WORDS)['judge']

const help = (w: Words, mode: RedactionMode, text: boolean) =>
  mode === 'redact'
    ? text
      ? 'Select text, then choose Mark. Marked text is blacked out. Leave out a turn or paragraph to take it out entirely.'
      : 'Drag a box over each part to black out. Leave out a page to take it out entirely.'
    : text
      ? `Select text, then choose Mark. Only marked text is ${w.kept}; the rest is blacked out, and a part with nothing marked is left out.`
      : `Drag a box over each part that’s ${w.kept}. Everything else on the page is blacked out, and a page with no box is left out.`

/**
 * Marks on an exhibit itself: boxes on a PDF's pages or a picture, or ranges
 * of a transcript's or text's text, showing either what's blacked out or
 * what's kept. The instructor marks a partial admission; a team blacks out
 * parts of a file it lists (`team`). Saving a PDF or picture makes the
 * blacked-out copy and uploads it.
 */
export function RedactionEditor({
  eyebrow,
  marking,
  loadFile,
  upload,
  deposition = false,
  team = false,
  initial,
  onSave,
  onClose,
}: {
  eyebrow: string
  marking: { markable: 'pdf' | 'image' | 'text'; parts: ExhibitPart[] | null }
  /** A PDF's or picture's bytes, as they'd be served (only the listed pages). */
  loadFile?(): Promise<Uint8Array>
  /** Uploads the blacked-out copy of a PDF or picture; returns its key. */
  upload?(file: Blob): Promise<string>
  /** A transcript's turns, with their questions, rather than paragraphs. */
  deposition?: boolean
  /** A team blacking out its own exhibit, rather than the judge's ruling. */
  team?: boolean
  /** The marks from before, when editing them again. */
  initial?: RedactionMarks
  onSave(marked: MarkedRedaction): void
  onClose(): void
}) {
  const words = team ? WORDS.team : WORDS.judge
  const [mode, setMode] = useState<RedactionMode>(initial?.mode ?? 'redact')
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isText = marking.markable === 'text'

  const [pageMarks, setPageMarks] = useState<Map<number, PageMark>>(
    () => new Map(initial && 'pages' in initial ? initial.pages.map((p) => [p.page, { removed: p.removed, boxes: p.boxes }]) : []),
  )
  const [partMarks, setPartMarks] = useState<Map<number, PartMark>>(
    () => new Map(initial && 'parts' in initial ? initial.parts.map((p) => [p.n, { removed: p.removed, ranges: p.ranges }]) : []),
  )

  // A PDF's pages (or the picture), drawn for marking.
  const { pages, bytes, loadError } = useFilePages(isText ? null : (loadFile ?? null), marking.markable === 'pdf', words.cantShow)

  const pageMarksOut: PageRedactionMarks = {
    mode,
    pages: [...pageMarks].map(([page, m]) => ({ page, ...m })).filter((p) => p.removed || p.boxes.length > 0),
  }
  const textMarksOut: TextRedactionMarks = {
    mode,
    parts: [...partMarks].map(([n, m]) => ({ n, ...m })).filter((p) => p.removed || p.ranges.length > 0),
  }
  const parts = marking.parts ?? []
  const plan = pages ? planPages(pageMarksOut, pages.length) : []
  const kept = isText ? redactParts(parts, textMarksOut).length : plan.filter((p) => p !== 'drop').length
  const total = isText ? parts.length : (pages?.length ?? 0)
  const anything = isText ? textMarksOut.parts.length > 0 : pageMarksOut.pages.length > 0
  const noun = isText ? (deposition ? 'turns' : 'paragraphs') : marking.markable === 'image' ? 'pictures' : 'pages'
  const summary = `${words.keeps} ${kept} of ${total} ${noun}${isText ? '' : `, ${plan.filter((p) => p === 'black').length} with black-outs`}`
  const problem = !anything ? words.nothing : kept === 0 ? words.empty : null

  async function save() {
    setSaving(true)
    setError(null)
    try {
      if (isText) {
        onSave({ marks: textMarksOut, summary })
        return
      }
      const file = marking.markable === 'pdf' ? await buildRedactedPdf(bytes!, pageMarksOut) : await buildRedactedImage(bytes!, pageMarksOut)
      const uploadKey = await upload!(file)
      onSave({ marks: pageMarksOut, uploadKey, summary })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setSaving(false)
    }
  }

  const setPage = (page: number, change: Partial<PageMark>) =>
    setPageMarks((prev) =>
      new Map(prev).set(page, {
        removed: false,
        boxes: [],
        ...prev.get(page),
        ...change,
      }),
    )
  const setPart = (n: number, change: Partial<PartMark>) =>
    setPartMarks((prev) =>
      new Map(prev).set(n, {
        removed: false,
        ranges: [],
        ...prev.get(n),
        ...change,
      }),
    )

  return (
    <Modal
      wide
      eyebrow={eyebrow}
      title={words.title}
      icon={<Highlighter />}
      onClose={onClose}
      footer={
        <>
          <span className="rx-summary muted" role="status">
            {error ?? (total ? (problem ?? summary) : '')}
          </span>
          <button type="button" className="ws-btn ws-btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="ws-btn ws-btn-primary"
            onClick={save}
            disabled={saving || Boolean(problem) || (!isText && !bytes)}
          >
            {saving ? (isText ? 'Saving…' : 'Making the blacked-out copy…') : words.save}
          </button>
        </>
      }
    >
      <div className="rx">
        <div className="rx-toolbar">
          <div className="ex-segments" role="radiogroup" aria-label="What you mark">
            <button type="button" role="radio" aria-checked={mode === 'redact'} onClick={() => setMode('redact')}>
              {words.modes.redact}
            </button>
            <button type="button" role="radio" aria-checked={mode === 'admit'} onClick={() => setMode('admit')}>
              {words.modes.admit}
            </button>
          </div>
          <label className="rx-preview-toggle">
            <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} />
            {words.preview}
          </label>
        </div>
        <p className="muted rx-help">{help(words, mode, isText)}</p>

        {isText ? (
          <TextMarker
            parts={parts}
            marks={partMarks}
            mode={mode}
            preview={preview}
            deposition={deposition}
            kept={words.kept}
            onChange={setPart}
          />
        ) : loadError ? (
          <p className="form-error" role="alert">
            {loadError}
          </p>
        ) : !pages ? (
          <p className="muted">Loading the exhibit…</p>
        ) : (
          <ol className="rx-pages">
            {pages.map((src, i) => (
              <PageMarker
                key={i}
                page={i + 1}
                total={pages.length}
                src={src}
                mark={pageMarks.get(i + 1) ?? { removed: false, boxes: [] }}
                mode={mode}
                preview={preview}
                picture={marking.markable === 'image'}
                kept={words.kept}
                onChange={(change) => setPage(i + 1, change)}
              />
            ))}
          </ol>
        )}
      </div>
    </Modal>
  )
}

const clamp = (n: number) => Math.min(1, Math.max(0, n))

/** One page: drag to draw a box; each box can be removed; the page can be left out. */
function PageMarker({
  page,
  total,
  src,
  mark,
  mode,
  preview,
  picture,
  kept,
  onChange,
}: {
  page: number
  total: number
  src: string
  mark: PageMark
  mode: RedactionMode
  preview: boolean
  picture: boolean
  /** "admitted" or "kept", for what a page with no box is left out for lacking. */
  kept: string
  onChange(change: Partial<PageMark>): void
}) {
  const overlay = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<{
    x0: number
    y0: number
    box: RedactionBox
  } | null>(null)
  const dropped = mark.removed || (mode === 'admit' && mark.boxes.length === 0)
  const name = picture ? 'the picture' : `page ${page} of ${total}`

  function at(e: ReactPointerEvent) {
    const r = overlay.current!.getBoundingClientRect()
    return {
      x: clamp((e.clientX - r.left) / r.width),
      y: clamp((e.clientY - r.top) / r.height),
    }
  }
  function down(e: ReactPointerEvent) {
    if (preview || mark.removed || e.button !== 0 || e.target !== overlay.current) return
    const p = at(e)
    overlay.current!.setPointerCapture(e.pointerId)
    setDraft({ x0: p.x, y0: p.y, box: { x: p.x, y: p.y, w: 0, h: 0 } })
  }
  function move(e: ReactPointerEvent) {
    if (!draft) return
    const p = at(e)
    setDraft({
      ...draft,
      box: {
        x: Math.min(draft.x0, p.x),
        y: Math.min(draft.y0, p.y),
        w: Math.abs(p.x - draft.x0),
        h: Math.abs(p.y - draft.y0),
      },
    })
  }
  function up() {
    if (!draft) return
    if (draft.box.w > 0.01 && draft.box.h > 0.01) onChange({ boxes: [...mark.boxes, draft.box] })
    setDraft(null)
  }
  const shown = draft ? [...mark.boxes, draft.box] : mark.boxes
  const removeBox = (i: number) => onChange({ boxes: mark.boxes.filter((_, j) => j !== i) })

  return (
    <li className={`rx-page${dropped ? ' rx-page-dropped' : ''}`}>
      <div className="rx-page-head">
        <strong>{picture ? 'The picture' : `Page ${page}`}</strong>
        {!picture && (
          <label>
            <input type="checkbox" checked={mark.removed} onChange={(e) => onChange({ removed: e.target.checked })} />
            Leave out this page
          </label>
        )}
        {dropped && <span className="cw-badge xl-badge-rose">{mark.removed ? 'Left out' : `Left out: nothing marked ${kept}`}</span>}
      </div>
      <div className="rx-sheet">
        <img src={src} alt={`The exhibit, ${name}`} draggable={false} />
        <svg className="rx-paint" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
          {mode === 'admit' ? (
            <>
              <defs>
                <mask id={`rx-mask-${page}`}>
                  <rect width="1" height="1" fill="#fff" />
                  {shown.map((b, i) => (
                    <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill="#000" />
                  ))}
                </mask>
              </defs>
              <rect width="1" height="1" className={preview ? 'rx-black' : 'rx-shade'} mask={`url(#rx-mask-${page})`} />
              {!preview && shown.map((b, i) => <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} className="rx-keep" />)}
            </>
          ) : (
            shown.map((b, i) => <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} className={preview ? 'rx-black' : 'rx-cover'} />)
          )}
        </svg>
        <div
          ref={overlay}
          className="rx-draw"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={() => setDraft(null)}
        >
          {!preview &&
            !mark.removed &&
            mark.boxes.map((b, i) => (
              <button
                key={i}
                type="button"
                className="rx-box-remove"
                style={{ left: `${(b.x + b.w) * 100}%`, top: `${b.y * 100}%` }}
                aria-label={`Remove box ${i + 1} on ${name}`}
                onClick={() => removeBox(i)}
              >
                <X aria-hidden="true" />
              </button>
            ))}
        </div>
        {preview && dropped && <div className="rx-sheet-out">Not in the admitted exhibit</div>}
      </div>
    </li>
  )
}

/** Where `range` falls within `el`'s text, or null if it misses it. */
function offsetsIn(el: HTMLElement, range: Range) {
  if (!range.intersectsNode(el)) return null
  const whole = document.createRange()
  whole.selectNodeContents(el)
  const upTo = (node: Node, offset: number) => {
    const r = document.createRange()
    r.selectNodeContents(el)
    r.setEnd(node, offset)
    return r.toString().length
  }
  const start = range.compareBoundaryPoints(Range.START_TO_START, whole) > 0 ? upTo(range.startContainer, range.startOffset) : 0
  const end =
    range.compareBoundaryPoints(Range.END_TO_END, whole) < 0 ? upTo(range.endContainer, range.endOffset) : (el.textContent ?? '').length
  return start < end ? { start, end } : null
}

/** A transcript's turns or a report's or file's paragraphs: select text and mark it, or leave a part out. */
function TextMarker({
  parts,
  marks,
  mode,
  preview,
  deposition,
  kept,
  onChange,
}: {
  parts: ExhibitPart[]
  marks: Map<number, PartMark>
  mode: RedactionMode
  preview: boolean
  deposition: boolean
  kept: string
  onChange(n: number, change: Partial<PartMark>): void
}) {
  const box = useRef<HTMLOListElement>(null)
  const [selected, setSelected] = useState(false)
  const admitted = new Map(
    redactParts(parts, {
      mode,
      parts: [...marks].map(([n, m]) => ({ n, ...m })),
    }).map((p) => [p.n, p]),
  )

  function checkSelection() {
    const s = window.getSelection()
    setSelected(Boolean(s && !s.isCollapsed && box.current && s.rangeCount > 0 && s.getRangeAt(0).intersectsNode(box.current)))
  }

  function markSelection() {
    const s = window.getSelection()
    if (!s || s.isCollapsed || s.rangeCount === 0 || !box.current) return
    const range = s.getRangeAt(0)
    // A selection can run across fields and parts: gather each part's new marks, then add them at once.
    const added = new Map<number, TextRedactionRange[]>()
    for (const el of box.current.querySelectorAll<HTMLElement>('[data-field]')) {
      const hit = offsetsIn(el, range)
      if (!hit) continue
      const n = Number(el.dataset.n)
      added.set(n, [...(added.get(n) ?? []), { field: el.dataset.field as 'question' | 'text', ...hit }])
    }
    for (const [n, ranges] of added) onChange(n, { ranges: [...(marks.get(n)?.ranges ?? []), ...ranges] })
    s.removeAllRanges()
    setSelected(false)
  }

  return (
    <>
      {!preview && (
        <div className="rx-mark-bar">
          <button
            type="button"
            className="ws-btn ws-btn-secondary"
            disabled={!selected}
            // Keep the selection: a click would clear it before the button sees it.
            onMouseDown={(e) => e.preventDefault()}
            onClick={markSelection}
          >
            <Highlighter aria-hidden="true" /> Mark
          </button>
          <span className="muted">{selected ? 'Mark the selected text.' : 'Select text below to mark it.'}</span>
        </div>
      )}
      <ol className="rx-parts" ref={box} onMouseUp={checkSelection} onKeyUp={checkSelection}>
        {parts.map((p, i) => {
          const mark = marks.get(p.n) ?? { removed: false, ranges: [] }
          const out = admitted.get(p.n)
          const label = deposition ? `Q&A ${i + 1}` : `Paragraph ${i + 1}`
          return (
            <li key={p.n} className={!out ? 'rx-part rx-part-dropped' : 'rx-part'}>
              <div className="rx-page-head">
                <strong>{label}</strong>
                <label>
                  <input type="checkbox" checked={mark.removed} onChange={(e) => onChange(p.n, { removed: e.target.checked })} />
                  Leave out
                </label>
                {!out && <span className="cw-badge xl-badge-rose">{mark.removed ? 'Left out' : `Left out: nothing marked ${kept}`}</span>}
              </div>
              {preview ? (
                out ? (
                  <PartView part={out} />
                ) : (
                  <p className="muted">Not in the admitted exhibit.</p>
                )
              ) : (
                <div className="xl-turn">
                  {p.question !== undefined && (
                    <span>
                      <strong>Q.</strong>{' '}
                      <MarkedField
                        n={p.n}
                        field="question"
                        text={p.question}
                        mark={mark}
                        mode={mode}
                        onChange={(ranges) => onChange(p.n, { ranges })}
                      />
                    </span>
                  )}
                  {p.objection && <em>Objection: {p.objection}</em>}
                  <span>
                    {p.question !== undefined && <strong>A. </strong>}
                    <MarkedField
                      n={p.n}
                      field="text"
                      text={p.text}
                      mark={mark}
                      mode={mode}
                      onChange={(ranges) => onChange(p.n, { ranges })}
                    />
                  </span>
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </>
  )
}

/** One field's text with its marks highlighted; clicking a mark takes it off. */
function MarkedField({
  n,
  field,
  text,
  mark,
  mode,
  onChange,
}: {
  n: number
  field: 'question' | 'text'
  text: string
  mark: PartMark
  mode: RedactionMode
  onChange(ranges: TextRedactionRange[]): void
}) {
  const mine = mark.ranges.filter((r) => r.field === field)
  // Where each character is marked, to draw runs.
  const on = new Array<boolean>(text.length).fill(false)
  for (const r of mine) for (let i = r.start; i < r.end; i++) on[i] = true
  const runs: { start: number; end: number; marked: boolean }[] = []
  for (let i = 0; i < text.length; i++) {
    const last = runs[runs.length - 1]
    if (last && last.marked === on[i]) last.end = i + 1
    else runs.push({ start: i, end: i + 1, marked: on[i] })
  }
  const unmark = (run: { start: number; end: number }) =>
    onChange(mark.ranges.filter((r) => r.field !== field || r.end <= run.start || r.start >= run.end))
  return (
    <span data-field={field} data-n={n}>
      {runs.map((run) =>
        run.marked ? (
          <mark
            key={run.start}
            className={mode === 'redact' ? 'rx-hl rx-hl-redact' : 'rx-hl rx-hl-admit'}
            title="Click to take off this mark"
            onClick={() => unmark(run)}
          >
            {text.slice(run.start, run.end)}
          </mark>
        ) : (
          text.slice(run.start, run.end)
        ),
      )}
    </span>
  )
}

function Bars({ text }: { text: string }) {
  return text.split(/(█+)/).map((run, i) =>
    run.startsWith('█') ? (
      <span key={i} className="xl-bar" role="img" aria-label="redacted">
        {run}
      </span>
    ) : (
      run
    ),
  )
}

function PartView({ part }: { part: ExhibitPart }) {
  return (
    <div className="xl-turn">
      {part.question !== undefined && (
        <span>
          <strong>Q.</strong> <Bars text={part.question} />
        </span>
      )}
      {part.objection && <em>Objection: {part.objection}</em>}
      <span>
        {part.question !== undefined && <strong>A. </strong>}
        <Bars text={part.text} />
      </span>
    </div>
  )
}
