import { useMemo, useState, type ReactNode } from 'react'
import { BadgeCheck, Check, Eye, Gavel, Highlighter, Info, ListChecks, Lock, Scale, Send, TriangleAlert, X } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { RedactionEditor } from '../../components/redaction/RedactionEditor'
import { cutPdf } from '../../components/redaction/redactFile'
import { DictationTextarea } from '../../components/Dictation'
import type {
  Exhibit,
  ExhibitListItem,
  ExhibitMove,
  ExhibitOption,
  ExhibitPart,
  PageRedactionMarks,
  Side,
  StudentExhibits,
} from '../../courses/types'
import { exhibitLabel, pagesText, parsePages } from '../../courses/exhibitLabels'
import { TeachMe } from '../exchange/TeachMe'
import { TeachMeButton } from '../exchange/TeachMeButton'
import '../exchange/exchange.css'
import './exhibits.css'

const SIDE_NAME: Record<Side, string> = { plaintiff: 'Plaintiff', defense: 'Defense' }
const GROUPS: { id: ExhibitOption['group']; title: string; empty: string }[] = [
  { id: 'case-file', title: 'Case file', empty: 'No case files yet.' },
  { id: 'investigator', title: 'From your investigator', empty: 'No files from your investigator yet: the records he gets or makes for you appear here.' },
  { id: 'depositions', title: 'Your depositions', empty: 'Your team hasn’t deposed anyone.' },
]

const keyOf = (item: Pick<ExhibitListItem, 'kind' | 'id'>) => `${item.kind}:${item.id}`
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/** One option as chosen: all of it, some parts, or (for a file) pages still being typed. */
interface Choice {
  parts: number[] | null
  /** A PDF's pages as typed, while "Only some pages" is on. */
  pages?: string
  /** Parts of a PDF or picture blacked out, with the copy (a new upload, or the one it was saved with). */
  marks?: PageRedactionMarks | null
  uploadKey?: string
  redactedKey?: string | null
  /** "Keeps 2 of 3 pages, 1 with black-outs", once marked here. */
  summary?: string
}

/** What the builder needs to black out parts of a file: its bytes, and somewhere to upload the copy. */
export interface CopyActions {
  loadFile(materialId: string): Promise<Uint8Array>
  upload(materialId: string, file: Blob): Promise<string>
}

/**
 * The joint exhibit list, in the final steps phase: the team builds its list
 * and submits it; once both sides have, it reviews the other side's exhibits
 * (authenticity, then admissibility), answers objections to its own, and
 * follows each exhibit to the end. Without the action props (a closed case),
 * it's read-only.
 */
