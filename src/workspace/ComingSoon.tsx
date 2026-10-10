import { Link } from 'react-router'
import { useWorkspace } from './useWorkspace'

/** Placeholder for workspace pages that aren't built yet. */
export function ComingSoon({
  title,
  message = 'This page is coming soon.',
}: {
  title: string
  message?: string
}) {
  const { home, search } = useWorkspace()
  return (
    <main className="ws-page">
      <span className="ws-eyebrow">{home.course.code}</span>
      <h1 className="ws-title">{title}</h1>
      <p className="ws-subtle">{message}</p>
      <Link to={`/courses/${home.course.id}${search}`} className="ws-btn ws-btn-secondary">
        Back to dashboard
      </Link>
    </main>
  )
}
