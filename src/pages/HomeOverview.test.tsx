import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { CourseServiceContext } from '../courses/CourseServiceContext'
import type { HomeOverview as Overview } from '../courses/types'
import { fakeCourseService } from '../test/fakeCourseService'
import { HomeOverview } from './HomeOverview'

function renderOverview(overview: Overview, role: 'instructor' | 'student') {
  render(
    <MemoryRouter>
      <CourseServiceContext.Provider value={fakeCourseService({ getHomeOverview: vi.fn().mockResolvedValue(overview) })}>
        <HomeOverview role={role} />
      </CourseServiceContext.Provider>
    </MemoryRouter>,
  )
}

const rivera = {
  id: 'k1',
  title: 'Rivera v. Thrill Park',
  courseId: 'c1',
  courseCode: 'LAW 540',
  phase: 'investigate' as const,
  phases: ['introduction' as const, 'investigate' as const, 'deposition' as const],
}

describe('HomeOverview', () => {
  it("shows a student's active cases and their next to-dos, each linking to its spot", async () => {
    renderOverview(
      {
        activeCases: [{ ...rivera, side: 'plaintiff', teamNumber: 3 }],
        todos: {
          count: 5,
          latest: [
            { id: 'r1', kind: 'response', title: 'New answers to your interrogatories', detail: 'LAW 540 · Rivera v. Thrill Park', courseId: 'c1', caseId: 'k1', at: '2026-10-20T12:00:00Z' },
            { id: 't1', kind: 'task', title: 'Outline the deposition', detail: 'LAW 540 · Rivera v. Thrill Park', courseId: 'c1', caseId: 'k1', at: '2026-11-02T12:00:00Z' },
          ],
        },
      },
      'student',
    )

    const todos = await screen.findByRole('region', { name: /To do/ })
    expect(todos).toHaveTextContent('5')
    expect(within(todos).getByRole('link', { name: /New answers/ })).toHaveAttribute('href', '/courses/c1/cases/k1?tab=exchange')
    expect(within(todos).getByRole('link', { name: /Outline the deposition/ })).toHaveAttribute('href', '/courses/c1/cases/k1?tab=tasks')
    expect(todos).toHaveTextContent('3 more in your cases')

    const card = within(screen.getByRole('region', { name: 'Active cases' })).getByRole('link', { name: 'Rivera v. Thrill Park' })
    expect(card).toHaveAttribute('href', '/courses/c1/cases/k1')
    expect(card).toHaveTextContent('Investigate phase')
    expect(card).toHaveTextContent('Plaintiff · Team 3')
  })

  it("tells an instructor with nothing waiting that they're up to date", async () => {
    renderOverview({ activeCases: [{ ...rivera, worldCount: 2, teamCount: 4 }], todos: { count: 0, latest: [] } }, 'instructor')

    expect(await screen.findByRole('region', { name: 'To review' })).toHaveTextContent('You’re all up to date.')
    expect(screen.getByRole('link', { name: 'Rivera v. Thrill Park' })).toHaveTextContent('2 case worlds · 4 teams')
  })
})