export function ExhibitListSection({
  exhibits,
  onSave,
  onSubmit,
  onMove,
  onOpenFile,
  onOpenExhibit,
  copyActions,
}: {
  exhibits: StudentExhibits
  onSave?(items: ExhibitListItem[]): Promise<void>
  onSubmit?(items: ExhibitListItem[]): Promise<void>
  onMove?(exhibitId: string, move: ExhibitMove): Promise<void>
  /** Opens one of the team's own case files, while building the list. */
  onOpenFile(materialId: string): void
  /** Opens an exhibit's file: its listed pages, or the redacted version. */
  onOpenExhibit(exhibit: Exhibit): void
  /** Lets the team black out parts of a PDF or picture it lists; leave out to list files only as they are. */
  copyActions?: CopyActions
}) {
  /** The guide open, and where its bulb was, to grow out of. */
  const [teach, setTeach] = useState<DOMRect | null>(null)
  const [excerpt, setExcerpt] = useState<{ title: string; kind: Exhibit['kind']; parts: ExhibitPart[]; redacted?: boolean } | null>(null)
  const { mine, theirs, side } = exhibits
  const exchanged = Boolean(mine.submittedAt && theirs.submittedAt)
  const other: Side = side === 'plaintiff' ? 'defense' : 'plaintiff'

  // A transcript, report or redacted text file opens as its text; any other file in the viewer.
  const open = (x: Exhibit) =>
    x.excerpt ? setExcerpt({ title: x.title, kind: x.kind, parts: x.excerpt, redacted: x.redacted }) : x.kind === 'material' && onOpenExhibit(x)

  return (
    <div className="xl">
      <section className="cw-card ex-section" aria-labelledby="xl-title">
        <header className="ex-section-head xl-head">
          <TeachMeButton variant="compact" about="Exhibit lists" tour="exhibit-teach" onOpen={setTeach} />
          <div>
            <span className="ws-eyebrow">Final steps · Joint exhibit list</span>
            <h2 id="xl-title">
              {exhibits.finalizedAt
                ? 'The final exhibit list'
                : exchanged
                  ? 'Settle the exhibits for trial'
                  : mine.submittedAt
                    ? 'Your exhibit list is in'
                    : 'Build your exhibit list for trial'}
            </h2>
          </div>
        </header>

        {exhibits.finalizedAt ? (
          <FinalList exhibits={exhibits.exhibits} onOpen={open} />
        ) : exchanged ? (
          <Instructions />
        ) : mine.submittedAt ? (
          <>
            <p className="xl-waiting" role="status">
              <Info aria-hidden="true" />
              {theirs.submittedAt
                ? 'Both lists are in.'
                : `Submitted by ${mine.submittedBy ?? 'your team'}. Waiting for the ${SIDE_NAME[other].toLowerCase()} to submit theirs; then the lists are exchanged.`}
            </p>
            <ol className="xl-plain">
              {mine.items.map((i) => (
                <li key={keyOf(i)}>{i.title}</li>
              ))}
              {mine.items.length === 0 && <li className="cw-empty">Your team listed no exhibits.</li>}
            </ol>
          </>
        ) : onSubmit && onSave ? (
          <Builder exhibits={exhibits} onSave={onSave} onSubmit={onSubmit} onOpenFile={onOpenFile} copyActions={copyActions} />
        ) : (
          <p className="cw-empty">Your team didn’t submit an exhibit list.</p>
        )}
      </section>

      {exchanged && <Exchanged exhibits={exhibits} onMove={onMove} onOpen={open} />}

      {teach && <TeachMe topic="exhibits" from={teach} onClose={() => setTeach(null)} />}
      {excerpt && <ExcerptModal {...excerpt} onClose={() => setExcerpt(null)} />}
    </div>
  )
}

