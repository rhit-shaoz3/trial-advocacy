import { CircleAlert, Mail } from 'lucide-react'
import type { CourseService, StudentInbox } from '../courses/types'

interface Props {
  inbox: StudentInbox | null
  service: CourseService
  act(action: () => Promise<void>): void
}

/** Invitation and "request denied" banners at the top of the student's pages. */
export function StudentNotices({ inbox, service, act }: Props) {
  if (!inbox || (inbox.invitations.length === 0 && inbox.denials.length === 0)) return null
  return (
    <div className="notices">
      {inbox.invitations.map((inv) => (
        <div key={inv.courseId} className="notice" role="status">
          <Mail size={20} aria-hidden className="notice-icon" />
          <p>
            You've been invited to join <strong>{inv.courseName}</strong>.
          </p>
          <div className="case-actions">
            <button
              type="button"
              className="ws-btn ws-btn-primary case-btn-sm"
              onClick={() => act(() => service.answerInvitation(inv.courseId, true))}
            >
              Accept
            </button>
            <button
              type="button"
              className="ws-btn ws-btn-secondary case-btn-sm"
              onClick={() => act(() => service.answerInvitation(inv.courseId, false))}
            >
              Reject
            </button>
          </div>
        </div>
      ))}

      {inbox.denials.map((d) => (
        <div key={d.courseId} className="notice notice-denied" role="status">
          <CircleAlert size={20} aria-hidden className="notice-icon" />
          <p>
            Your request to join <strong>{d.courseName}</strong> was denied by the instructor.
          </p>
          <div className="case-actions">
            <button
              type="button"
              className="ws-btn ws-btn-secondary case-btn-sm"
              onClick={() => act(() => service.dismissDenial(d.courseId))}
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
