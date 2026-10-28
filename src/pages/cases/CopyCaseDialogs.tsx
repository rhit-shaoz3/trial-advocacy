import { useEffect, useState, type FormEvent } from 'react'
import { Copy, Send } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { useCourseService } from '../../courses/CourseServiceContext'
import type { CourseCase, TaughtCourse } from '../../courses/types'
import './copyCase.css'

/** What a copy brings, and what stays behind. */
function WhatCopies() {
  return (
    <p className="muted copy-what">
      Copies the details, important facts, background investigator, witnesses, case files (for instructors only, except
      the starting file), and the information exchange setup. Teams, worlds, and everything from playing the case stay
      behind.
    </p>
  )
}

const courseLabel = (c: TaughtCourse) => `${c.code} · ${c.title} (${c.term})`

/**
 * Duplicating a case into one of the instructor's classes (this one, or
 * another, like next year's): a title, which class, and whether to bring the
 * tasks. The copy opens on its teams and worlds.
 */
export function DuplicateCaseDialog({
  courseId,
  courseCase,
  onDone,
  onClose,
}: {
  courseId: string
  courseCase: CourseCase
  onDone(copy: { courseId: string; case: CourseCase }): void
  onClose(): void
}) {
  const service = useCourseService()
  const [courses, setCourses] = useState<TaughtCourse[] | null>(null)
  const [target, setTarget] = useState(courseId)
  const [title, setTitle] = useState(`${courseCase.title} (copy)`)
  const [titleEdited, setTitleEdited] = useState(false)
  const [includeTasks, setIncludeTasks] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    service
      .listTaughtCourses()
      .then(setCourses)
      .catch((err: Error) => setError(`Could not load your classes. ${err.message}`))
  }, [service])

  function pick(id: string) {
    setTarget(id)
    // "(copy)" tells two cases in one class apart; in another class the title can stay.
    if (!titleEdited) setTitle(id === courseId ? `${courseCase.title} (copy)` : courseCase.title)
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onDone(await service.duplicateCase(courseId, courseCase.id, { targetCourseId: target, includeTasks, title: title.trim() }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  return (
    <Modal
      eyebrow="Duplicate"
      title="Duplicate this case"
      icon={<Copy />}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={() => submit()} disabled={busy || !title.trim() || !courses}>
            {busy ? 'Duplicating…' : 'Duplicate'}
          </button>
        </>
      }
    >
      <form className="copy-form" onSubmit={submit}>
        <WhatCopies />
        <label>
          Class
          <select value={target} onChange={(e) => pick(e.target.value)} disabled={!courses}>
            {(courses ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {courseLabel(c)}
                {c.id === courseId ? ' (this class)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Title
          <input
            type="text"
            value={title}
            maxLength={120}
            onChange={(e) => {
              setTitle(e.target.value)
              setTitleEdited(true)
            }}
          />
        </label>
        <label className="copy-check">
          <input type="checkbox" checked={includeTasks} onChange={(e) => setIncludeTasks(e.target.checked)} />
          Include the tasks (without their due dates)
        </label>
        <p className="copy-files-note" role="note">
          <strong>Every case file goes back to &ldquo;Instructors only&rdquo;</strong> in the copy, except the starting file.
          Before you launch it, check who should see each file on its Case file tab.
        </p>
        <p className="muted">Next you&rsquo;ll put the class&rsquo;s students into teams and worlds.</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}

/** Sharing a case with another instructor by email; they accept it into one of their classes, or decline it. */
export function ShareCaseDialog({ courseId, courseCase, onClose }: { courseId: string; courseCase: CourseCase; onClose(): void }) {
  const service = useCourseService()
  const [email, setEmail] = useState('')
  const [includeTasks, setIncludeTasks] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sharedWith, setSharedWith] = useState<string | null>(null)

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const share = await service.shareCase(courseId, courseCase.id, email.trim(), includeTasks)
      setSharedWith(share.toName || share.toEmail)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      eyebrow="Share"
      title={`Share ${courseCase.title}`}
      icon={<Send />}
      onClose={onClose}
      footer={
        sharedWith ? (
          <button type="button" className="btn-primary" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={() => submit()} disabled={busy || !email.trim()}>
              {busy ? 'Sharing…' : 'Share'}
            </button>
          </>
        )
      }
    >
      {sharedWith ? (
        <p role="status">
          Shared with <strong>{sharedWith}</strong>. They&rsquo;ll see it the next time they sign in, and can add a copy to
          one of their classes.
        </p>
      ) : (
        <form className="copy-form" onSubmit={submit}>
          <p className="muted">
            Another instructor gets their own copy, to add to one of their classes. Your case doesn&rsquo;t change.
          </p>
          <WhatCopies />
          <label>
            Instructor&rsquo;s email
            <input type="email" value={email} autoComplete="off" onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="copy-check">
            <input type="checkbox" checked={includeTasks} onChange={(e) => setIncludeTasks(e.target.checked)} />
            Include the tasks (without their due dates)
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </Modal>
  )
}
