import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useCourseService } from '../../../courses/CourseServiceContext'
import { DEFAULT_PLANNER, FEEDBACK_LEVELS, type CourseCase, type FeedbackLevel, type TeamPlannerSummary, type Witness } from '../../../courses/types'
import { ROLE_LABEL, worldLabel } from '../../../courses/worldLabel'
import { shortDate } from '../../../courses/caseLabels'
import { PlannerPanel } from '../../../caseWorkspace/planner/PlannerPanel'
import type { PlannerActions } from '../../../caseWorkspace/planner/usePlanner'
import type { FeedbackActions } from '../../../caseWorkspace/planner/usePlannerFeedback'
import { LimitField } from '../content/LimitField'
import { limitDraft, parseLimit, sameLimit } from '../content/limitDraft'

/**
 * The case planner, for the instructor: whether students get it and how many
 * rounds of feedback, then each team's progress, and any team's chart to read.
 */
export function PlannersTab({
  courseId,
  courseCase,
  onCaseChange,
}: {
  courseId: string
  courseCase: CourseCase
  onCaseChange(updated: CourseCase): void
}) {
  const service = useCourseService()
  const [teams, setTeams] = useState<TeamPlannerSummary[] | null>(null)
  const [witnesses, setWitnesses] = useState<Witness[]>([])
  const [open, setOpen] = useState<TeamPlannerSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    service
      .listTeamPlanners(courseId, courseCase.id)
      .then((t) => !cancelled && setTeams(t))
      .catch((err: Error) => !cancelled && setError(err.message))
    service
      .listWitnesses(courseId, courseCase.id)
      .then((w) => !cancelled && setWitnesses(w))
      .catch(() => {}) // the charts still show without witness names
    return () => {
      cancelled = true
    }
  }, [service, courseId, courseCase.id])

  const actions = useMemo<{ chart: PlannerActions; feedback: FeedbackActions } | null>(
    () =>
      open && {
        chart: {
          load: async () => (await service.getTeamPlanner(courseId, courseCase.id, open.teamId)).planner,
          sources: async () => [],
          change: () => Promise.reject(new Error('The team’s planner is read-only here.')),
        },
        feedback: { load: async () => (await service.getTeamPlanner(courseId, courseCase.id, open.teamId)).feedback },
      },
    [service, courseId, courseCase.id, open],
  )

  return (
    <>
      <PlannerSettingsForm courseId={courseId} courseCase={courseCase} onSaved={onCaseChange} />
      <section className="course-section" aria-labelledby="planners-heading">
        <div className="section-header">
          <h2 id="planners-heading">Teams&rsquo; planners</h2>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {teams === null && !error && <p className="muted">Loading…</p>}
        {teams?.length === 0 && <p className="muted">Teams get their planners once they&rsquo;re in case worlds.</p>}
        {teams && teams.length > 0 && (
          <ul className="planner-teams">
            {teams.map((t) => (
              <li key={t.teamId}>
                <div>
                  <strong>
                    Team {t.teamNumber} · {ROLE_LABEL[t.side]}
                  </strong>
                  <small>
                    Case world {worldLabel(t.worldNumber)} ·{' '}
                    {t.cards === 0
                      ? 'Not started'
                      : `${t.cards} ${t.cards === 1 ? 'card' : 'cards'}, ${t.gaps} ${t.gaps === 1 ? 'gap' : 'gaps'}, ${t.tools} ${
                          t.tools === 1 ? 'tool' : 'tools'
                        }`}
                    {t.updatedAt && ` · last changed ${shortDate(t.updatedAt)}`}
                  </small>
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  aria-pressed={open?.teamId === t.teamId}
                  onClick={() => setOpen(open?.teamId === t.teamId ? null : t)}
                >
                  {open?.teamId === t.teamId ? 'Close' : 'Open planner'}
                </button>
              </li>
            ))}
          </ul>
        )}
        {open && actions && (
          <div className="cw planner-view">
            <PlannerPanel
              key={open.teamId}
              actions={actions.chart}
              feedback={actions.feedback}
              witnesses={witnesses}
              rootLabel={`Team ${open.teamNumber}: ${ROLE_LABEL[open.side]}`}
              readOnly
            />
          </div>
        )}
      </section>
    </>
  )
}

