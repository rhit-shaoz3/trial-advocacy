import { GraduationCap, Plus } from 'lucide-react'
import { useState } from 'react'
import type { StudentClass, StudentInbox } from '../classes/types'
import { JoinClassDialog } from './JoinClassDialog'

interface Props {
  classes: StudentClass[] | null
  inbox: StudentInbox | null
  onJoined(): void
}

/** "Classes" card: enrolled classes, ones waiting for approval, and the Add class button. */
export function StudentClassList({ classes, inbox, onJoined }: Props) {
  const [joining, setJoining] = useState(false)
  const pending = inbox?.pendingRequests ?? []

  return (
    <section className="panel" aria-labelledby="classes-heading">
      <div className="panel-head">
        <h2 id="classes-heading">Classes</h2>
        <button type="button" className="btn btn-small" onClick={() => setJoining(true)}>
          <Plus size={16} aria-hidden /> Add class
        </button>
      </div>

      {classes?.length === 0 && pending.length === 0 && (
        <p className="hint">You're not in any classes yet. Ask your instructor for a join code.</p>
      )}

      <ul className="rows">
        {classes?.map((cls) => (
          <li key={cls.id}>
            <span className="icon-tile" aria-hidden>
              <GraduationCap size={18} />
            </span>
            <span className="row-main">
              <strong>{cls.name}</strong>
              {cls.instructors.length > 0 && (
                <span>
                  {cls.instructors.length === 1 ? 'Instructor' : 'Instructors'}:{' '}
                  {cls.instructors.join(', ')}
                </span>
              )}
            </span>
          </li>
        ))}
        {pending.map((p) => (
          <li key={p.classId}>
            <span className="icon-tile" aria-hidden>
              <GraduationCap size={18} />
            </span>
            <span className="row-main">
              <strong>{p.className}</strong>
            </span>
            <span className="badge badge-muted">Waiting for instructor approval</span>
          </li>
        ))}
      </ul>

      {joining && <JoinClassDialog onClose={() => setJoining(false)} onJoined={onJoined} />}
    </section>
  )
}
