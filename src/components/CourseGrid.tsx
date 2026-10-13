import type { ReactNode } from 'react'
import type { Course } from '../courses/types'
import './CourseGrid.css'

/** Splits an already-sorted list into consecutive runs that share a term. */
function groupByTerm<T extends Course>(courses: T[]) {
  const groups: { term: string; courses: T[] }[] = []
  for (const course of courses) {
    const last = groups.at(-1)
    if (last?.term === course.term) last.courses.push(course)
    else groups.push({ term: course.term, courses: [course] })
  }
  return groups
}

/** Courses as cards under one heading per term, in the order given. */
export function CourseGrid<T extends Course>({
  courses,
  renderCard,
}: {
  courses: T[]
  /** Returns the card, which should have the `course-card` class. */
  renderCard(course: T): ReactNode
}) {
  return groupByTerm(courses).map(({ term, courses }, i) => (
    <section key={`${i}-${term}`} className="term" aria-labelledby={`term-${i}`}>
      <h2 id={`term-${i}`}>{term}</h2>
      <ul className="course-grid">
        {courses.map((course) => (
          <li key={course.id}>{renderCard(course)}</li>
        ))}
      </ul>
    </section>
  ))
}
