import { useEffect, useState, type FormEvent } from 'react'
import { useCourseService } from '../../../courses/CourseServiceContext'
import { AUDIENCE_LABEL, dueLabel, fromLocalInput, toLocalInput } from '../../../courses/caseLabels'
import { AUDIENCES, type Audience, type CaseTask, type TaskInput } from '../../../courses/types'

const BLANK: TaskInput = { title: '', description: '', dueAt: null, audience: 'all' }

/** Work assigned to every team on a side. Teams tick tasks off; their progress comes from it. */
export function TasksSection({ courseId, caseId }: { courseId: string; caseId: string }) {
  const service = useCourseService()
  const [tasks, setTasks] = useState<CaseTask[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** The task being edited, 'new' for the add form, or null. */
  const [editing, setEditing] = useState<string | 'new' | null>(null)

  useEffect(() => {
    let cancelled = false
    service
      .listTasks(courseId, caseId)
      .then((list) => !cancelled && setTasks(list))
      .catch((err: Error) => !cancelled && setLoadError(err.message))
    return () => {
      cancelled = true
    }
  }, [service, courseId, caseId])

  // Re-fetch after a change so the order (soonest due first) matches the server's.
  async function refresh() {
    setTasks(await service.listTasks(courseId, caseId))
  }

  async function handleSave(input: TaskInput) {
    if (editing === 'new') await service.createTask(courseId, caseId, input)
    else if (editing) await service.updateTask(courseId, caseId, editing, input)
    setEditing(null)
    await refresh()
  }

  async function handleDelete(task: CaseTask) {
    if (!window.confirm(`Delete "${task.title}"? Teams' progress on it is removed too.`)) return
    setError(null)
    try {
      await service.deleteTask(courseId, caseId, task.id)
      setTasks((prev) => prev?.filter((t) => t.id !== task.id) ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  return (
    <section className="course-section" aria-labelledby="tasks-heading">
      <div className="section-header">
        <h2 id="tasks-heading">Tasks</h2>
        {editing !== 'new' && (
          <button type="button" className="btn-primary" onClick={() => setEditing('new')}>
            Add task
          </button>
        )}
      </div>
      <p className="muted section-hint">
        Assigned to every team that can see it. Either partner can mark a task done for the team, and
        the team&rsquo;s progress bar counts completed tasks.
      </p>

      {editing === 'new' && (
        <TaskForm label="New task" initial={BLANK} onSave={handleSave} onCancel={() => setEditing(null)} />
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {loadError ? (
        <p className="form-error" role="alert">
          Could not load the tasks. {loadError}
        </p>
      ) : !tasks ? (
        <p className="muted">Loading tasks…</p>
      ) : tasks.length === 0 ? (
        <p className="muted">No tasks yet.</p>
      ) : (
        <ul className="content-list" aria-label="Tasks">
          {tasks.map((t) =>
            editing === t.id ? (
              <li key={t.id}>
                <TaskForm label={`Edit ${t.title}`} initial={t} onSave={handleSave} onCancel={() => setEditing(null)} />
              </li>
            ) : (
              <li key={t.id} className="content-item" aria-label={t.title}>
                <div>
                  <strong>{t.title}</strong>
                  <span className="muted"> · {t.dueAt ? `Due ${dueLabel(t.dueAt)}` : 'No due date'}</span>
                  <span className={`badge content-audience-${t.audience}`}>{AUDIENCE_LABEL[t.audience]}</span>
                  {t.description && <p>{t.description}</p>}
                </div>
                <span className="content-actions">
                  <button type="button" className="link-button" onClick={() => setEditing(t.id)}>
                    Edit
                  </button>
                  <button type="button" className="link-button" onClick={() => handleDelete(t)}>
                    Delete
                  </button>
                </span>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  )
}

function TaskForm({
  label,
  initial,
  onSave,
  onCancel,
}: {
  label: string
  initial: TaskInput
  /** Throw to show the error in the form. */
  onSave(input: TaskInput): Promise<void>
  onCancel(): void
}) {
  const [title, setTitle] = useState(initial.title)
  const [description, setDescription] = useState(initial.description)
  const [due, setDue] = useState(toLocalInput(initial.dueAt))
  const [audience, setAudience] = useState<Audience>(initial.audience)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await onSave({ title, description, dueAt: fromLocalInput(due), audience })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setSaving(false)
    }
  }

  return (
    <form className="panel-form content-form" onSubmit={handleSubmit} aria-label={label}>
      <label className="content-form-grow">
        Title
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Prepare the ride operator's deposition outline"
          maxLength={120}
          required
          autoFocus
        />
      </label>
      <label>
        Due (optional)
        <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
      </label>
      <label>
        Visible to
        <select value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
          {AUDIENCES.map((a) => (
            <option key={a} value={a}>
              {AUDIENCE_LABEL[a]}
            </option>
          ))}
        </select>
      </label>
      <label className="content-form-full">
        Details (optional)
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Draft an outline and list the exhibits you plan to introduce."
          maxLength={4000}
          rows={2}
        />
      </label>
      <div className="panel-form-actions">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save task'}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}
