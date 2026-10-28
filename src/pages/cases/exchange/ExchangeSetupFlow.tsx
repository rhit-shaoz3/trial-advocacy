import { useEffect, useState, type ReactNode } from 'react'
import { ArrowRight, Check, ChevronLeft, FileText, Minus, Pencil, Plus, TriangleAlert } from 'lucide-react'
import { WitnessAvatar } from '../../../components/WitnessAvatar'
import { useCourseService } from '../../../courses/CourseServiceContext'
import type {
  CourseCase,
  DisclosureOption,
  ExchangeSettings,
  ExchangeSettingsInput,
  PartSettings,
  Side,
  SubpoenaType,
} from '../../../courses/types'
import { SUBPOENA_TYPES } from '../../../courses/types'
import { SUBPOENA_TYPE_HINT, SUBPOENA_TYPE_LABEL } from '../../../courses/subpoenaForm'
import { WelcomeEmail } from '../../../caseWorkspace/exchange/WelcomeEmail'
import { SIDE_LABEL, partSummary, subpoenaSummary } from './exchangeLabels'
import '../setup/CaseSetupFlow.css'
import './exchange.css'

export const EXCHANGE_STEPS = ['disclosures', 'subpoenas', 'interrogatories', 'rfas', 'email', 'review'] as const
export type ExchangeStep = (typeof EXCHANGE_STEPS)[number]

const STEP_LABEL: Record<ExchangeStep, string> = {
  disclosures: 'Initial disclosures',
  subpoenas: 'Subpoenas',
  interrogatories: 'Interrogatories',
  rfas: 'Requests for admission',
  email: 'Welcome email',
  review: 'Review',
}

const STEP_HINT: Record<ExchangeStep, string> = {
  disclosures:
    'Pick what each side must disclose to the other. Each student makes their own picks during the introduction phase; your picks are the answer key, shared with everyone when you move to information exchange.',
  subpoenas: 'Teams subpoena records, data, objects, or a site visit from people and organizations outside their files.',
  interrogatories: 'Written questions one team sends the other, answered in writing.',
  rfas: 'Statements one team asks the other to admit or deny, so settled facts don’t have to be proven at trial.',
  email:
    'Each team gets an email from a senior partner at their firm when the introduction phase starts. The documents and witnesses fill in from the case.',
  review: 'Check your choices. You can change any of them later from the case page.',
}

type Part = 'subpoenas' | 'interrogatories' | 'rfas'

const PART_COPY: Record<Part, { limit: string; limitHint: string; unit: string; daysHint: string }> = {
  subpoenas: {
    limit: 'Subpoenas per team',
    limitHint: 'Each team can send this many over the whole case.',
    unit: 'subpoenas',
    daysHint: 'How long the recipient has to respond. Students see the due date on the subpoena.',
  },
  interrogatories: {
    limit: 'Questions per team',
    limitHint: 'The total across every set a team sends. Each subpart counts as a question.',
    unit: 'questions',
    daysHint: 'Starts when the other team receives the set.',
  },
  rfas: {
    limit: 'Requests per team',
    limitHint: 'The total across every set a team sends.',
    unit: 'requests',
    daysHint: 'Starts when the other team receives the set.',
  },
}

const SIDES: Side[] = ['plaintiff', 'defense']

const toInput = (s: ExchangeSettings): ExchangeSettingsInput => ({
  disclosures: { enabled: s.disclosures.enabled },
  subpoenas: s.subpoenas,
  interrogatories: s.interrogatories,
  rfas: s.rfas,
  firms: s.firms,
})

/**
 * Setting up the case's information exchange, one step at a time, styled like
 * the guided case setup: initial disclosures (the instructor's answer key),
 * subpoenas, interrogatories, and requests for admission (each with a small
 * Include switch and its limits), the welcome email's firms, and a review.
 * Every step saves on Next; finishing makes it visible to students.
 */
