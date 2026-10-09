import { Link } from 'react-router'

export function NotFoundPage({ message = 'That page does not exist.' }: { message?: string }) {
  return (
    <main className="app">
      <h1>Not found</h1>
      <p className="hint">{message}</p>
      <Link to="/">Back to your courses</Link>
    </main>
  )
}
