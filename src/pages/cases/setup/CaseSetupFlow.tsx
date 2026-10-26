import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, Check, PartyPopper, Share2 } from 'lucide-react'
import confetti from 'canvas-confetti'
import { useCourseService } from '../../../courses/CourseServiceContext'
import { SETUP_STEPS, type CourseCase, type SetupStep } from '../../../courses/types'
import { MaterialsSection } from '../content/MaterialsSection'
import { TasksSection } from '../content/TasksSection'
import { InvestigatorSection } from '../content/InvestigatorSection'
import { WitnessesSection } from '../content/WitnessesSection'
import { cleanFacts, toRows } from '../factRows'
import { ImportantFactsField } from '../ImportantFactsField'
import { TeamsSection } from '../TeamsSection'
import './CaseSetupFlow.css'
import { DictationTextarea } from '../../../components/Dictation'

const STEP_LABEL: Record<SetupStep, string> = {
  details: 'Details',
  facts: 'Important facts',
  files: 'Case file',
  teams: 'Teams',
  worlds: 'Case worlds',
  witnesses: 'Witnesses',
  investigator: 'Investigator',
  tasks: 'Tasks',
}

const STEP_HINT: Record<SetupStep, string> = {
  details: 'Name the case and describe it in a sentence or two. Students see both once it launches.',
  facts:
    'The most important facts for each side. The AI witnesses never contradict them, and students don’t see them. You can skip this for now, but the case can’t launch until each side has at least one.',
  files:
    'Upload the documents, photos and recordings in the case, and choose who sees each. Make one the initial file: every team starts from it, and the case can’t launch without one.',
  teams: 'Put students into teams for this case. Drag them in, or make teams automatically.',
  worlds: 'Set teams against each other in case worlds: one team for the plaintiff, one for the defense.',
  witnesses: 'Add the people in the case. With a side and a deposition file, a witness becomes an AI witness teams can interview.',
  investigator:
    'Decide whether teams get a background investigator to email in the investigate phase. He starts as John Hastings; rename him and add instructions if you like. Skip for now to keep him as he is.',
  tasks: 'Assign the work each team does, with due dates.',
}

/** The steps with their own form; the rest show one of the case page's sections. */
const OWN_HEADING: SetupStep[] = ['details', 'facts']

export type SetupExit = 'exchange' | 'case'

/**
 * Setting up a new case, one step at a time: details, important facts, the
 * case file, teams, case worlds, witnesses and tasks. The top bar shows the
 * steps reached so far (click one to go back), and every step after the first
 * can be skipped. Finishing shows a congratulations screen.
 */
