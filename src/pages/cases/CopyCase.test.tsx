import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { CourseServiceContext } from '../../courses/CourseServiceContext'
import type { CaseWorkspace, CourseCase, CourseService, TaughtCourse } from '../../courses/types'
import { fakeCourseService } from '../../test/fakeCourseService'
import { CaseDetailPage } from './CaseDetailPage'

// Confetti draws on a canvas, which jsdom doesn't have.
vi.mock('canvas-confetti', () => ({ default: Object.assign(vi.fn(), { reset: vi.fn() }) }))

const winston: CourseCase = {
  id: 'k1',
  title: 'Winston v. Thrillville',
  summary: 'A rider was hurt.',
  status: 'active',
  phase: 'introduction',
  instructorNote: '',
  inWorldDate: null,
  disputedIssues: '',
  importantFacts: { plaintiff: ['a'], defense: ['b'] },
  setupStep: 'tasks',
  setupCompletedAt: '2026-09-01T12:00:00Z',
  createdAt: '2026-09-01T12:00:00Z',
  updatedAt: '2026-09-01T12:00:00Z',
}

const course = (id: string, code: string, term: string): TaughtCourse => ({
  id,
  code,
  title: 'Trial Advocacy',
  term,
  instructorName: 'Prof. Ruiz',
  season: 'Fall',
  year: 2026,
  entryCode: 'X',
  studentCount: 2,
})

function renderAt(path: string, overrides: Partial<CourseService>) {
  const service = fakeCourseService({
    previewWorkspace: vi.fn(() => new Promise<CaseWorkspace>(() => {})),
    listTaughtCourses: vi.fn().mockResolvedValue([course('c1', 'LAW 540', 'Fall 2026'), course('c2', 'LAW 540', 'Fall 2027')]),
    ...overrides,
  })
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={[path]}>
      <CourseServiceContext.Provider value={service}>
        <Routes>
          <Route path="courses/:courseId/cases/:caseId" element={<CaseDetailPage />} />
        </Routes>
      </CourseServiceContext.Provider>
    </MemoryRouter>,
  )
  return { user, service }
}

describe('duplicating and sharing a case', () => {
  it('duplicates into another class, and opens the copy on its teams and worlds', async () => {
    const copy: CourseCase = {
      ...winston,
      id: 'k2',
      status: 'draft',
      setupStep: 'worlds',
      setupCompletedAt: null,
      copySetup: true,
      copiedFrom: { title: 'Winston v. Thrillville', owner: 'Prof. Ruiz' },
    }
    const duplicateCase = vi.fn().mockResolvedValue({ courseId: 'c2', case: copy })
    const { user } = renderAt('/courses/c1/cases/k1', {
      getCase: vi.fn(async (_course, id) => (id === 'k2' ? copy : winston)),
      duplicateCase,
    })

    await user.click(await screen.findByRole('button', { name: 'Duplicate case' }))
    const dialog = await screen.findByRole('dialog', { name: 'Duplicate this case' })
    const title = within(dialog).getByRole('textbox', { name: 'Title' })
    expect(title).toHaveValue('Winston v. Thrillville (copy)')
    expect(within(dialog).getByRole('note')).toHaveTextContent('Every case file goes back to “Instructors only” in the copy, except the starting file.')
    // Another class keeps the title as it is.
    await user.selectOptions(await within(dialog).findByRole('combobox', { name: 'Class' }), 'c2')
    expect(title).toHaveValue('Winston v. Thrillville')
    await user.click(within(dialog).getByRole('checkbox', { name: /Include the tasks/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Duplicate' }))
    expect(duplicateCase).toHaveBeenCalledWith('c1', 'k1', { targetCourseId: 'c2', includeTasks: false, title: 'Winston v. Thrillville' })

    // Only teams and worlds to set up.
    expect(await screen.findByText('Copied case')).toBeInTheDocument()
    expect(screen.getByText(/Copied from Winston v\. Thrillville · Prof\. Ruiz/)).toBeInTheDocument()
    const steps = screen.getByRole('navigation', { name: 'Setup steps' })
    expect(within(steps).getAllByRole('button').map((b) => b.textContent)).toEqual(['1Teams', 'Case worlds'])
    // A reminder to look the files over.
    expect(screen.getByRole('note')).toHaveTextContent('Every case file is “Instructors only” in this copy, except the starting file.')
    // It opens on the teams.
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Teams' })).toBeInTheDocument()
  })

  it('shares by email, showing why it can’t', async () => {
    const shareCase = vi
      .fn()
      .mockRejectedValueOnce(new Error('That email belongs to a student. Cases can only be shared with instructors.'))
      .mockResolvedValueOnce({ toName: 'Prof. Kim', toEmail: 'kim@example.com' })
    const { user } = renderAt('/courses/c1/cases/k1', { getCase: vi.fn().mockResolvedValue(winston), shareCase })

    await user.click(await screen.findByRole('button', { name: 'Share case' }))
    const dialog = await screen.findByRole('dialog', { name: 'Share Winston v. Thrillville' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Instructor’s email' }), 'stu@example.com')
    await user.click(within(dialog).getByRole('button', { name: 'Share' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('That email belongs to a student.')

    await user.clear(within(dialog).getByRole('textbox', { name: 'Instructor’s email' }))
    await user.type(within(dialog).getByRole('textbox', { name: 'Instructor’s email' }), 'kim@example.com')
    await user.click(within(dialog).getByRole('button', { name: 'Share' }))
    expect(shareCase).toHaveBeenLastCalledWith('c1', 'k1', 'kim@example.com', true)
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Shared with Prof. Kim.')
  })
})
