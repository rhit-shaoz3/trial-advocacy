import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { DictationTextarea } from '../../components/Dictation'
import { Modal } from '../../components/Modal'
import { useCourseService } from '../../courses/CourseServiceContext'
import type { CalendarEventInput, CalendarItem, CalendarKind } from '../../courses/types'
import { useWorkspace } from '../../workspace/useWorkspace'
import { dayKey, dayTitle, monthGrid, monthTitle } from './calendarDates'
import './CalendarPage.css'

const KIND_LABEL: Record<CalendarKind, string> = {
  task: 'Tasks',
  case: 'Case dates',
  personal: 'Personal',
  team: 'Team',
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** How many items a day shows before "+N more". */
const MAX_PER_DAY = 3

/** A case the user can attach an event to: the instructor's launched cases, or a student's team's. */
interface CaseOption {
  id: string
  title: string
}

/**
 * The course calendar: tasks on their due dates, the instructor's case dates,
 * personal events, and (for students) events shared with their team, each in
 * its own colour and filterable.
 */
export function CalendarPage() {
  const { user } = useAuth()
  const { home, search } = useWorkspace()
  const service = useCourseService()
  const courseId = home.course.id
  const instructor = user?.role === 'instructor'
  const kinds: CalendarKind[] = instructor ? ['task', 'case', 'personal'] : ['task', 'case', 'personal', 'team']

  const [items, setItems] = useState<CalendarItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cases, setCases] = useState<CaseOption[]>([])
  const [shown, setShown] = useState<Set<CalendarKind>>(() => new Set(kinds))
  const today = dayKey(new Date())
  const [month, setMonth] = useState(() => ({ year: new Date().getFullYear(), month: new Date().getMonth() }))
  const [adding, setAdding] = useState<string | null>(null)
  const [open, setOpen] = useState<CalendarItem | null>(null)

  useEffect(() => {
    let cancelled = false
    service
      .getCalendar(courseId)
      .then((list) => !cancelled && setItems(list))
      .catch((err: Error) => !cancelled && setError(err.message))
    const loadCases = instructor
      ? service.listCases(courseId).then((list) => list.filter((c) => c.status !== 'draft'))
      : service.listMyCases(courseId).then((list) => list.filter((c) => c.team))
    loadCases.then((list) => !cancelled && setCases(list.map((c) => ({ id: c.id, title: c.title }))), () => {})
    return () => {
      cancelled = true
    }
  }, [service, courseId, instructor])

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>()
    for (const item of items ?? []) {
      if (!shown.has(item.kind)) continue
      map.set(item.date, [...(map.get(item.date) ?? []), item])
    }
    return map
  }, [items, shown])

  const days = monthGrid(month.year, month.month)
  const inMonth = (d: Date) => d.getMonth() === month.month
  const monthItems = days.filter(inMonth).flatMap((d) => (byDay.get(dayKey(d)) ?? []).map((item) => item))

  function step(by: number) {
    setMonth(({ year, month: m }) => {
      const d = new Date(year, m + by, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })
  }

  function toggle(kind: CalendarKind) {
    setShown((prev) => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  return (
    <main className="ws-page cal-page">
      <div className="ws-welcome">
        <div>
          <span className="ws-eyebrow">{home.course.code}</span>
          <h1 className="ws-title">Calendar</h1>
          <p className="ws-subtle">
            {instructor
              ? 'Task due dates and the dates you mark for each case, which everyone in the case sees.'
              : 'Your tasks, your instructor’s case dates, and your own events, which you can share with your team.'}
          </p>
        </div>
        <button type="button" className="ws-btn ws-btn-primary" onClick={() => setAdding(today)}>
          <Plus aria-hidden="true" />
          Add event
        </button>
      </div>

      <div className="cal-toolbar">
        <div className="cal-filters" role="group" aria-label="Show on the calendar">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              className={`cal-filter cal-kind-${k}`}
              aria-pressed={shown.has(k)}
              onClick={() => toggle(k)}
            >
              <i aria-hidden="true" />
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <div className="cal-nav">
          <button type="button" className="ws-btn ws-btn-secondary cal-nav-btn" aria-label="Previous month" onClick={() => step(-1)}>
            <ChevronLeft aria-hidden="true" />
          </button>
          <h2 className="cal-month" aria-live="polite">
            {monthTitle(month.year, month.month)}
          </h2>
          <button type="button" className="ws-btn ws-btn-secondary cal-nav-btn" aria-label="Next month" onClick={() => step(1)}>
            <ChevronRight aria-hidden="true" />
          </button>
          <button
            type="button"
            className="ws-btn ws-btn-secondary"
            onClick={() => setMonth({ year: new Date().getFullYear(), month: new Date().getMonth() })}
          >
            Today
          </button>
        </div>
      </div>

      {error ? (
        <p className="form-error" role="alert">
          Could not load the calendar. {error}
        </p>
      ) : !items ? (
        <p className="ws-subtle">Loading the calendar…</p>
      ) : (
        <>
          <div className="cal-grid" role="grid" aria-label={monthTitle(month.year, month.month)}>
            <div className="cal-row cal-weekdays" role="row">
              {WEEKDAYS.map((w) => (
                <span key={w} role="columnheader">
                  {w}
                </span>
              ))}
            </div>
            {Array.from({ length: days.length / 7 }, (_, week) => (
              <div className="cal-row" role="row" key={week}>
                {days.slice(week * 7, week * 7 + 7).map((d) => {
                  const key = dayKey(d)
                  const dayItems = byDay.get(key) ?? []
                  return (
                    <div
                      key={key}
                      role="gridcell"
                      className={`cal-day${inMonth(d) ? '' : ' cal-day-out'}${key === today ? ' cal-today' : ''}`}
                      aria-label={dayTitle(key)}
                    >
                      <button type="button" className="cal-day-number" aria-label={`Add an event on ${dayTitle(key)}`} onClick={() => setAdding(key)}>
                        {d.getDate()}
                      </button>
                      {dayItems.slice(0, MAX_PER_DAY).map((item) => (
                        <button
                          key={`${item.kind}-${item.id}`}
                          type="button"
                          className={`cal-item cal-kind-${item.kind}${item.done ? ' cal-item-done' : ''}`}
                          onClick={() => setOpen(item)}
                        >
                          {item.title}
                        </button>
                      ))}
                      {dayItems.length > MAX_PER_DAY && (
                        <span className="cal-more">+{dayItems.length - MAX_PER_DAY} more</span>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          <section className="cal-agenda" aria-labelledby="cal-agenda-title">
            <h2 id="cal-agenda-title">This month</h2>
            {monthItems.length === 0 ? (
              <p className="ws-subtle">Nothing on the calendar this month.</p>
            ) : (
              <ul>
                {monthItems.map((item) => (
                  <li key={`${item.kind}-${item.id}`}>
                    <button type="button" className={`cal-agenda-item cal-kind-${item.kind}`} onClick={() => setOpen(item)}>
                      <i aria-hidden="true" />
                      <span className="cal-agenda-date">{dayTitle(item.date)}</span>
                      <strong className={item.done ? 'cal-item-done' : undefined}>{item.title}</strong>
                      <small>
                        {KIND_LABEL[item.kind]}
                        {item.caseTitle && ` · ${item.caseTitle}`}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {adding && (
        <EventForm
          instructor={instructor}
          cases={cases}
          initialDate={adding}
          onSave={async (input) => setItems(await service.createCalendarEvent(courseId, input))}
          onClose={() => setAdding(null)}
        />
      )}
      {open && (
        <ItemDetails
          item={open}
          caseHref={open.caseId ? `/courses/${courseId}/cases/${open.caseId}${open.kind === 'task' && !instructor ? '?tab=tasks' : search}` : null}
          onSave={async (input) => setItems(await service.updateCalendarEvent(courseId, open.id, input))}
          onDelete={async () => setItems(await service.deleteCalendarEvent(courseId, open.id))}
          onClose={() => setOpen(null)}
        />
      )}
    </main>
  )
}

/** A new event: a case date (instructor), or a personal one a student can share with their team. */
function EventForm({
  instructor,
  cases,
  initialDate,
  onSave,
  onClose,
}: {
  instructor: boolean
  cases: CaseOption[]
  initialDate: string
  /** Throw to show the error in the form. */
  onSave(input: CalendarEventInput): Promise<void>
  onClose(): void
}) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(initialDate)
  const [notes, setNotes] = useState('')
  const [kind, setKind] = useState<CalendarEventInput['kind']>(instructor && cases.length > 0 ? 'case' : 'personal')
  const [caseId, setCaseId] = useState(cases[0]?.id ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSave({ kind, title: title.trim(), notes: notes.trim(), date, caseId: kind === 'personal' ? null : caseId })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setSaving(false)
    }
  }

  const caseChoice = kind !== 'personal' && cases.length > 0 && (
    <label>
      {instructor ? 'Case' : 'Share with my team in'}
      <select value={caseId} onChange={(e) => setCaseId(e.target.value)}>
        {cases.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <Modal eyebrow="Calendar" title="Add event" icon={<CalendarDays />} onClose={onClose}>
      <form className="cal-form" onSubmit={handleSubmit} aria-label="Add event">
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required autoFocus />
        </label>
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <fieldset className="cal-kinds">
          <legend>Who sees it</legend>
          {instructor ? (
            <label>
              <input type="radio" checked={kind === 'case'} onChange={() => setKind('case')} disabled={cases.length === 0} />
              Everyone in a case (a case date)
            </label>
          ) : (
            <label>
              <input type="radio" checked={kind === 'team'} onChange={() => setKind('team')} disabled={cases.length === 0} />
              Share with my team
            </label>
          )}
          <label>
            <input type="radio" checked={kind === 'personal'} onChange={() => setKind('personal')} />
            Just me
          </label>
        </fieldset>
        {caseChoice}
        <label>
          Notes (optional)
          <DictationTextarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={3} />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="cal-form-actions">
          <button type="button" className="ws-btn ws-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="ws-btn ws-btn-primary" disabled={saving || !title.trim() || !date}>
            {saving ? 'Saving…' : 'Add event'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** One item's details; an event its maker can change or delete. */
function ItemDetails({
  item,
  caseHref,
  onSave,
  onDelete,
  onClose,
}: {
  item: CalendarItem
  caseHref: string | null
  onSave(input: Pick<CalendarEventInput, 'title' | 'notes' | 'date'>): Promise<void>
  onDelete(): Promise<void>
  onClose(): void
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(item.title)
  const [date, setDate] = useState(item.date)
  const [notes, setNotes] = useState(item.notes)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  const meta = [
    KIND_LABEL[item.kind],
    item.kind === 'team' && item.teamNumber ? `Team ${item.teamNumber}` : null,
    item.caseTitle,
  ].filter(Boolean)

  return (
    <Modal eyebrow={meta.join(' · ')} title={item.title} icon={<CalendarDays />} onClose={onClose}>
      {editing ? (
        <form className="cal-form" onSubmit={(e) => (e.preventDefault(), run(() => onSave({ title: title.trim(), notes: notes.trim(), date })))}>
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
          </label>
          <label>
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label>
            Notes (optional)
            <DictationTextarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={3} />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="cal-form-actions">
            <button type="button" className="ws-btn ws-btn-secondary" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="ws-btn ws-btn-primary" disabled={busy || !title.trim()}>
              Save
            </button>
          </div>
        </form>
      ) : (
        <div className="cal-details">
          <p className="cal-details-date">
            {item.kind === 'task' ? 'Due ' : ''}
            {dayTitle(item.date)}
            {item.dueAt && `, ${new Date(item.dueAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
            {item.done && ' · Done'}
          </p>
          {item.notes && <p className="cal-details-notes">{item.notes}</p>}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="cal-form-actions">
            {caseHref && (
              <Link to={caseHref} className="ws-btn ws-btn-secondary">
                {item.kind === 'task' ? 'Go to the task' : 'Open the case'}
              </Link>
            )}
            {item.mine && (
              <>
                <button type="button" className="ws-btn ws-btn-secondary" onClick={() => run(onDelete)} disabled={busy}>
                  Delete
                </button>
                <button type="button" className="ws-btn ws-btn-primary" onClick={() => setEditing(true)} disabled={busy}>
                  Edit
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