export function ExchangeSetupFlow({
  courseId,
  courseCase,
  initialStep = 'disclosures',
  onCaseChange,
  onExit,
}: {
  courseId: string
  courseCase: CourseCase
  initialStep?: ExchangeStep
  /** Finishing changes the case (it gains the information exchange phase). */
  onCaseChange(updated: CourseCase): void
  onExit(): void
}) {
  const service = useCourseService()
  const [step, setStep] = useState<ExchangeStep>(initialStep)
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const [settings, setSettings] = useState<ExchangeSettingsInput | null>(null)
  const [disclosed, setDisclosed] = useState<{ materialIds: string[]; witnessIds: string[] }>({ materialIds: [], witnessIds: [] })
  const [options, setOptions] = useState<DisclosureOption[]>([])
  const [finished, setFinished] = useState(false)
  const [furthest, setFurthest] = useState(EXCHANGE_STEPS.indexOf(initialStep))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    service
      .getExchange(courseId, courseCase.id)
      .then(({ settings: s, options: o }) => {
        if (cancelled) return
        setSettings(toInput(s))
        setDisclosed({ materialIds: s.disclosures.materialIds, witnessIds: s.disclosures.witnessIds })
        setOptions(o)
        setFinished(s.setupCompletedAt !== null)
      })
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [service, courseId, courseCase.id])

  const index = EXCHANGE_STEPS.indexOf(step)
  const last = index === EXCHANGE_STEPS.length - 1
  // Once it's set up, every step can be opened; before that, the ones reached so far.
  const reached = finished ? [...EXCHANGE_STEPS] : EXCHANGE_STEPS.slice(0, Math.max(furthest, index) + 1)

  function go(to: ExchangeStep) {
    setDirection(EXCHANGE_STEPS.indexOf(to) < index ? 'back' : 'forward')
    setError(null)
    setStep(to)
    setFurthest((f) => Math.max(f, EXCHANGE_STEPS.indexOf(to)))
  }

  async function save() {
    await service.saveExchangeSettings(courseId, courseCase.id, settings!)
    if (step === 'disclosures') await service.saveDisclosures(courseId, courseCase.id, disclosed)
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const next = () =>
    run(async () => {
      await save()
      if (last) {
        const done = await service.completeExchangeSetup(courseId, courseCase.id)
        onCaseChange(done.case)
        onExit()
        return
      }
      go(EXCHANGE_STEPS[index + 1])
    })

  const saveAndLeave = () =>
    run(async () => {
      await save()
      onExit()
    })

  const setPart = (part: Part, value: PartSettings) => setSettings((s) => (s ? { ...s, [part]: value } : s))
  const toggle = (on: boolean) =>
    setSettings((s) =>
      !s ? s : step === 'disclosures' ? { ...s, disclosures: { enabled: on } } : { ...s, [step]: { ...s[step as Part], enabled: on } },
    )
  const included =
    settings && (step === 'disclosures' ? settings.disclosures.enabled : step in PART_COPY ? settings[step as Part].enabled : null)

  return (
    <div className="setup exchange-setup">
      <button type="button" className="case-back link-like" onClick={onExit}>
        <ChevronLeft aria-hidden="true" />
        {courseCase.title}
      </button>
      <header className="setup-header">
        <span className="ws-eyebrow">Information exchange</span>
        <h1>Set up information exchange</h1>
        <nav aria-label="Setup steps">
          <ol className="setup-steps">
            {reached.map((s, i) => (
              <li key={s}>
                <button
                  type="button"
                  className={s === step ? 'setup-step-current' : undefined}
                  aria-current={s === step ? 'step' : undefined}
                  onClick={() => go(s)}
                  disabled={busy || !settings}
                >
                  <span className="setup-step-number" aria-hidden="true">
                    {s === step ? i + 1 : <Check />}
                  </span>
                  {STEP_LABEL[s]}
                </button>
              </li>
            ))}
          </ol>
        </nav>
      </header>

      <div key={step} className={`setup-body setup-slide-${direction}`}>
        <div className="exchange-intro">
          <div className="setup-intro">
            <span className="setup-count">
              Step {index + 1} of {EXCHANGE_STEPS.length}
            </span>
            <h2>{STEP_LABEL[step]}</h2>
            <p className="muted">{STEP_HINT[step]}</p>
          </div>
          {included !== null && included !== undefined && (
            <label className="exchange-include">
              Include
              <input
                type="checkbox"
                role="switch"
                className="switch"
                checked={included}
                onChange={(e) => toggle(e.target.checked)}
                aria-label={`Include ${STEP_LABEL[step].toLowerCase()}`}
              />
            </label>
          )}
        </div>

        {!settings ? (
          error ? null : <p className="muted">Loading…</p>
        ) : (
          <>
            {step === 'disclosures' && (
              <DisclosurePicker
                options={options}
                disclosed={disclosed}
                disabled={!settings.disclosures.enabled}
                onChange={setDisclosed}
              />
            )}
            {(step === 'subpoenas' || step === 'interrogatories' || step === 'rfas') && (
              <PartForm part={step} value={settings[step]} onChange={(v) => setPart(step, v)} />
            )}
            {step === 'email' && (
              <EmailStep
                caseTitle={courseCase.title}
                settings={settings}
                options={options}
                onChange={(firms) => setSettings({ ...settings, firms })}
              />
            )}
            {step === 'review' && (
              <ReviewStep settings={settings} disclosed={disclosed} options={options} onEdit={go} />
            )}
          </>
        )}

        <div className="setup-footer">
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="exchange-footer-buttons">
            {index > 0 && (
              <button type="button" className="link-button exchange-back" onClick={() => go(EXCHANGE_STEPS[index - 1])} disabled={busy}>
                <ChevronLeft aria-hidden="true" />
                Back
              </button>
            )}
            <span className="exchange-footer-spacer" />
            <button type="button" className="setup-skip" onClick={saveAndLeave} disabled={busy || !settings}>
              {finished ? 'Save and close' : 'Save and finish later'}
            </button>
            <button type="button" className="setup-next" onClick={next} disabled={busy || !settings}>
              {last ? (finished ? 'Save' : 'Finish setup') : 'Next'}
              {last ? <Check aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Each side's witnesses and one-side files, to tick for its initial disclosures. */
function DisclosurePicker({
  options,
  disclosed,
  disabled,
  onChange,
}: {
  options: DisclosureOption[]
  disclosed: { materialIds: string[]; witnessIds: string[] }
  disabled: boolean
  onChange(next: { materialIds: string[]; witnessIds: string[] }): void
}) {
  const isOn = (o: DisclosureOption) => (o.kind === 'material' ? disclosed.materialIds : disclosed.witnessIds).includes(o.id)
  function flip(o: DisclosureOption) {
    const key = o.kind === 'material' ? 'materialIds' : 'witnessIds'
    const ids = disclosed[key]
    onChange({ ...disclosed, [key]: ids.includes(o.id) ? ids.filter((id) => id !== o.id) : [...ids, o.id] })
  }
  return (
    <div className={disabled ? 'exchange-sides exchange-off' : 'exchange-sides'}>
      {SIDES.map((side) => {
        const mine = options.filter((o) => o.side === side)
        const witnesses = mine.filter((o) => o.kind === 'witness')
        const files = mine.filter((o) => o.kind === 'material')
        return (
          <section key={side} className="exchange-side" aria-label={`${SIDE_LABEL[side]} disclosures`}>
            <header>
              <span className={`exchange-side-badge exchange-side-${side}`}>{SIDE_LABEL[side]}</span>
              <small>{mine.filter(isOn).length} selected</small>
            </header>
            {mine.length === 0 && (
              <p className="muted exchange-empty">
                No witnesses or one-side case files for the {side} yet. Add them on the Witnesses and Case file tabs.
              </p>
            )}
            {witnesses.length > 0 && <h3>Witnesses</h3>}
            {witnesses.map((o) => (
              <label key={o.id} className="exchange-pick">
                <input type="checkbox" checked={isOn(o)} onChange={() => flip(o)} disabled={disabled} />
                <WitnessAvatar src={o.avatarUrl} size="sm" />
                <span>
                  <strong>{o.name}</strong>
                  {o.detail && <small>{o.detail}</small>}
                </span>
              </label>
            ))}
            {files.length > 0 && <h3>Case files</h3>}
            {files.map((o) => (
              <label key={o.id} className="exchange-pick">
                <input type="checkbox" checked={isOn(o)} onChange={() => flip(o)} disabled={disabled} />
                <span className="ws-icon-tile ws-icon-tile-sm ws-tone-blue" aria-hidden="true">
                  <FileText />
                </span>
                <span>
                  <strong>{o.name}</strong>
                  {o.detail && <small>{o.detail}</small>}
                </span>
              </label>
            ))}
          </section>
        )
      })}
      <p className="muted exchange-note">The starting file and files already shared with everyone aren&rsquo;t listed.</p>
    </div>
  )
}

/** A whole number with − and + buttons. */
function Stepper({
  label,
  value,
  unit,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string
  value: number
  unit: string
  min: number
  max: number
  disabled: boolean
  onChange(value: number): void
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)))
  return (
    <div className="stepper">
      <div className="stepper-control">
        <button type="button" aria-label={`Fewer ${unit}`} onClick={() => onChange(clamp(value - 1))} disabled={disabled || value <= min}>
          <Minus aria-hidden="true" />
        </button>
        <input
          type="number"
          aria-label={label}
          value={value}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(e) => e.target.value !== '' && onChange(clamp(Number(e.target.value)))}
        />
        <button type="button" aria-label={`More ${unit}`} onClick={() => onChange(clamp(value + 1))} disabled={disabled || value >= max}>
          <Plus aria-hidden="true" />
        </button>
      </div>
      <span className="muted">{unit}</span>
    </div>
  )
}

