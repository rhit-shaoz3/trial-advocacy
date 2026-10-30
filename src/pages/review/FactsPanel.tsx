import { useEffect, useState } from 'react'
import { useCourseService } from '../../courses/CourseServiceContext'
import type { CaseFacts, CourseCase, ReviewMode, RuledFact, WorldFacts } from '../../courses/types'
import { ROLE_LABEL, worldLabel } from '../../courses/worldLabel'

/** What the Review lite switch does, on and off. */
const MODE_HELP: Record<ReviewMode, string> = {
  all: 'Off: every new fact, file, and subpoena response waits for you.',
  lite: 'On: the AI’s calls stand at once, for the team’s world only. You see what students flag.',
}

/**
 * The instructor's running list of new facts for one case, beside the review
 * queue: what's been ruled for every world, and a card for each world. Also
 * where the case's Review lite switch is. `version` changes after each
 * ruling, so the list catches up.
 */
export function FactsPanel({
  courseId,
  cases,
  caseId,
  onCaseChange,
  onCaseUpdate,
  version,
}: {
  courseId: string
  cases: CourseCase[]
  caseId: string
  onCaseChange(caseId: string): void
  /** A case whose review mode changed. */
  onCaseUpdate(updated: CourseCase): void
  version: number
}) {
  const service = useCourseService()
  const courseCase = cases.find((c) => c.id === caseId)
  const [facts, setFacts] = useState<CaseFacts | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const mode = courseCase?.reviewMode ?? 'all'

  useEffect(() => {
    if (!caseId) return
    let cancelled = false
    setError(null)
    service
      .getCaseFacts(courseId, caseId)
      .then((f) => !cancelled && setFacts(f))
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [service, courseId, caseId, version])

  async function act(run: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await run()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  if (!courseCase) return null
  return (
    <aside className="facts-panel" aria-label="New facts">
      <div className="facts-panel-head">
        <h2>New facts</h2>
        {cases.length > 1 && (
          <label className="facts-case">
            <span className="visually-hidden">Case</span>
            <select value={caseId} onChange={(e) => onCaseChange(e.target.value)}>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {cases.length === 1 && <p className="ws-eyebrow">{courseCase.title}</p>}
      </div>

      {/* A setting for the case, switched on or off. */}
      <label className="review-lite">
        <span>
          <strong>Review lite</strong>
          <small className="facts-help">{MODE_HELP[mode]}</small>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          checked={mode === 'lite'}
          disabled={busy}
          onChange={(e) => {
            const next: ReviewMode = e.target.checked ? 'lite' : 'all'
            void act(async () => onCaseUpdate(await service.setReviewMode(courseId, courseCase.id, next)))
          }}
          aria-label={`Review lite for ${courseCase.title}`}
        />
      </label>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!facts ? (
        !error && <p className="muted">Loading facts…</p>
      ) : (
        <>
          <section className="facts-section" aria-label="Ruled for all worlds">
            <h3>Ruled for all worlds</h3>
            <RuledLists accepted={facts.allWorlds.accepted} denied={facts.allWorlds.denied} />
          </section>

          {facts.worlds.length > 0 && (
            <section className="facts-section" aria-label="Each world">
              <h3>Each world</h3>
              {facts.worlds.map((w) => (
                <details key={w.matchupId} className="world-facts">
                  <summary>{worldTitle(w)}</summary>
                  <RuledLists accepted={w.accepted} denied={w.denied} />
                </details>
              ))}
            </section>
          )}
        </>
      )}
    </aside>
  )
}

const worldTitle = (w: WorldFacts) =>
  `World ${worldLabel(w.number)}${w.teams.length ? ' · ' : ''}${w.teams
    .map((t) => `Team ${t.number} (${ROLE_LABEL[t.side]})`)
    .join(' v. ')}`

function RuledLists({ accepted, denied }: { accepted: RuledFact[]; denied: RuledFact[] }) {
  if (!accepted.length && !denied.length) return <p className="muted facts-empty">Nothing ruled yet.</p>
  const list = (items: RuledFact[]) => (
    <ul className="facts-list">
      {items.map((f, i) => (
        <li key={i}>
          {f.text}
          <small className="muted">
            {f.source}
            {f.auto ? ' · automatic' : ''}
          </small>
        </li>
      ))}
    </ul>
  )
  return (
    <>
      {accepted.length > 0 && (
        <>
          <h4>Accepted</h4>
          {list(accepted)}
        </>
      )}
      {denied.length > 0 && (
        <>
          <h4>Denied</h4>
          {list(denied)}
        </>
      )}
    </>
  )
}

/** One world's facts, inside a review card: loaded when opened, so the instructor can refresh their memory. */
export function WorldFactsDetails({ courseId, caseId, worldNumber }: { courseId: string; caseId: string; worldNumber: number }) {
  const service = useCourseService()
  const [world, setWorld] = useState<WorldFacts | null>(null)
  const [error, setError] = useState<string | null>(null)

  function load(open: boolean) {
    if (!open) return
    service
      .getCaseFacts(courseId, caseId)
      .then((f) => {
        const found = f.worlds.find((w) => w.number === worldNumber)
        if (found) setWorld(found)
        else setError('This world is gone.')
      })
      .catch((err: Error) => setError(err.message))
  }

  return (
    <details className="review-transcript world-facts-details" onToggle={(e) => load(e.currentTarget.open)}>
      <summary>World {worldLabel(worldNumber)} facts</summary>
      {error ? (
        <p className="form-error">{error}</p>
      ) : !world ? (
        <p className="muted">Loading…</p>
      ) : (
        <RuledLists accepted={world.accepted} denied={world.denied} />
      )}
    </details>
  )
}