export function CaseSetupFlow({
  courseId,
  courseCase,
  onCaseChange,
  onContentChange,
  onExit,
}: {
  courseId: string
  /** Null until the first step creates the case. */
  courseCase: CourseCase | null
  /** The case was created or saved; for a new one, the page moves to its address. */
  onCaseChange(updated: CourseCase): void
  /** Teams or files changed (for the dashboard and launch checklist). */
  onContentChange?(): void
  /** After the congratulations: where the instructor chose to go. */
  onExit(to: SetupExit): void
}) {
  const service = useCourseService()
  const furthest = courseCase ? SETUP_STEPS.indexOf(courseCase.setupStep ?? 'details') : 0
  const [step, setStep] = useState<SetupStep>(SETUP_STEPS[furthest])
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [finished, setFinished] = useState(false)

  const index = SETUP_STEPS.indexOf(step)
  const last = index === SETUP_STEPS.length - 1

  function go(to: SetupStep) {
    setDirection(SETUP_STEPS.indexOf(to) < index ? 'back' : 'forward')
    setError(null)
    setStep(to)
  }

  /** Runs the step's save (if any), records the next step as reached, and moves on. */
  async function advance(save?: () => Promise<CourseCase>) {
    setBusy(true)
    setError(null)
    try {
      let saved = save ? await save() : courseCase!
      if (last) {
        saved = await service.completeSetup(courseId, saved.id)
        onCaseChange(saved)
        setFinished(true)
        return
      }
      const next = SETUP_STEPS[index + 1]
      if (SETUP_STEPS.indexOf(next) > SETUP_STEPS.indexOf(saved.setupStep ?? 'details')) {
        saved = await service.reachSetupStep(courseId, saved.id, next)
      }
      onCaseChange(saved)
      // A case just created carries on at its own address, so this page goes away.
      if (courseCase) go(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  if (finished && courseCase) return <SetupDone title={courseCase.title} onExit={onExit} />

  const reached = SETUP_STEPS.slice(0, Math.max(furthest, index) + 1)

  return (
    <div className="setup">
      <header className="setup-header">
        <span className="ws-eyebrow">New case</span>
        <h1>{courseCase?.title || 'Set up a case'}</h1>
        <nav aria-label="Setup steps">
          <ol className="setup-steps">
            {reached.map((s, i) => (
              <li key={s}>
                <button
                  type="button"
                  className={s === step ? 'setup-step-current' : undefined}
                  aria-current={s === step ? 'step' : undefined}
                  onClick={() => go(s)}
                  disabled={busy}
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
        <div className="setup-intro">
          <span className="setup-count">
            Step {index + 1} of {SETUP_STEPS.length}
          </span>
          {/* The later steps reuse the case page's sections, which bring their own heading. */}
          {OWN_HEADING.includes(step) && <h2>{STEP_LABEL[step]}</h2>}
          <p className="muted">{STEP_HINT[step]}</p>
        </div>

        {step === 'details' && (
          <DetailsStep
            courseCase={courseCase}
            busy={busy}
            error={error}
            onNext={(title, summary) =>
              advance(async () => {
                if (!courseCase) return service.createCase(courseId, { title, summary })
                if (title === courseCase.title && summary === courseCase.summary) return courseCase
                return service.updateCase(courseId, courseCase.id, { title, summary, status: courseCase.status })
              })
            }
          />
        )}
        {step === 'facts' && courseCase && (
          <FactsStep
            courseCase={courseCase}
            busy={busy}
            error={error}
            onSkip={() => advance()}
            onNext={(importantFacts) =>
              advance(() =>
                service.updateCase(courseId, courseCase.id, {
                  title: courseCase.title,
                  summary: courseCase.summary,
                  status: courseCase.status,
                  importantFacts,
                }),
              )
            }
          />
        )}
        {courseCase && !['details', 'facts'].includes(step) && (
          <>
            {step === 'files' && <MaterialsSection courseId={courseId} caseId={courseCase.id} onChange={onContentChange} />}
            {step === 'teams' && (
              <TeamsSection courseId={courseId} caseId={courseCase.id} closed={false} onChange={onContentChange} part="teams" />
            )}
            {step === 'worlds' && (
              <TeamsSection courseId={courseId} caseId={courseCase.id} closed={false} onChange={onContentChange} part="worlds" />
            )}
            {step === 'witnesses' && (
              <WitnessesSection courseId={courseId} courseCase={courseCase} onCaseChange={onCaseChange} />
            )}
            {step === 'investigator' && (
              <InvestigatorSection courseId={courseId} courseCase={courseCase} onSaved={onCaseChange} />
            )}
            {step === 'tasks' && <TasksSection courseId={courseId} caseId={courseCase.id} />}
            <SetupFooter error={error}>
              <button type="button" className="setup-skip" onClick={() => advance()} disabled={busy}>
                Skip for now
              </button>
              <button type="button" className="setup-next" onClick={() => advance()} disabled={busy}>
                {last ? 'Finish' : 'Next'}
                {!last && <ArrowRight aria-hidden="true" />}
              </button>
            </SetupFooter>
          </>
        )}
      </div>
    </div>
  )
}

function SetupFooter({ error, children }: { error: string | null; children: ReactNode }) {
  return (
    <div className="setup-footer">
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="setup-footer-buttons">{children}</div>
    </div>
  )
}

function DetailsStep({
  courseCase,
  busy,
  error,
  onNext,
}: {
  courseCase: CourseCase | null
  busy: boolean
  error: string | null
  onNext(title: string, summary: string): void
}) {
  const [title, setTitle] = useState(courseCase?.title ?? '')
  const [summary, setSummary] = useState(courseCase?.summary ?? '')
  const ready = title.trim() !== '' && summary.trim() !== ''

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (ready) onNext(title.trim(), summary.trim())
  }

  return (
    <form className="setup-form" onSubmit={handleSubmit} aria-label="Case details">
      <label>
        Case name
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Rivera v. Thrill Park"
          maxLength={120}
          required
          autoFocus
        />
      </label>
      <label>
        Description
        <DictationTextarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="A rollercoaster stopped mid-loop and a rider was hurt. Was the park negligent?"
          maxLength={2000}
          rows={4}
          required
        />
      </label>
      <SetupFooter error={error}>
        <button type="submit" className="setup-next" disabled={!ready || busy}>
          Next
          <ArrowRight aria-hidden="true" />
        </button>
      </SetupFooter>
    </form>
  )
}

function FactsStep({
  courseCase,
  busy,
  error,
  onSkip,
  onNext,
}: {
  courseCase: CourseCase
  busy: boolean
  error: string | null
  onSkip(): void
  onNext(facts: CourseCase['importantFacts']): void
}) {
  const [plaintiff, setPlaintiff] = useState(() => toRows(courseCase.importantFacts.plaintiff))
  const [defense, setDefense] = useState(() => toRows(courseCase.importantFacts.defense))

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    onNext({ plaintiff: cleanFacts(plaintiff), defense: cleanFacts(defense) })
  }

  return (
    <form className="setup-form" onSubmit={handleSubmit} aria-label="Important facts">
      <div className="case-facts">
        <ImportantFactsField side="plaintiff" rows={plaintiff} onChange={setPlaintiff} />
        <ImportantFactsField side="defense" rows={defense} onChange={setDefense} />
      </div>
      <SetupFooter error={error}>
        <button type="button" className="setup-skip" onClick={onSkip} disabled={busy}>
          Skip for now
        </button>
        <button type="submit" className="setup-next" disabled={busy}>
          Next
          <ArrowRight aria-hidden="true" />
        </button>
      </SetupFooter>
    </form>
  )
}

/** The end of the setup: confetti, and where to go next. */
function SetupDone({ title, onExit }: { title: string; onExit(to: SetupExit): void }) {
  useEffect(() => {
    const colors = ['#b98b42', '#a84b43', '#315e86', '#3f7d5c', '#f5f3ee']
    const burst = (x: number, angle: number) =>
      confetti({ particleCount: 90, spread: 70, startVelocity: 50, angle, origin: { x, y: 0.7 }, colors, disableForReducedMotion: true })
    burst(0.2, 60)
    burst(0.8, 120)
    const again = setTimeout(() => confetti({ particleCount: 120, spread: 110, origin: { y: 0.55 }, colors, disableForReducedMotion: true }), 350)
    return () => {
      clearTimeout(again)
      confetti.reset()
    }
  }, [])

  return (
    <section className="setup-done" aria-labelledby="setup-done-heading">
      <span className="setup-done-icon" aria-hidden="true">
        <PartyPopper />
      </span>
      <h1 id="setup-done-heading">
        Congratulations, you created a new case: <em>{title}</em>!
      </h1>
      <p className="muted">
        It&rsquo;s still a draft, so students can&rsquo;t see it yet. Launch the case worlds from the case page when
        everything is ready. To see the case the way students will, open the Student view tab on the case page.
      </p>
      <div className="setup-footer-buttons setup-done-buttons">
        <button type="button" className="setup-skip" onClick={() => onExit('case')}>
          Go to the case
        </button>
        <button type="button" className="setup-next" onClick={() => onExit('exchange')}>
          <Share2 aria-hidden="true" />
          Set up information exchange
        </button>
      </div>
      <p className="muted setup-done-note">
        Information exchange covers initial disclosures, subpoenas, interrogatories, and requests for admission. You can
        also set it up later from the case page.
      </p>
    </section>
  )
}