function SettingRow({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="exchange-setting">
      <div>
        <strong>{label}</strong>
        <p className="muted">{hint}</p>
      </div>
      {children}
    </div>
  )
}

function PartForm({
  part,
  value,
  onChange,
}: {
  part: Part
  /** Subpoenas' settings also have the kinds of request allowed. */
  value: PartSettings & { types?: SubpoenaType[] }
  onChange(v: PartSettings): void
}) {
  const copy = PART_COPY[part]
  return (
    <div className={value.enabled ? 'exchange-settings' : 'exchange-settings exchange-off'}>
      <SettingRow label={copy.limit} hint={copy.limitHint}>
        <Stepper
          label={copy.limit}
          value={value.limit}
          unit={copy.unit}
          min={1}
          max={100}
          disabled={!value.enabled}
          onChange={(limit) => onChange({ ...value, limit })}
        />
      </SettingRow>
      <SettingRow label="Time to respond" hint={copy.daysHint}>
        <Stepper
          label="Days to respond"
          value={value.days}
          unit="days"
          min={1}
          max={365}
          disabled={!value.enabled}
          onChange={(days) => onChange({ ...value, days })}
        />
      </SettingRow>
      {part === 'subpoenas' && value.types && (
        <SubpoenaTypes types={value.types} disabled={!value.enabled} onChange={(types) => onChange({ ...value, types } as PartSettings)} />
      )}
      {part === 'subpoenas' && (
        <p className="muted exchange-note">
          Teams serve subpoenas on people and organizations from the information exchange phase on. The AI drafts each
          recipient&rsquo;s response from the case file, and you review it on the Review page before the team sees it.
        </p>
      )}
    </div>
  )
}