/** Choosing the team's exhibits, as a draft, then submitting them. */
function Builder({
  exhibits,
  onSave,
  onSubmit,
  onOpenFile,
  copyActions,
}: {
  exhibits: StudentExhibits
  onSave(items: ExhibitListItem[]): Promise<void>
  onSubmit(items: ExhibitListItem[]): Promise<void>
  onOpenFile(materialId: string): void
  copyActions?: CopyActions
}) {
  const { options, mine, theirs } = exhibits
  const [chosen, setChosen] = useState<Map<string, Choice>>(() => {
    const byKey = new Map(options.map((o) => [keyOf(o), o]))
    return new Map(
      mine.items.map((i) => {
        // A PDF's pages are typed; a text file's paragraphs and a transcript's turns are ticked.
        const typed = i.kind === 'material' && i.parts && !byKey.get(keyOf(i))?.parts
        const drawn = i.marks ? { marks: i.marks, redactedKey: i.redactedKey } : {}
        return [keyOf(i), typed ? { parts: i.parts, pages: pagesText(i.parts!), ...drawn } : { parts: i.parts, ...drawn }]
      }),
    )
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function set(option: ExhibitOption, choice: Choice | null) {
    setSaved(false)
    setChosen((prev) => {
      const next = new Map(prev)
      if (choice) next.set(keyOf(option), choice)
      else next.delete(keyOf(option))
      return next
    })
  }

  /** The list in the order of the options, or an error to show. */
  function items(): ExhibitListItem[] | string {
    const list: ExhibitListItem[] = []
    for (const option of options) {
      const choice = chosen.get(keyOf(option))
      if (!choice) continue
      const drawn: Partial<ExhibitListItem> = choice.marks
        ? { marks: choice.marks, ...(choice.uploadKey ? { uploadKey: choice.uploadKey } : { redactedKey: choice.redactedKey }) }
        : {}
      if (choice.pages !== undefined) {
        const pages = parsePages(choice.pages)
        if (!pages) return `Write the pages of ${option.title} like “3–5, 9”.`
        list.push({ kind: option.kind, id: option.id, parts: pages, ...drawn })
      } else {
        if (choice.parts?.length === 0) return `Choose at least one part of ${option.title}, or list it whole.`
        list.push({ kind: option.kind, id: option.id, parts: choice.parts, ...drawn })
      }
    }
    return list
  }

  async function run(action: 'save' | 'submit') {
    const list = items()
    if (typeof list === 'string') return setError(list)
    if (
      action === 'submit' &&
      !window.confirm(
        `Submit your exhibit list with ${plural(list.length, 'exhibit')}? You can't change it after, and anything not on it can't be used at trial.`,
      )
    ) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await (action === 'save' ? onSave(list) : onSubmit(list))
      if (action === 'save') setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p className="xl-warning" role="note">
        <TriangleAlert aria-hidden="true" />
        <span>
          <strong>If it isn’t on your list, you can’t use it at trial.</strong> Mark everything you may need: case files
          (including the records your investigator got or made for you) and transcripts of the depositions your team took.
          You can list a whole item or just the part you need, and black out parts of a PDF or picture.
        </span>
      </p>
      <p className="muted xl-status">
        {theirs.submittedAt ? 'The other side has submitted its list.' : 'The other side hasn’t submitted its list yet.'}{' '}
        {mine.updatedAt && 'Your team’s draft is saved, and any member can pick it up.'}
      </p>
      {GROUPS.map((group) => {
        const inGroup = options.filter((o) => o.group === group.id)
        return (
          <fieldset key={group.id} className="xl-group">
            <legend>{group.title}</legend>
            {inGroup.length === 0 ? (
              <p className="cw-empty">{group.empty}</p>
            ) : (
              <ul className="xl-options">
                {inGroup.map((o) => (
                  <OptionRow
                    key={keyOf(o)}
                    option={o}
                    choice={chosen.get(keyOf(o)) ?? null}
                    onChange={(c) => set(o, c)}
                    onOpenFile={onOpenFile}
                    copyActions={copyActions}
                  />
                ))}
              </ul>
            )}
          </fieldset>
        )
      })}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="xl-actions">
        <span className="muted">{plural(chosen.size, 'exhibit')} selected</span>
        {saved && (
          <span className="xl-saved" role="status">
            <Check aria-hidden="true" /> Draft saved
          </span>
        )}
        <button type="button" className="ws-btn ws-btn-secondary" onClick={() => run('save')} disabled={busy}>
          Save draft
        </button>
        <button type="button" className="ws-btn ws-btn-primary" onClick={() => run('submit')} disabled={busy}>
          <Send aria-hidden="true" /> Submit list
        </button>
      </div>
    </>
  )
}

/** One thing the team could list: a checkbox, then whole or only some of it. */
function OptionRow({
  option,
  choice,
  onChange,
  onOpenFile,
  copyActions,
}: {
  option: ExhibitOption
  choice: Choice | null
  onChange(choice: Choice | null): void
  onOpenFile(materialId: string): void
  copyActions?: CopyActions
}) {
  const [picking, setPicking] = useState(false)
  const [drawing, setDrawing] = useState(false)
  // A PDF's parts are typed pages; a text file's are its paragraphs.
  const byPage = option.kind === 'material' && !option.parts
  const label = byPage ? 'pages' : option.kind === 'deposition' ? 'questions and answers' : 'paragraphs'
  const some = choice !== null && (choice.pages !== undefined || choice.parts !== null)
  // The pages the black-outs are drawn on: all of them, or the ones typed (if they read).
  const pages = choice?.pages !== undefined ? parsePages(choice.pages) : null
  const canDraw = Boolean(copyActions && option.markable && choice && (choice.pages === undefined || pages))
  return (
    <li className={choice ? 'xl-option xl-option-on' : 'xl-option'}>
      <div className="xl-option-head">
        <label>
          <input type="checkbox" checked={choice !== null} onChange={(e) => onChange(e.target.checked ? { parts: null } : null)} />
          <span>{option.title}</span>
        </label>
        {option.kind === 'material' && !option.parts ? (
          <button type="button" className="link-button xl-view" onClick={() => onOpenFile(option.id)} aria-label={`View ${option.title}`}>
            <Eye aria-hidden="true" /> View
          </button>
        ) : (
          <button type="button" className="link-button xl-view" onClick={() => setPicking((p) => !p)} aria-expanded={picking}>
            <Eye aria-hidden="true" /> {picking ? 'Hide' : 'Read'}
          </button>
        )}
      </div>
      {choice && (
        <div className="ex-segments xl-scope" role="radiogroup" aria-label={`How much of ${option.title}`}>
          <button type="button" role="radio" aria-checked={!some} onClick={() => onChange({ parts: null })}>
            Whole {option.kind === 'material' ? 'file' : option.kind === 'deposition' ? 'transcript' : 'report'}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={some}
            onClick={() => {
              onChange(byPage ? { parts: null, pages: '' } : { parts: [] })
              setPicking(true)
            }}
          >
            Only some {label}
          </button>
        </div>
      )}
      {choice && choice.pages !== undefined && (
        <label className="xl-pages">
          Pages
          <input
            type="text"
            inputMode="numeric"
            value={choice.pages}
            placeholder="3–5, 9"
            onChange={(e) => onChange({ parts: null, pages: e.target.value })}
            aria-label={`Pages of ${option.title}`}
          />
        </label>
      )}
      {canDraw && (
        <div className="xl-drawn">
          {choice!.marks ? (
            <>
              <span>
                <Check aria-hidden="true" /> Parts blacked out{choice!.summary ? `: ${choice!.summary}` : ''}.
              </span>
              <button type="button" className="link-button" onClick={() => setDrawing(true)}>
                Change
              </button>
              <button type="button" className="link-button" onClick={() => onChange({ ...choice!, marks: null, uploadKey: undefined, redactedKey: null, summary: undefined })}>
                Undo
              </button>
            </>
          ) : (
            <button type="button" className="ws-btn ws-btn-secondary" onClick={() => setDrawing(true)}>
              <Highlighter aria-hidden="true" /> Black out parts
            </button>
          )}
        </div>
      )}
      {drawing && copyActions && option.markable && (
        <RedactionEditor
          team
          eyebrow={`Your exhibit · ${option.title}`}
          marking={{ markable: option.markable, parts: null }}
          loadFile={async () => {
            const data = await copyActions.loadFile(option.id)
            return option.markable === 'pdf' && pages ? cutPdf(data, pages) : data
          }}
          upload={(file) => copyActions.upload(option.id, file)}
          initial={choice?.marks ?? undefined}
          onSave={(m) => {
            onChange({ ...choice!, marks: m.marks as PageRedactionMarks, uploadKey: m.uploadKey, redactedKey: null, summary: m.summary })
            setDrawing(false)
          }}
          onClose={() => setDrawing(false)}
        />
      )}
      {option.parts && picking && (
        <ol className="xl-parts" aria-label={`${option.title}, ${label}`}>
          {option.parts.map((p) => {
            const on = choice?.parts?.includes(p.n) ?? false
            const choosing = choice !== null && choice.parts !== null
            return (
              <li key={p.n}>
                {choosing ? (
                  <label>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        onChange({ parts: on ? choice!.parts!.filter((n) => n !== p.n) : [...choice!.parts!, p.n].sort((a, b) => a - b) })
                      }
                    />
                    <PartText part={p} index={p.n} />
                  </label>
                ) : (
                  <PartText part={p} index={p.n} />
                )}
              </li>
            )
          })}
        </ol>
      )}
    </li>
  )
}

/** Text with its redactions (runs of █, from the server) drawn as black bars. */
function Redacted({ text }: { text: string }) {
  if (!text.includes('█')) return text
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

function PartText({ part, index }: { part: ExhibitPart; index: number }) {
  return part.question !== undefined ? (
    <span className="xl-turn">
      <span>
        <strong>Q{index + 1}.</strong> <Redacted text={part.question} />
      </span>
      {part.objection && <em>Objection: {part.objection}</em>}
      <span>
        <strong>A.</strong> <Redacted text={part.text} />
      </span>
    </span>
  ) : (
    <span className="xl-turn">
      <span>
        <strong>¶{index + 1}</strong> <Redacted text={part.text} />
      </span>
    </span>
  )
}

function Instructions() {
  return (
    <div className="xl-steps" role="note">
      <p>
        <strong>The lists are exchanged.</strong> Anything both sides listed is authentic and admitted. For each of the other
        side’s exhibits, go in order:
      </p>
      <ol>
        <li>
          <BadgeCheck aria-hidden="true" /> <span><strong>Authenticity first.</strong> Is it what it claims to be? Agree, or challenge it and say why.</span>
        </li>
        <li>
          <Scale aria-hidden="true" /> <span><strong>Then admissibility.</strong> Admit it, or object: hearsay, relevance, unfair prejudice, foundation. You can ask to admit only part of it, or to redact a part.</span>
        </li>
      </ol>
      <p className="muted">
        When the other side objects to one of yours, drop it or send it to the judge with your response. Your instructor rules on
        every challenge.
      </p>
    </div>
  )
}

/** Where an exhibit is, in a word, as this side sees it. */
function statusBadge(x: Exhibit, side: Side): { label: string; tone: string } {
  const ours = x.offeredBy === side
  switch (x.status) {
    case 'awaiting_authenticity':
      return { label: ours ? 'Other side checking authenticity' : 'Your call: authenticity', tone: ours ? 'grey' : 'amber' }
    case 'authenticity_review':
      return { label: 'Authenticity before the judge', tone: 'blue' }
    case 'awaiting_admission':
      return { label: ours ? 'Other side deciding on admission' : 'Your call: admission', tone: ours ? 'grey' : 'amber' }
    case 'objection_response':
      return { label: ours ? 'Objected to: your response' : 'Objected to', tone: ours ? 'amber' : 'grey' }
    case 'admission_review':
      return { label: 'Objection before the judge', tone: 'blue' }
    case 'admitted':
      return x.supersededBy
        ? { label: 'Replaced by the whole', tone: 'grey' }
        : { label: x.redaction || x.redacted ? 'Admitted, redacted' : 'Admitted', tone: 'green' }
    case 'inauthentic':
      return { label: 'Rejected as inauthentic', tone: 'rose' }
    case 'dropped':
      return { label: 'Dropped', tone: 'grey' }
    case 'excluded':
      return { label: 'Excluded', tone: 'rose' }
  }
}

/** Waiting on this team: the other side's exhibits to review, and objections to its own. */
const needsUs = (x: Exhibit, side: Side) =>
  x.offeredBy === side ? x.status === 'objection_response' : x.status === 'awaiting_authenticity' || x.status === 'awaiting_admission'

const ADMITTED_STATES = new Set(['admitted'])
const AUTHENTICATED_STATES = new Set(['awaiting_admission', 'objection_response', 'admission_review'])
const IN_REVIEW_STATES = new Set(['awaiting_authenticity', 'authenticity_review'])

/** After the exchange: what needs the team, then every exhibit by where it stands. */
function Exchanged({
  exhibits,
  onMove,
  onOpen,
}: {
  exhibits: StudentExhibits
  onMove?(exhibitId: string, move: ExhibitMove): Promise<void>
  onOpen(x: Exhibit): void
}) {
  const { side } = exhibits
  const list = exhibits.exhibits
  const needs = list.filter((x) => needsUs(x, side))
  // What needs the team, step by step: an exhibit it authenticates moves on to admission at once.
  const steps = [
    { id: 'authenticity', title: 'Step 1 · Authenticity', hint: 'Is each one what it claims to be?', items: needs.filter((x) => x.status === 'awaiting_authenticity') },
    {
      id: 'admission',
      title: 'Step 2 · Admission',
      hint: 'These are authenticated. Admit each one, or object.',
      items: needs.filter((x) => x.status === 'awaiting_admission'),
    },
    { id: 'objections', title: 'Objections to your exhibits', hint: 'Drop it, or send it to the judge.', items: needs.filter((x) => x.status === 'objection_response') },
  ].filter((step) => step.items.length > 0)
  // Exhibits the team just authenticated here, marked as they arrive in Step 2.
  const [justAuthenticated, setJustAuthenticated] = useState<Set<string>>(() => new Set())
  const [statuses, setStatuses] = useState(() => new Map(list.map((x) => [x.id, x.status])))
  if (list.some((x) => statuses.get(x.id) !== x.status)) {
    const moved = list.filter((x) => statuses.get(x.id) === 'awaiting_authenticity' && x.status === 'awaiting_admission').map((x) => x.id)
    setStatuses(new Map(list.map((x) => [x.id, x.status])))
    if (moved.length) setJustAuthenticated((prev) => new Set([...prev, ...moved]))
  }
  const groups = useMemo(
    () => [
      { id: 'in-review', title: 'In review', items: list.filter((x) => IN_REVIEW_STATES.has(x.status)) },
      { id: 'authenticated', title: 'Authenticated', items: list.filter((x) => AUTHENTICATED_STATES.has(x.status)) },
      { id: 'admitted', title: 'Admitted', items: list.filter((x) => ADMITTED_STATES.has(x.status) && !x.supersededBy) },
    ],
    [list],
  )
  const out = list.filter((x) => ['inauthentic', 'dropped', 'excluded'].includes(x.status) || x.supersededBy)
  return (
    <>
      {!exhibits.finalizedAt && onMove && (
        <section className="cw-card ex-section" aria-labelledby="xl-needs-title">
          <span className="ws-eyebrow">Your team’s turn</span>
          <h2 id="xl-needs-title">{needs.length === 0 ? 'Nothing needs your team right now' : `${plural(needs.length, 'exhibit')} need your team`}</h2>
          {needs.length === 0 ? (
            <p className="cw-empty">You’ll get a notice here when the other side objects, or when your instructor rules.</p>
          ) : (
            steps.map((step) => (
              <div key={step.id} className="xl-step" aria-labelledby={`xl-step-${step.id}`} role="group">
                <h3 id={`xl-step-${step.id}`}>
                  {step.title} <span className="cw-tab-count">{step.items.length}</span>
                </h3>
                <p className="muted xl-step-hint">{step.hint}</p>
                <ul className="ex-respond">
                  {step.items.map((x) => (
                    // A new card at each step, so nothing from the last one carries over.
                    <li key={`${x.id}:${x.status}`}>
                      <MoveCard exhibit={x} side={side} onMove={onMove} onOpen={() => onOpen(x)} fresh={justAuthenticated.has(x.id)} />
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
      )}
      <section className="cw-card ex-section" aria-labelledby="xl-running-title">
        <span className="ws-eyebrow">Both sides see this list</span>
        <h2 id="xl-running-title">Where every exhibit stands</h2>
        {/* Once the list is final, only the groups with something in them. */}
        {groups.filter((g) => !exhibits.finalizedAt || g.items.length > 0).map((g) => (
          <div key={g.id} className="xl-status-group">
            <h3>
              {g.title} <span className="cw-tab-count">{g.items.length}</span>
            </h3>
            {g.items.length === 0 ? (
              <p className="cw-empty">None.</p>
            ) : (
              <ul className="xl-rows">
                {g.items.map((x) => (
                  <ExhibitRow key={x.id} exhibit={x} side={side} onOpen={() => onOpen(x)} />
                ))}
              </ul>
            )}
          </div>
        ))}
        {out.length > 0 && (
          <details className="xl-out">
            <summary>Not admitted ({out.length})</summary>
            <ul className="xl-rows">
              {out.map((x) => (
                <ExhibitRow key={x.id} exhibit={x} side={side} onOpen={() => onOpen(x)} />
              ))}
            </ul>
          </details>
        )}
      </section>
    </>
  )
}

function Who({ exhibit }: { exhibit: Exhibit }) {
  return (
    <span className={`xl-who xl-who-${exhibit.offeredBy}`}>
      {exhibit.joint ? 'Joint · Plaintiff’s' : `${SIDE_NAME[exhibit.offeredBy]}’s`}
    </span>
  )
}

function Authentic({ exhibit }: { exhibit: Exhibit }) {
  if (!exhibit.authenticated) return null
  return (
    <span className="cw-badge cw-badge-done xl-authentic" title="Accepted as authentic">
      <BadgeCheck aria-hidden="true" /> Authentic
    </span>
  )
}

/** The written record so far: challenges, objections, responses and rulings. */
export function ExhibitRecord({ exhibit: x }: { exhibit: Exhibit }) {
  const lines: [string, string][] = []
  if (x.authenticityNote) lines.push(['Authenticity challenge', x.authenticityNote])
  if (x.authenticityRuling)
    lines.push([
      'Judge on authenticity',
      `${x.authenticityRuling === 'authenticated' ? 'Authenticated' : 'Rejected as inauthentic'}${x.authenticityRulingNote ? `. ${x.authenticityRulingNote}` : ''}`,
    ])
  if (x.objection) lines.push(['Objection', x.objection])
  if (x.response) lines.push(['Response', x.response])
  if (x.acceptsRedaction) lines.push(['Would accept redacting', x.acceptsRedaction])
  if (x.ruling)
    lines.push([
      'Ruling',
      `${x.ruling === 'overruled' ? 'Objection overruled' : x.ruling === 'sustained' ? 'Objection sustained' : 'Partly overruled'}${x.rulingNote ? `. ${x.rulingNote}` : ''}`,
    ])
  if (x.redaction) lines.push(['Redacted', x.redaction])
  else if (x.redacted) lines.push(['Redacted', 'As the judge marked it. Open the exhibit to see what’s admitted.'])
  if (lines.length === 0) return null
  return (
    <dl className="xl-record">
      {lines.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function ExhibitRow({ exhibit: x, side, onOpen }: { exhibit: Exhibit; side: Side; onOpen(): void }) {
  const badge = statusBadge(x, side)
  return (
    <li className="xl-row">
      <div className="xl-row-head">
        {x.label && <span className="xl-label">{exhibitLabel(x)}</span>}
        <Who exhibit={x} />
        <button type="button" className="link-button xl-title" onClick={onOpen}>
          {x.title}
        </button>
        <Authentic exhibit={x} />
        <span className={`cw-badge xl-badge-${badge.tone}`}>{badge.label}</span>
      </div>
      <ExhibitRecord exhibit={x} />
    </li>
  )
}

/** One exhibit waiting on the team, with its buttons. */
function MoveCard({
  exhibit: x,
  side,
  onMove,
  onOpen,
  fresh = false,
}: {
  exhibit: Exhibit
  side: Side
  onMove(exhibitId: string, move: ExhibitMove): Promise<void>
  onOpen(): void
  /** Just authenticated by the team, so its admission is a new choice. */
  fresh?: boolean
}) {
  const [writing, setWriting] = useState<'challenge' | 'review' | null>(null)
  const [text, setText] = useState('')
  const [redaction, setRedaction] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ours = x.offeredBy === side

  async function send(move: ExhibitMove) {
    setBusy(true)
    setError(null)
    try {
      await onMove(x.id, move)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  let buttons: ReactNode
  let form: ReactNode = null
  if (x.status === 'awaiting_authenticity') {
    buttons = (
      <>
        <button type="button" className="ws-btn ws-btn-primary" disabled={busy} onClick={() => send({ step: 'authenticity', decision: 'agree' })}>
          <BadgeCheck aria-hidden="true" /> Agree to authenticity
        </button>
        <button type="button" className="ws-btn ws-btn-secondary" disabled={busy} onClick={() => setWriting('challenge')} aria-pressed={writing === 'challenge'}>
          <TriangleAlert aria-hidden="true" /> Challenge authenticity
        </button>
      </>
    )
    if (writing === 'challenge')
      form = (
        <NoteForm
          label="Why isn’t it what it claims to be?"
          hint="For example: no one can say where it came from, it looks altered, or it isn’t signed or certified."
          value={text}
          onChange={setText}
          busy={busy}
          submit="Send challenge to the judge"
          onSubmit={() => send({ step: 'authenticity', decision: 'challenge', note: text })}
          onCancel={() => setWriting(null)}
        />
      )
  } else if (x.status === 'awaiting_admission') {
    buttons = (
      <>
        <button type="button" className="ws-btn ws-btn-primary" disabled={busy} onClick={() => send({ step: 'admission', decision: 'admit' })}>
          <Check aria-hidden="true" /> Admit
        </button>
        <button type="button" className="ws-btn ws-btn-secondary" disabled={busy} onClick={() => setWriting('challenge')} aria-pressed={writing === 'challenge'}>
          <Gavel aria-hidden="true" /> Challenge admission
        </button>
      </>
    )
    if (writing === 'challenge')
      form = (
        <NoteForm
          label="Your objection"
          hint="Name the ground (hearsay, relevance, unfair prejudice, foundation, best evidence, privilege) and why. To keep out only part of it, say which part to redact."
          value={text}
          onChange={setText}
          busy={busy}
          submit="Send objection"
          onSubmit={() => send({ step: 'admission', decision: 'challenge', objection: text })}
          onCancel={() => setWriting(null)}
        />
      )
  } else {
    buttons = (
      <>
        <button
          type="button"
          className="ws-btn ws-btn-secondary"
          disabled={busy}
          onClick={() => window.confirm(`Drop ${x.title} from your exhibits? You won't be able to use it at trial.`) && send({ step: 'response', decision: 'drop' })}
        >
          <X aria-hidden="true" /> Drop the exhibit
        </button>
        <button type="button" className="ws-btn ws-btn-primary" disabled={busy} onClick={() => setWriting('review')} aria-pressed={writing === 'review'}>
          <Scale aria-hidden="true" /> Send to the judge
        </button>
      </>
    )
    if (writing === 'review')
      form = (
        <NoteForm
          label="Your response to the objection"
          hint="Answer the ground they raised: another purpose, a hearsay exception, why it's relevant."
          value={text}
          onChange={setText}
          busy={busy}
          submit="Send to the judge"
          onSubmit={() => send({ step: 'response', decision: 'review', response: text, acceptsRedaction: redaction })}
          onCancel={() => setWriting(null)}
          extra={
            <label className="xl-field">
              <span>
                Would you accept a redaction? <small>(optional) Say which part could come out.</small>
              </span>
              <input type="text" value={redaction} maxLength={2000} onChange={(e) => setRedaction(e.target.value)} />
            </label>
          }
        />
      )
  }

  return (
    <div className={`ex-respond-item${writing ? ' ex-respond-open' : ''}${fresh ? ' xl-fresh' : ''}`}>
      <div className="xl-row-head">
        <Who exhibit={x} />
        <button type="button" className="link-button xl-title" onClick={onOpen}>
          {x.title}
        </button>
        <Authentic exhibit={x} />
        {fresh && <span className="cw-badge xl-badge-blue">Just authenticated: now decide on admission</span>}
      </div>
      {ours && x.objection && (
        <p className="xl-objection">
          <strong>Their objection:</strong> {x.objection}
        </p>
      )}
      <ExhibitRecord exhibit={{ ...x, objection: ours ? null : x.objection }} />
      <div className="xl-buttons">{buttons}</div>
      {form}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

function NoteForm({
  label,
  hint,
  value,
  onChange,
  busy,
  submit,
  onSubmit,
  onCancel,
  extra,
}: {
  label: string
  hint: string
  value: string
  onChange(value: string): void
  busy: boolean
  submit: string
  onSubmit(): void
  onCancel(): void
  extra?: ReactNode
}) {
  return (
    <form
      className="xl-note"
      onSubmit={(e) => {
        e.preventDefault()
        if (value.trim()) onSubmit()
      }}
    >
      <label className="xl-field">
        <span>
          {label} <small>{hint}</small>
        </span>
        <DictationTextarea value={value} rows={3} maxLength={2000} onChange={(e) => onChange(e.target.value)} required />
      </label>
      {extra}
      <div className="xl-buttons">
        <button type="submit" className="ws-btn ws-btn-primary" disabled={busy || !value.trim()}>
          {submit}
        </button>
        <button type="button" className="ws-btn ws-btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/** The final list: the plaintiff's numbered, the defense's lettered. */
function FinalList({ exhibits, onOpen }: { exhibits: Exhibit[]; onOpen(x: Exhibit): void }) {
  const labelled = exhibits.filter((x) => x.label)
  return (
    <>
      <p className="xl-final-note" role="status">
        <ListChecks aria-hidden="true" />
        Every exhibit is settled. These are the exhibits each side can use at trial.
      </p>
      <div className="xl-final">
        {(['plaintiff', 'defense'] as const).map((s) => {
          const mine = labelled.filter((x) => x.offeredBy === s)
          return (
            <div key={s}>
              <h3>{SIDE_NAME[s]}’s exhibits</h3>
              {mine.length === 0 ? (
                <p className="cw-empty">None.</p>
              ) : (
                <ol className="xl-final-list">
                  {mine.map((x) => (
                    <li key={x.id}>
                      <span className="xl-label">{exhibitLabel(x)}</span>
                      <button type="button" className="link-button xl-title" onClick={() => onOpen(x)}>
                        {x.title}
                      </button>
                      {x.joint && <span className="cw-badge">Joint</span>}
                      {(x.redaction || x.redacted) && (
                        <span className="cw-badge ex-badge-amber">{x.redaction ? `Redacted: ${x.redaction}` : 'Redacted'}</span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

/** A transcript's or report's chosen part, as it was at the exchange, or a text exhibit as admitted with a redaction. */
export function ExcerptModal({
  title,
  kind,
  parts,
  redacted,
  onClose,
}: {
  title: string
  kind: Exhibit['kind']
  parts: ExhibitPart[]
  redacted?: boolean
  onClose(): void
}) {
  const what = kind === 'deposition' ? 'Deposition transcript' : kind === 'report' ? 'Investigator report' : 'Text of the file'
  return (
    <Modal
      eyebrow={redacted ? `${what} · as admitted, redacted` : what}
      title={title}
      icon={kind === 'deposition' ? <Gavel /> : <Lock />}
      wide
      onClose={onClose}
      footer={
        <button type="button" className="ws-btn ws-btn-primary" onClick={onClose}>
          Close
        </button>
      }
    >
      <ol className="xl-parts xl-parts-read">
        {parts.map((p) => (
          <li key={p.n}>
            <PartText part={p} index={p.n} />
          </li>
        ))}
      </ol>
    </Modal>
  )
}
