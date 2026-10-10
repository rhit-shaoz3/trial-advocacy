import { Link } from 'react-router'

export function NotFoundPage({ message = 'That page does not exist.' }: { message?: string }) {
  return (
    <main className="page">
      <div className="page-header">
        <div>
          <h1>Not found</h1>
          <p className="muted">{message}</p>
        </div>
      </div>
      <Link to="/" className="btn-secondary">
        Back to your courses
      </Link>
    </main>
  )
}