/** Which kinds of request subpoenas can make; at least one stays ticked. */
function SubpoenaTypes({ types, disabled, onChange }: { types: SubpoenaType[]; disabled: boolean; onChange(types: SubpoenaType[]): void }) {
  const flip = (type: SubpoenaType, on: boolean) => onChange(SUBPOENA_TYPES.filter((t) => (t === type ? on : types.includes(t))))
  return (
    <fieldset className="exchange-setting exchange-types" disabled={disabled}>
      <div>
        <legend>
          <strong>What can teams subpoena?</strong>
        </legend>
        <p className="muted">Teams choose one of these for each subpoena.</p>
      </div>
      <div className="exchange-type-list">
        {SUBPOENA_TYPES.map((t) => {
          const checked = types.includes(t)
          return (
            <label key={t} className="exchange-type">
              <input
                type="checkbox"
                checked={checked}
                // The last kind left can't be unticked; turn subpoenas off instead.
                disabled={checked && types.length === 1}
                onChange={(e) => flip(t, e.target.checked)}
              />
              <span>
                {SUBPOENA_TYPE_LABEL[t]}
                <small className="muted">{SUBPOENA_TYPE_HINT[t]}</small>
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

function EmailStep({
  caseTitle,
  settings,
  options,
  onChange,
}: {
  caseTitle: string
  settings: ExchangeSettingsInput
  options: DisclosureOption[]
  onChange(firms: ExchangeSettingsInput['firms']): void
}) {
  const [preview, setPreview] = useState<Side>('plaintiff')
  const sideOptions = options.filter((o) => o.side === preview)
  return (
    <div className="exchange-email">
      <div className="exchange-firms">
        {SIDES.map((side) => (
          <fieldset key={side} className="exchange-firm">
            <legend>
              <span className={`exchange-side-badge exchange-side-${side}`}>{SIDE_LABEL[side]}</span>
            </legend>
            <label>
              Firm
              <input
                type="text"
                value={settings.firms[side].firm}
                maxLength={120}
                placeholder={side === 'plaintiff' ? 'Hale & Whitford LLP' : 'Brandt Kessler LLP'}
                onChange={(e) => onChange({ ...settings.firms, [side]: { ...settings.firms[side], firm: e.target.value } })}
              />
            </label>
            <label>
              Senior partner
              <input
                type="text"
                value={settings.firms[side].partner}
                maxLength={120}
                placeholder={side === 'plaintiff' ? 'Margaret Hale' : 'Daniel Brandt'}
                onChange={(e) => onChange({ ...settings.firms, [side]: { ...settings.firms[side], partner: e.target.value } })}
              />
            </label>
          </fieldset>
        ))}
        <p className="muted exchange-note">Emails are signed with the partner&rsquo;s name and &ldquo;Senior Partner&rdquo;.</p>
      </div>
      <div className="exchange-preview">
        <div className="exchange-preview-head">
          <span className="ws-eyebrow">Preview</span>
          <span className={`exchange-side-badge exchange-side-${preview}`}>{SIDE_LABEL[preview]} teams</span>
          <button
            type="button"
            className="link-button"
            onClick={() => setPreview(preview === 'plaintiff' ? 'defense' : 'plaintiff')}
          >
            Show the {preview === 'plaintiff' ? 'defense' : 'plaintiff'} email
          </button>
        </div>
        <WelcomeEmail
          caseTitle={caseTitle}
          firm={settings.firms[preview]}
          side={preview}
          recipients={[]}
          startingFile="the case's starting file"
          documents={sideOptions.filter((o) => o.kind === 'material').map((o) => ({ title: o.name }))}
          witnesses={sideOptions.filter((o) => o.kind === 'witness').map((o) => o.name)}
          disclosures={settings.disclosures.enabled}
          highlightDisclosures
        />
        {settings.disclosures.enabled && (
          <p className="muted exchange-note">The highlighted line only appears when initial disclosures are included.</p>
        )}
      </div>
    </div>
  )
}

function ReviewStep({
  settings,
  disclosed,
  options,
  onEdit,
}: {
  settings: ExchangeSettingsInput
  disclosed: { materialIds: string[]; witnessIds: string[] }
  options: DisclosureOption[]
  onEdit(step: ExchangeStep): void
}) {
  const picked = (side: Side) => {
    const mine = options.filter((o) => o.side === side)
    const w = mine.filter((o) => o.kind === 'witness' && disclosed.witnessIds.includes(o.id)).length
    const f = mine.filter((o) => o.kind === 'material' && disclosed.materialIds.includes(o.id)).length
    return `${SIDE_LABEL[side]}: ${w} witness${w === 1 ? '' : 'es'}, ${f} file${f === 1 ? '' : 's'}`
  }
  const firm = (side: Side) =>
    settings.firms[side].firm ? `${settings.firms[side].partner || 'No partner yet'}, ${settings.firms[side].firm}` : 'No firm yet'
  const rows: { step: ExchangeStep; title: string; summary: string; included: boolean | null }[] = [
    {
      step: 'disclosures',
      title: 'Initial disclosures',
      summary: `${picked('plaintiff')} · ${picked('defense')}`,
      included: settings.disclosures.enabled,
    },
    { step: 'subpoenas', title: 'Subpoenas', summary: subpoenaSummary(settings.subpoenas), included: settings.subpoenas.enabled },
    {
      step: 'interrogatories',
      title: 'Interrogatories',
      summary: partSummary(settings.interrogatories, 'questions'),
      included: settings.interrogatories.enabled,
    },
    { step: 'rfas', title: 'Requests for admission', summary: partSummary(settings.rfas, 'requests'), included: settings.rfas.enabled },
    { step: 'email', title: 'Welcome email', summary: `${firm('plaintiff')} (plaintiff) · ${firm('defense')} (defense)`, included: null },
  ]
  // Not blocking: the instructor can finish now and fill these in later.
  const warnings: string[] = []
  for (const side of ['plaintiff', 'defense'] as const) {
    const label = SIDE_LABEL[side].toLowerCase()
    const mine = options.filter((o) => o.side === side)
    const isPicked = (o: DisclosureOption) => (o.kind === 'witness' ? disclosed.witnessIds : disclosed.materialIds).includes(o.id)
    if (settings.disclosures.enabled && !mine.some(isPicked)) {
      warnings.push(
        mine.length === 0
          ? `The ${label} side has no witnesses or one-side files to disclose yet, so its students have nothing to pick from. Add them on the Witnesses and Case file tabs.`
          : `You haven't picked any ${label} initial disclosures. Students' picks are compared with yours, and nothing is shared when the case moves on.`,
      )
    }
    const firmName = settings.firms[side].firm.trim()
    const partner = settings.firms[side].partner.trim()
    if (!firmName || !partner) {
      warnings.push(
        `The ${label} welcome email has no ${!firmName && !partner ? 'firm or senior partner' : !firmName ? 'firm' : 'senior partner'}, so it's signed "${partner || 'Your senior partner'}" at "${firmName || 'the firm'}".`,
      )
    }
  }
  return (
    <>
      {warnings.length > 0 && (
        <div className="exchange-warnings" aria-label="Before you finish">
          {warnings.map((w) => (
            <p key={w} className="phase-warning">
              <TriangleAlert aria-hidden="true" />
              {w}
            </p>
          ))}
        </div>
      )}
      <ul className="exchange-review" aria-label="Your choices">
        {rows.map((r) => (
          <li key={r.step}>
            <span>
              <strong>
                {r.title}
                {r.included !== null && (
                  <span className={r.included ? 'exchange-status exchange-status-on' : 'exchange-status'}>
                    {r.included ? 'Included' : 'Not included'}
                  </span>
                )}
              </strong>
              <small>{r.included === false ? 'Teams won’t see this.' : r.summary}</small>
            </span>
            <button type="button" className="link-button" onClick={() => onEdit(r.step)} aria-label={`Edit ${r.title.toLowerCase()}`}>
              <Pencil aria-hidden="true" />
              Edit
            </button>
          </li>
        ))}
      </ul>
      <section className="exchange-next" aria-labelledby="exchange-next-title">
        <h3 id="exchange-next-title">What happens next</h3>
        <ol>
          <li>
            <strong>Introduction</strong>
            <small>Teams get the welcome email and the starting file. Each student picks their initial disclosures.</small>
          </li>
          <li>
            <strong>Information exchange</strong>
            <small>Your initial disclosures go to everyone. Teams serve subpoenas, and send interrogatories and requests for admission.</small>
          </li>
          <li>
            <strong>Investigate</strong>
            <small>Teams can use the background investigator.</small>
          </li>
          <li>
            <strong>Deposition</strong>
            <small>Every witness is revealed and can be deposed.</small>
          </li>
        </ol>
      </section>
    </>
  )
}
