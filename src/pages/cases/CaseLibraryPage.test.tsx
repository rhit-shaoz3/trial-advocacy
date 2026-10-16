import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CourseCase, MyCase } from '../../courses/types'
import { trialAd } from '../../test/courseFixtures'
import { fakeCourseService } from '../../test/fakeCourseService'
import { renderWithProviders, testStudent } from '../../test/renderWithProviders'
import { CaseLibraryPage } from './CaseLibraryPage'

const courseCase = (id: string, title: string, status: CourseCase['status']): CourseCase => ({
  id,
  title,
  summary: '',
  status,
  instructorNote: '',
  inWorldDate: null,
  disputedIssues: '',
  createdAt: '2026-10-01T15:00:00.000Z',
  updatedAt: '2026-10-01T15:00:00.000Z',
})

describe('case library', () => {
  it("lists each taught course's cases with their status and a way to add one", async () => {
    renderWithProviders(<CaseLibraryPage />, {
      courseService: fakeCourseService({
        listTaughtCourses: vi.fn().mockResolvedValue([trialAd, { ...trialAd, id: 'c2', code: 'LAW 520', title: 'Evidence' }]),
        listCases: vi.fn((courseId: string) =>
          Promise.resolve(courseId === 'c1' ? [courseCase('k1', 'Smith v. Jones', 'draft'), courseCase('k2', 'State v. Hale', 'active')] : []),
        ),
      }),
    })

    const trial = await screen.findByRole('region', { name: /LAW 540: Trial Advocacy/ })
    expect(within(trial).getByRole('link', { name: /Smith v. Jones/ })).toHaveAttribute('href', '/courses/c1/cases/k1')
    expect(within(trial).getByText('Draft')).toBeInTheDocument()
    expect(within(trial).getByRole('link', { name: /New case/ })).toHaveAttribute('href', '/courses/c1/cases')
    expect(within(screen.getByRole('region', { name: /LAW 520: Evidence/ })).getByText('No cases yet.')).toBeInTheDocument()
  })

  it("shows a student their launched cases with their side", async () => {
    const hale: MyCase = {
      id: 'k2',
      title: 'State v. Hale',
      summary: '',
      status: 'active',
      team: { number: 3, members: [] },
      world: { number: 2, side: 'defense', opponents: { number: 4, members: [] } },
    }
    renderWithProviders(<CaseLibraryPage />, {
      user: testStudent,
      courseService: fakeCourseService({
        listMyCourses: vi.fn().mockResolvedValue([
          { id: 'c1', code: 'LAW 540', title: 'Trial Advocacy', term: 'Fall 2026', instructorName: null },
        ]),
        listMyCases: vi.fn().mockResolvedValue([hale]),
      }),
    })

    const link = await screen.findByRole('link', { name: /State v. Hale/ })
    expect(link).toHaveAttribute('href', '/courses/c1/cases/k2')
    expect(link).toHaveTextContent('World B · Defendant')
  })

  it('tells a student when nothing has launched', async () => {
    renderWithProviders(<CaseLibraryPage />, { user: testStudent })
    expect(await screen.findByText('Nothing assigned yet.')).toBeInTheDocument()
  })
})
