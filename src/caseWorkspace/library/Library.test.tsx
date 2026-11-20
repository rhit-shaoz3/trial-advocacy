import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../../auth/AuthContext'
import type { User } from '../../auth/types'
import { CourseServiceContext } from '../../courses/CourseServiceContext'
import type { CourseService, LibraryDetail, LibraryEntry } from '../../courses/types'
import type { CourseHome } from '../../workspace/types'
import { fakeCourseService } from '../../test/fakeCourseService'
import type { WorkspaceContext } from '../../workspace/useWorkspace'
import { LibraryEntryPage } from './LibraryEntryPage'
import { LibraryPage } from './LibraryPage'

const student: User = { id: 'u1', name: 'Ada Lawyer', email: 'ada@example.com', role: 'student', theme: 'navy', avatarUrl: null, createdAt: '2026-09-01T00:00:00.000Z' }

function renderAt(url: string, overrides: Partial<CourseService>) {
  const service = fakeCourseService(overrides)
  const user = userEvent.setup()
  const context = { home: { course: { code: 'LAW 701' } } as CourseHome, search: '', reloadHome: vi.fn() } satisfies WorkspaceContext
  render(
    <AuthContext.Provider value={{ user: student, loading: false, signUp: vi.fn(), logIn: vi.fn(), logOut: vi.fn(), updateProfile: vi.fn(), uploadAvatar: vi.fn(), removeAvatar: vi.fn(), markTourSeen: vi.fn() }}>
      <MemoryRouter initialEntries={[url]}>
        <CourseServiceContext.Provider value={service}>
          <Routes>
            <Route path="courses/:courseId" element={<Outlet context={context} />}>
              <Route path="library" element={<LibraryPage />} />
              <Route path="library/:kind/:id" element={<LibraryEntryPage />} />
            </Route>
          </Routes>
        </CourseServiceContext.Provider>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
  return { user, service }
}

const entry = (over: Partial<LibraryEntry>): LibraryEntry => ({
  kind: 'discovery',
  subkind: 'interrogatories',
  id: 'e1',
  caseId: 'k1',
  caseTitle: 'Rivera v. Thrill Park',
  title: 'Interrogatories',
  summary: 'Question 2: which day?',
  tag: 'SMALL_EDITS',
  by: 'Ada Lawyer',
  mine: true,
  createdAt: '2026-11-19T12:00:00Z',
  ...over,
})

const entries = [
  entry({ kind: 'practice', subkind: 'cross', id: 'p1', title: 'Cross-examination of Elena Torres', summary: 'Lock in the booth.', tag: null, by: null, createdAt: '2026-11-20T12:00:00Z' }),
  entry({ kind: 'planner', subkind: 'planner', id: 'r1', title: 'Planner feedback, round 1', tag: 'NEEDS_IMPROVEMENT', by: 'Bo Partner', mine: false }),
  entry({}),
  entry({ id: 'e2', subkind: 'subpoena', title: 'Subpoena', caseId: 'k2', caseTitle: 'State v. Lee', tag: 'LOOKS_GOOD', by: 'Bo Partner', mine: false }),
]

describe('the learning library', () => {
  it('lists every piece of feedback, and filters by type, kind, case, and who asked', async () => {
    const { user } = renderAt('/courses/c1/library', { listLibrary: vi.fn().mockResolvedValue(entries) })
    const list = await screen.findByRole('list', { name: 'Your feedback' })
    const titles = () => within(screen.getByRole('list', { name: 'Your feedback' })).getAllByRole('link').map((l) => l.querySelector('strong')?.textContent)
    expect(titles()).toEqual(['Cross-examination of Elena Torres', 'Planner feedback, round 1', 'Interrogatories', 'Subpoena'])
    expect(within(list).getByRole('link', { name: /Planner feedback, round 1/ })).toHaveTextContent('Asked by Bo Partner')
    expect(within(list).getByRole('link', { name: /Planner feedback/ })).toHaveTextContent('Needs work')
    expect(within(list).getByRole('link', { name: /Interrogatories/ })).toHaveAttribute('href', '/courses/c1/library/discovery/e1')

    await user.click(screen.getByRole('button', { name: 'Information exchange' }))
    expect(titles()).toEqual(['Interrogatories', 'Subpoena'])
    await user.selectOptions(screen.getByLabelText('Kind of information exchange'), 'subpoena')
    expect(titles()).toEqual(['Subpoena'])
    await user.click(screen.getByRole('button', { name: 'All' }))
    await user.selectOptions(screen.getByLabelText('Case'), 'k1')
    await user.click(screen.getByLabelText('Only what I asked for'))
    expect(titles()).toEqual(['Cross-examination of Elena Torres', 'Interrogatories'])
  })

  it('says what goes there when it’s empty', async () => {
    renderAt('/courses/c1/library', { listLibrary: vi.fn().mockResolvedValue([]) })
    expect(await screen.findByText(/Nothing here yet/)).toBeInTheDocument()
  })

  it('opens a practice session with its coach’s notes, and a check with what it read, each to download', async () => {
    const practice: LibraryDetail = {
      kind: 'practice',
      entry: entries[0],
      session: {
        witness: { id: 'w1', name: 'Elena Torres', role: 'Operator', avatarUrl: null },
        type: 'cross',
        goal: 'Lock in the booth.',
        cooperation: 'hostile',
        toneNotes: '',
        priorTestimony: '',
        endedAt: null,
        turns: [
          {
            position: 0,
            kind: 'question',
            text: 'You were in the booth?',
            createdAt: '2026-11-20T12:00:00Z',
            blocks: { coach: [{ kind: 'good', quote: 'in the booth', text: 'One fact, leading.' }], hold: false, objection: null, awaitResponse: false, ruling: null, counsel: null, witness: 'Yes.' },
          },
        ],
      },
    }
    renderAt('/courses/c1/library/practice/p1', { getLibraryEntry: vi.fn().mockResolvedValue(practice) })
    expect(await screen.findByRole('heading', { level: 1, name: 'Cross-examination of Elena Torres' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Coach’s notes' })).toHaveTextContent('One fact, leading.')
    expect(screen.getByText('Yes.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Download PDF' })).toHaveAttribute('href', '/api/courses/c1/library/practice/p1/pdf')
  })

  it('shows the questions a check of the team’s answers read', async () => {
    const answers: LibraryDetail = {
      kind: 'discovery',
      entry: entry({ subkind: 'interrogatories_answers', title: 'Answers to interrogatories' }),
      check: {
        kind: 'interrogatories',
        mode: 'answer',
        round: 1,
        tag: 'SMALL_EDITS',
        feedback: 'Answer 1 dodges the date.',
        content: { responses: [{ position: 0, answer: 'Sometime in June.', objection: false, admission: null, agreePart: '', disagreePart: '' }] },
        questions: [{ position: 0, text: 'When did you inspect the bar?' }],
      },
    }
    renderAt('/courses/c1/library/discovery/e1', { getLibraryEntry: vi.fn().mockResolvedValue(answers) })
    const checked = await screen.findByRole('region', { name: 'What was checked' })
    expect(checked).toHaveTextContent('When did you inspect the bar?')
    expect(checked).toHaveTextContent('Sometime in June.')
    expect(screen.getByRole('region', { name: 'The AI’s feedback' })).toHaveTextContent('Answer 1 dodges the date.')
  })
})
