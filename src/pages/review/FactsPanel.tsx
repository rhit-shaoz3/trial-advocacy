import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useCourseService } from '../../courses/CourseServiceContext'
import type { CaseFacts, CourseCase, ReviewMode, RuledFact, WorldFacts } from '../../courses/types'
import { ROLE_LABEL, worldLabel } from '../../courses/worldLabel'

/** How often the panel checks back while the AI reads the case files. */
const POLL_MS = 5000

const MODE_LABEL: Record<ReviewMode, string> = { all: 'Review everything', lite: 'Review lite' }
const MODE_HELP: Record<ReviewMode, string> = {
  all: 'Every new fact, file, and subpoena response waits for you.',
  lite: 'The AI’s calls stand at once, for the team’s world only. You see what students flag.',
}

/**
 * The instructor's running list of facts for one case, beside the review
 * queue: what the case files say, the important facts for each side, what's
 * been ruled for every world, and a card for each world. Also where the
 * case's review mode is switched. `version` changes after each ruling, so the
 * list catches up.
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

  const reading = facts?.fileFacts.status === 'working'
  useEffect(() => {
    if (!reading) return
    const timer = setInterval(() => {
      service
        .getCaseFacts(courseId, caseId)
        .then(setFacts)
        .catch(() => {}) // the next tick tries again
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [service, courseId, caseId, reading])

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
    <aside className="facts-panel" aria-label="Facts">
      <div className="facts-panel-head">
        <h2>Facts</h2>
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

      <div className="review-mode" role="group" aria-label={`How to review ${courseCase.title}`}>
        {(['all', 'lite'] as const).map((m) => (
          <button
            key={m}
            type="button"
            className="review-mode-option"
            aria-pressed={mode === m}
            disabled={busy}
            onClick={() =>
              mode !== m && act(async () => onCaseUpdate(await service.setReviewMode(courseId, courseCase.id, m)))
            }
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>
      <p className="facts-help">{MODE_HELP[mode]}</p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!facts ? (
        !error && <p className="muted">Loading facts…</p>
      ) : (
        <>
          <section className="facts-section" aria-label="From the case files">
            <div className="facts-section-head">
              <h3>From the case files</h3>
              <button
                type="button"
                className="facts-refresh"
                aria-label="Read the case files again"
                title="Read the case files again"
                disabled={busy || reading}
                onClick={() => act(async () => setFacts(await service.refreshCaseFacts(courseId, caseId)))}
              >
                <RefreshCw aria-hidden="true" />
              </button>
            </div>
            {reading ? (
              <p className="muted" role="status">
                Reading the case files…
              </p>
            ) : facts.fileFacts.status === 'failed' ? (
              <p className="form-error">Couldn&rsquo;t read the case files. Try again.</p>
            ) : (
              <FactList facts={facts.fileFacts.facts} empty="No case files with text yet." />
            )}
          </section>

          <section className="facts-section" aria-label="Important facts">
            <h3>Important facts</h3>
            <h4>Plaintiff</h4>
            <FactList facts={facts.important.plaintiff} empty="None yet." />
            <h4>Defense</h4>
            <FactList facts={facts.important.defense} empty="None yet." />
          </section>

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

function FactList({ facts, empty }: { facts: string[]; empty: string }) {
  return facts.length === 0 ? (
    <p className="muted facts-empty">{empty}</p>
  ) : (
    <ul className="facts-list">
      {facts.map((f, i) => (
        <li key={i}>{f}</li>
      ))}
    </ul>
  )
}

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
