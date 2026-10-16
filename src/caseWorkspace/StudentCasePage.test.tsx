import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { CourseServiceContext } from '../courses/CourseServiceContext'
import type { CaseWorkspace, CourseService } from '../courses/types'
import { fakeCourseService } from '../test/fakeCourseService'
import { StudentCasePage } from './StudentCasePage'

const workspace: CaseWorkspace = {
  case: { id: 'k1', title: 'Rivera v. Thrill Park', summary: '', status: 'active', instructorNote: '' },
  team: { number: 1, members: [{ email: 'ada@example.com', name: 'Ada Lawyer', userId: 'u1', status: 'joined' as const, you: true }] },
  world: null,
  side: null,
  materials: [
    {
      id: 'm1',
      audience: 'all',
      filename: 'Fact pattern.pdf',
      description: '',
      contentType: 'application/pdf',
      sizeBytes: 10,
      uploadedAt: '2026-10-01T15:00:00.000Z',
      textStatus: 'ready',
      textError: null,
      published: true,
    },
  ],
  witnesses: [],
  tasks: [
    { id: 't1', title: 'Read it', description: '', dueAt: null, audience: 'all', completedAt: null, completedBy: null },
  ],
  preview: false,
}

function renderPage(overrides: Partial<CourseService>) {
  const service = fakeCourseService(overrides)
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={['/courses/c1/cases/k1']}>
      <CourseServiceContext.Provider value={service}>
        <Routes>
          <Route path="courses/:courseId/cases/:caseId" element={<StudentCasePage />} />
        </Routes>
      </CourseServiceContext.Provider>
    </MemoryRouter>,
  )
  return { user, service }
}

describe('StudentCasePage', () => {
  it("loads the student's case, with downloads through the student's own route", async () => {
    const { service } = renderPage({ getMyCaseWorkspace: vi.fn().mockResolvedValue(workspace) })

    expect(await screen.findByRole('heading', { level: 1, name: 'Rivera v. Thrill Park' })).toBeInTheDocument()
    expect(service.getMyCaseWorkspace).toHaveBeenCalledWith('c1', 'k1')
    expect(screen.getByRole('link', { name: 'My cases' })).toHaveAttribute('href', '/courses/c1/cases')
    expect(screen.getByRole('link', { name: /Fact pattern\.pdf/ })).toHaveAttribute('href', '/my-download/c1/k1/m1')
  })

  it('marks a task done and shows the updated case', async () => {
    const done = {
      ...workspace,
      tasks: [{ ...workspace.tasks[0], completedAt: '2026-10-15T12:00:00.000Z', completedBy: 'Ada Lawyer' }],
    }
    const setTaskDone = vi.fn().mockResolvedValue(done)
    const { user } = renderPage({ getMyCaseWorkspace: vi.fn().mockResolvedValue(workspace), setTaskDone })

    await user.click(await screen.findByRole('button', { name: /Mark complete/ }))

    expect(setTaskDone).toHaveBeenCalledWith('c1', 'k1', 't1', true)
    expect(await screen.findByText('All tasks are complete.')).toBeInTheDocument()
  })

  it('explains a case that is missing or not opened yet', async () => {
    renderPage({ getMyCaseWorkspace: vi.fn().mockRejectedValue(new Error('Case not found.')) })

    expect(await screen.findByRole('heading', { name: 'Case not found' })).toBeInTheDocument()
    expect(screen.getByText(/not been opened to students yet/)).toBeInTheDocument()
  })
})