const LEVEL: Record<FeedbackLevel, { label: string; hint: string }> = {
  gentle: {
    label: 'Gentle',
    hint: 'The big picture only: whether the chart covers what must be proven and tells one story. A few points, nothing students can’t be expected to know yet, and a fair try at last round’s points is enough.',
  },
  balanced: {
    label: 'Balanced',
    hint: 'The points that matter most, going into detail only where it would change the plan. A fair try at last round’s points is enough.',
  },
  rigorous: {
    label: 'Rigorous',
    hint: 'Like a supervising attorney before trial: more points, including foundation, admissibility, credibility, and the order of the tools. Last round’s points have to be resolved.',
  },
}

/** "How much help": a slider from gentle to rigorous. */
function LevelSlider({ value, onChange, disabled }: { value: FeedbackLevel; onChange(level: FeedbackLevel): void; disabled?: boolean }) {
  const at = FEEDBACK_LEVELS.indexOf(value)
  return (
    <div className="planner-level">
      <label htmlFor="planner-level">How demanding the feedback is</label>
      <input
        id="planner-level"
        type="range"
        min={0}
        max={FEEDBACK_LEVELS.length - 1}
        step={1}
        value={at}
        disabled={disabled}
        aria-valuetext={LEVEL[value].label}
        aria-describedby="planner-level-hint"
        onChange={(e) => onChange(FEEDBACK_LEVELS[Number(e.target.value)])}
      />
      <div className="planner-level-ticks" aria-hidden="true">
        {FEEDBACK_LEVELS.map((l) => (
          <span key={l} className={l === value ? 'planner-level-on' : undefined}>
            {LEVEL[l].label}
          </span>
        ))}
      </div>
      <span id="planner-level-hint" className="muted field-hint">
        {LEVEL[value].hint}
      </span>
    </div>
  )
}

function PlannerSettingsForm({
  courseId,
  courseCase,
  onSaved,
}: {
  courseId: string
  courseCase: CourseCase
  onSaved(updated: CourseCase): void
}) {
  const service = useCourseService()
  const [initial, setInitial] = useState(() => courseCase.planner ?? DEFAULT_PLANNER)
  const [enabled, setEnabled] = useState(initial.enabled)
  const [limit, setLimit] = useState(() => limitDraft(initial.reviewLimit))
  const [level, setLevel] = useState<FeedbackLevel>(initial.feedbackLevel ?? 'balanced')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const parsed = parseLimit(limit)
  const changed =
    enabled !== initial.enabled || !sameLimit(parsed, initial.reviewLimit) || level !== (initial.feedbackLevel ?? 'balanced')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!parsed) return
    setSaving(true)
    setError(null)
    try {
      const updated = await service.savePlannerSettings(courseId, courseCase.id, { enabled, reviewLimit: parsed, feedbackLevel: level })
      const next = updated.planner ?? DEFAULT_PLANNER
      setInitial(next)
      setLimit(limitDraft(next.reviewLimit))
      setLevel(next.feedbackLevel ?? 'balanced')
      setSaved(true)
      onSaved(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="course-section" aria-labelledby="planner-settings-heading">
      <div className="section-header">
        <h2 id="planner-settings-heading">Case planner</h2>
      </div>
      <p className="muted section-hint">
        Each team builds a chart of what it must prove: the facts of consequence, the sub-facts and evidence for each, the
        witnesses it will call, the gaps it still has, and the tools it would use to fill them. Teams can ask an AI mentor
        for feedback in rounds. The mentor asks questions to make them think; it never edits the chart or gives answers,
        and it never hints at evidence the team hasn&rsquo;t seen.
      </p>
      <form className="panel-form investigator-form" onSubmit={handleSubmit} aria-label="Planner settings">
        <label className="investigator-toggle">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked)
              setSaved(false)
            }}
          />
          Give teams the case planner
        </label>
        <LimitField
          label="Rounds of feedback"
          hint="Each time a team asks for feedback on its chart counts as one. Per student, each partner has their own."
          value={limit}
          onChange={(next) => {
            setLimit(next)
            setSaved(false)
          }}
          disabled={!enabled}
        />
        <LevelSlider
          value={level}
          disabled={!enabled}
          onChange={(next) => {
            setLevel(next)
            setSaved(false)
          }}
        />
        <div className="panel-form-actions">
          <button type="submit" className="btn-primary" disabled={saving || !changed || !parsed}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {saved && !changed && (
            <span className="muted" role="status">
              Saved.
            </span>
          )}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  )
}
