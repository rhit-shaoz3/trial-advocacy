import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { trialAd } from '../test/courseFixtures'
import { fakeCasesApi } from '../test/fakeCasesApi'
import { fakeCourseService } from '../test/fakeCourseService'
import { renderWithProviders } from '../test/renderWithProviders'
import { InstructorOverview } from './InstructorOverview'

describe('instructor overview', () => {
  it('greets the instructor and sums up courses, students, cases and requests', async () => {
    renderWithProviders(<InstructorOverview />, {
      courseService: fakeCourseService({
        listTaughtCourses: vi.fn().mockResolvedValue([
          trialAd,
          { ...trialAd, id: 'c2', code: 'LAW 520', title: 'Evidence', studentCount: 3, requestCount: 0 },
        ]),
      }),
      casesApi: fakeCasesApi({
        listAllCases: vi.fn().mockResolvedValue([
          {
            id: 'k1',
            name: 'Smith v. Jones',
            courseId: 'c1',
            courseName: 'LAW 540: Trial Advocacy',
            published: { documents: true, characters: false, teams: false },
          },
        ]),
      }),
    })

    expect(await screen.findByRole('heading', { name: 'Welcome back, Ivy.' })).toBeInTheDocument()
    const stat = (label: string) =>
      screen.getByText(label, { selector: '.stat-head span' }).closest('.stat-card')!
    expect(stat('Courses')).toHaveTextContent('2')
    expect(stat('Students')).toHaveTextContent('4')
    expect(stat('Cases')).toHaveTextContent('1 published to students')
    expect(stat('Seeking admission')).toHaveTextContent('2')

    const tile = screen.getByRole('article', { name: 'LAW 540: Trial Advocacy' })
    expect(within(tile).getByText(/Smith v. Jones/)).toBeInTheDocument()
    expect(within(tile).getByText('2 waiting')).toBeInTheDocument()
    expect(within(tile).getByRole('link', { name: /Open course/ })).toHaveAttribute('href', '/courses/c1')
    expect(screen.getByRole('link', { name: /Smith v. Jones/ })).toHaveAttribute('href', '/courses/c1/cases/k1')
  })

  it('invites a new instructor to create their first course', async () => {
    renderWithProviders(<InstructorOverview />)

    expect(await screen.findByText('Let’s build your first course.')).toBeInTheDocument()
  })
})
