import { CircleAlert, Mail } from 'lucide-react'
import type { ClassesApi, StudentInbox } from '../classes/types'

interface Props {
  inbox: StudentInbox | null
  api: ClassesApi
  act(action: () => Promise<void>): void
}

/** Invitation and "request denied" banners at the top of the student pages. */
export function StudentNotices({ inbox, api, act }: Props) {
  if (!inbox || (inbox.invitations.length === 0 && inbox.denials.length === 0)) return null
  return (
    <div className="notices">
      {inbox.invitations.map((inv) => (
        <div key={inv.id} className="notice" role="status">
          <Mail size={20} aria-hidden className="notice-icon" />
          <p>
            You've been invited to join <strong>{inv.className}</strong>.
          </p>
          <div className="actions">
            <button
              type="button"
              className="btn btn-primary btn-small"
              onClick={() => act(() => api.acceptInvitation(inv.id))}
            >
              Accept
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => act(() => api.rejectInvitation(inv.id))}
            >
              Reject
            </button>
          </div>
        </div>
      ))}

      {inbox.denials.map((d) => (
        <div key={d.classId} className="notice notice-denied" role="status">
          <CircleAlert size={20} aria-hidden className="notice-icon" />
          <p>
            Your request to join <strong>{d.className}</strong> was denied by the instructor.
          </p>
          <div className="actions">
            <button
              type="button"
              className="btn btn-small"
              onClick={() => act(() => api.dismissDenial(d.classId))}
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
