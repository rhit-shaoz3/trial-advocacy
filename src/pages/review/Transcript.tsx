import { useState } from 'react'
import { MarkedTranscript } from '../../components/MarkedTranscript'
import { useCourseService } from '../../courses/CourseServiceContext'
import type { ReviewTranscript } from '../../courses/types'

/** The conversation behind a review, loaded the first time it's opened, marked as the rulings so far stand. */
export function Transcript({ courseId, reviewId, label = 'Show conversation' }: { courseId: string; reviewId: string; label?: string }) {
  const service = useCourseService()
  const [transcript, setTranscript] = useState<ReviewTranscript | null>(null)
  const [error, setError] = useState<string | null>(null)

  function load(open: boolean) {
    // Reload each time it opens: the marks follow the rulings made since.
    if (!open) return
    service
      .getReviewTranscript(courseId, reviewId)
      .then(setTranscript)
      .catch((err: Error) => setError(err.message))
  }

  return (
    <details className="review-transcript" onToggle={(e) => load(e.currentTarget.open)}>
      <summary>{label}</summary>
      {error ? (
        <p className="form-error">{error}</p>
      ) : !transcript ? (
        <p className="muted">Loading…</p>
      ) : (
        <MarkedTranscript transcript={transcript} />
      )}
    </details>
  )
}
