import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, Circle, CircleCheck, Rocket } from 'lucide-react'
import { useCourseService } from '../../../courses/CourseServiceContext'
import type { CaseMaterial, CourseCase, LaunchCheck } from '../../../courses/types'
import { ImportantFactsField } from '../ImportantFactsField'
import { cleanFacts, missingSide, SIDE_FACT_LABEL, toRows } from '../factRows'
import { CALM_LIFTOFF_MS, LIFTOFF_MS, reducedMotion } from './liftoff'

/** The case page tabs the checklist can send the instructor to. */
export type LaunchTab = 'teams' | 'materials'

/**
 * Shown on a draft case: what still has to happen before the case worlds can
 * launch, and the button that launches them all (making the case active).
 * Each unmet item can be fixed from here: the important facts and the initial
 * file right in the list, teams and worlds on their tab. On launch a rocket
 * lifts off, then `onLaunched` swaps in the phase panel.
 */
export function LaunchPanel({
  courseId,
  courseCase,
  refreshKey,
  onLaunched,
  onCaseChange,
  onGoToTab,
}: {
  courseId: string
  courseCase: CourseCase
  /** Change it to re-check (after teams, worlds, or materials change). */
  refreshKey: number
  onLaunched(launched: CourseCase): void
  /** The case was saved here (its important facts). */
  onCaseChange(updated: CourseCase): void
  onGoToTab(tab: LaunchTab): void
}) {
  const service = useCourseService()
  const caseId = courseCase.id
  const [checks, setChecks] = useState<LaunchCheck[] | null>(null)
  /** Bumped when something is fixed from the checklist itself. */
  const [ownChanges, setOwnChanges] = useState(0)
  const recheck = () => setOwnChanges((n) => n + 1)
  const [editingFacts, setEditingFacts] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [launching, setLaunching] = useState(false)
  /** The launched case, while the rocket lifts off. */
  const [launched, setLaunched] = useState<CourseCase | null>(null)
  const onLaunchedRef = useRef(onLaunched)
  useEffect(() => {
    onLaunchedRef.current = onLaunched
  })

  useEffect(() => {
    if (!launched) return
    const timer = setTimeout(() => onLaunchedRef.current(launched), reducedMotion() ? CALM_LIFTOFF_MS : LIFTOFF_MS)
    return () => clearTimeout(timer)
  }, [launched])

  useEffect(() => {
    let cancelled = false
    service
      .getLaunchChecks(courseId, caseId)
      .then((c) => !cancelled && setChecks(c))
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [service, courseId, caseId, refreshKey, ownChanges])

  const ready = checks !== null && checks.every((c) => c.ok)

  async function handleLaunch() {
    const confirmed = window.confirm(
      'Launch every case world now? The case becomes active and each student sees their team, ' +
        'role, opponents, and the material for their side.',
    )
    if (!confirmed) return
    setError(null)
    setLaunching(true)
    try {
      setLaunched(await service.launchCase(courseId, caseId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setLaunching(false)
    }
  }

  if (launched) {
    return (
      <section className="launch-panel launch-liftoff" aria-labelledby="launch-heading">
        <div className="liftoff-stage" aria-hidden="true">
          <span className="liftoff-smoke">
            <span />
            <span />
            <span />
            <span />
          </span>
          <span className="liftoff-rocket">
            <Rocket className="liftoff-ship" />
            <span className="liftoff-flame" />
          </span>
          <span className="liftoff-sparkles">
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </span>
        </div>
        <div className="liftoff-text">
          <h2 id="launch-heading">Liftoff!</h2>
          <p role="status">Every case world is live. Students can now see their team, role, opponents and material.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="launch-panel" aria-labelledby="launch-heading">
      <div className="launch-body">
        <h2 id="launch-heading">Launch case worlds</h2>
        <p className="muted">
          Students can&rsquo;t see this case until it launches. You can keep adding material afterwards.
        </p>
        {checks && (
          <ul className="launch-checks" aria-label="Launch checklist">
            {checks.map((c) => (
              <li key={c.key} className={c.ok ? 'launch-ok' : undefined}>
                <span className="launch-check-line">
                  {c.ok ? <CircleCheck aria-label="Done" /> : <Circle aria-label="To do" />}
                  {c.message}
                  {c.key === 'importantFacts' && !editingFacts && (
                    <button type="button" className="link-button launch-fix" onClick={() => setEditingFacts(true)}>
                      {c.ok ? 'Edit' : 'Add important facts'}
                    </button>
                  )}
                  {(c.key === 'paired' || c.key === 'matched') && !c.ok && (
                    <button type="button" className="link-button launch-fix" onClick={() => onGoToTab('teams')}>
                      Go to Teams &amp; worlds <ArrowRight aria-hidden="true" />
                    </button>
                  )}
                </span>
                {c.key === 'importantFacts' && !c.ok && !editingFacts && (
                  <small className="launch-check-hint">
                    The key facts each side&rsquo;s case rests on. The AI witnesses never contradict them, and students
                    never see them.
                  </small>
                )}
                {c.key === 'importantFacts' && editingFacts && (
                  <FactsEditor
                    courseId={courseId}
                    courseCase={courseCase}
                    onSaved={(updated) => {
                      onCaseChange(updated)
                      setEditingFacts(false)
                      recheck()
                    }}
                    onCancel={() => setEditingFacts(false)}
                  />
                )}
                {c.key === 'caseFile' && !c.ok && (
                  <InitialFilePicker
                    courseId={courseId}
                    caseId={caseId}
                    refreshKey={refreshKey}
                    onChosen={recheck}
                    onUpload={() => onGoToTab('materials')}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <button type="button" className="btn-primary launch-button" onClick={handleLaunch} disabled={!ready || launching}>
        <Rocket aria-hidden="true" />
        {launching ? 'Launching…' : 'Launch case worlds'}
      </button>
    </section>
  )
}

/** Both sides' important facts, edited in the checklist and saved to the case. */
function FactsEditor({
  courseId,
  courseCase,
  onSaved,
  onCancel,
}: {
  courseId: string
  courseCase: CourseCase
  onSaved(updated: CourseCase): void
  onCancel(): void
}) {
  const service = useCourseService()
  const [plaintiff, setPlaintiff] = useState(() => toRows(courseCase.importantFacts.plaintiff))
  const [defense, setDefense] = useState(() => toRows(courseCase.importantFacts.defense))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    const importantFacts = { plaintiff: cleanFacts(plaintiff), defense: cleanFacts(defense) }
    const missing = missingSide(importantFacts)
    if (missing) {
      setError(`List at least one important fact for the ${SIDE_FACT_LABEL[missing]}.`)
      return
    }
    setSaving(true)
    setError(null)
    try {
      onSaved(
        await service.updateCase(courseId, courseCase.id, {
          title: courseCase.title,
          summary: courseCase.summary,
          status: courseCase.status,
          importantFacts,
        }),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setSaving(false)
    }
  }

  return (
    <form className="launch-facts case-facts" aria-label="Important facts" onSubmit={save}>
      <p className="muted">
        One short fact per line, such as &ldquo;The lap bar was never locked.&rdquo; The AI witnesses never contradict
        these, and students never see them.
      </p>
      <ImportantFactsField side="plaintiff" rows={plaintiff} onChange={setPlaintiff} />
      <ImportantFactsField side="defense" rows={defense} onChange={setDefense} />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="launch-facts-actions">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save facts'}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/**
 * Chooses the initial file from the case file, or, with nothing uploaded
 * yet, sends the instructor to the Case file tab to upload one.
 */
function InitialFilePicker({
  courseId,
  caseId,
  refreshKey,
  onChosen,
  onUpload,
}: {
  courseId: string
  caseId: string
  refreshKey: number
  onChosen(): void
  onUpload(): void
}) {
  const service = useCourseService()
  const [files, setFiles] = useState<CaseMaterial[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    service
      .listMaterials(courseId, caseId)
      .then((list) => !cancelled && setFiles(list))
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [service, courseId, caseId, refreshKey])

  async function choose(materialId: string) {
    if (!materialId) return
    setSaving(true)
    setError(null)
    try {
      await service.setInitialMaterial(courseId, caseId, materialId)
      onChosen()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSaving(false)
    }
  }

  if (!files) return error ? <small className="form-error">{error}</small> : null
  return (
    <div className="launch-initial">
      {files.length === 0 ? (
        <>
          <small className="launch-check-hint">Upload the case&rsquo;s files first, such as the complaint.</small>
          <button type="button" className="link-button launch-fix" onClick={onUpload}>
            Upload files on the Case file tab <ArrowRight aria-hidden="true" />
          </button>
        </>
      ) : (
        <>
          <small className="launch-check-hint">Every team starts from this file, such as the complaint.</small>
          <select
            className="inline-select"
            value=""
            aria-label="Initial file"
            disabled={saving}
            onChange={(e) => void choose(e.target.value)}
          >
            <option value="">Choose the initial file…</option>
            {files.map((f) => (
              <option key={f.id} value={f.id}>
                {f.description ? `${f.filename} (${f.description})` : f.filename}
              </option>
            ))}
          </select>
        </>
      )}
      {error && <small className="form-error">{error}</small>}
    </div>
  )
}
