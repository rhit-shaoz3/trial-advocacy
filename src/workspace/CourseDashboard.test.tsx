import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { AuthProvider } from '../auth/AuthProvider'
import type { AuthService, User } from '../auth/types'
import { CourseServiceContext } from '../courses/CourseServiceContext'
import type { CourseService } from '../courses/types'
import { fakeCourseService } from '../test/fakeCourseService'
import { withSampleData } from './sampleData'
import type { CourseHome } from './types'

const NOW = new Date('2026-10-10T09:00:00')

const ada: User = {
  id: 'user-1',
  name: 'Ada Lawyer',
  email: 'ada@example.com',
  role: 'student',
  createdAt: '2026-01-01T00:00:00.000Z',
}

const emptyHome: CourseHome = {
  course: {
    id: 'c1',
    code: 'LAW 540',
    title: 'Trial Advocacy',
    term: 'Fall 2026',
    instructorName: 'Prof. Ruiz',
  },
  cases: [],
  activity: [],
  upcoming: [],
  stats: { tasksCompleted: 0, tasksCompletedThisWeek: 0 },
}

const ruiz: User = { ...ada, id: 'user-2', name: 'Elena Ruiz', role: 'instructor' }

function renderCourse(courseService: CourseService, url = '/courses/c1', signedIn: User = ada) {
  const auth: AuthService = {
    getCurrentUser: vi.fn().mockResolvedValue(signedIn),
    signUp: vi.fn(),
    logIn: vi.fn(),
    logOut: vi.fn().mockResolvedValue(undefined),
  }
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={[url]}>
      <CourseServiceContext.Provider value={courseService}>
        <AuthProvider service={auth}>
          <App />
        </AuthProvider>
      </CourseServiceContext.Provider>
    </MemoryRouter>,
  )
  return { user, auth }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('course workspace for the instructor', () => {
  const taught = {
    ...emptyHome.course,
    season: 'Fall' as const,
    year: 2026,
    entryCode: 'K7PQ2M',
    studentCount: 0,
  }

  it('shows the same dashboard with All cases and a Manage course tab', async () => {
    renderCourse(
      fakeCourseService({ getCourseHome: vi.fn().mockResolvedValue(emptyHome) }),
      '/courses/c1',
      ruiz,
    )

    expect(await screen.findByRole('heading', { name: 'Good morning, Elena.' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Course' })
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Dashboard',
      'All cases',
      'Calendar',
      'Resource library',
      'Manage course',
    ])
    expect(screen.getByRole('heading', { name: 'All cases' })).toBeInTheDocument()
    expect(screen.getByText('No cases yet.')).toBeInTheDocument()
  })

  it('opens the course management page as a tab', async () => {
    const service = fakeCourseService({
      getCourseHome: vi.fn().mockResolvedValue(emptyHome),
      getCourse: vi.fn().mockResolvedValue(taught),
    })
    const { user } = renderCourse(service, '/courses/c1', ruiz)

    await user.click(await screen.findByRole('link', { name: 'Manage course' }))

    expect(await screen.findByRole('heading', { name: 'LAW 540: Trial Advocacy' })).toBeInTheDocument()
    expect(screen.getByText('K7PQ2M')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Manage course' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('region', { name: /Students/ })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Fact patterns' })).toBeInTheDocument()
  })

  it('updates the sidebar after the course is renamed', async () => {
    const renamed = { ...emptyHome, course: { ...emptyHome.course, title: 'Advanced Trial Advocacy' } }
    const getCourseHome = vi.fn().mockResolvedValueOnce(emptyHome).mockResolvedValueOnce(renamed)
    const service = fakeCourseService({
      getCourseHome,
      getCourse: vi.fn().mockResolvedValue(taught),
      updateCourse: vi.fn().mockResolvedValue({ ...taught, title: 'Advanced Trial Advocacy' }),
    })
    const { user } = renderCourse(service, '/courses/c1/manage', ruiz)

    await user.click(await screen.findByRole('button', { name: 'Edit course' }))
    await user.clear(screen.getByLabelText('Course title'))
    await user.type(screen.getByLabelText('Course title'), 'Advanced Trial Advocacy')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const sidebar = screen.getByRole('complementary')
    expect(await within(sidebar).findByText('Advanced Trial Advocacy')).toBeInTheDocument()
    expect(getCourseHome).toHaveBeenCalledTimes(2)
  })
})

describe('course workspace', () => {
  it('shows the course in the sidebar with workspace navigation', async () => {
    const service = fakeCourseService({ getCourseHome: vi.fn().mockResolvedValue(emptyHome) })
    renderCourse(service)

    await screen.findByRole('heading', { name: 'Good morning, Ada.' })
    expect(service.getCourseHome).toHaveBeenCalledWith('c1')
    const sidebar = screen.getByRole('complementary')
    expect(within(sidebar).getByText('Fall 2026')).toBeInTheDocument()
    expect(within(sidebar).getByText('Prof. Ruiz')).toBeInTheDocument()
    const nav = within(sidebar).getByRole('navigation', { name: 'Course' })
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'My cases' })).toHaveAttribute('href', '/courses/c1/cases')
    expect(within(sidebar).getByRole('link', { name: 'All courses' })).toHaveAttribute('href', '/')
    // No top navbar inside the workspace.
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
  })

  it('explains the empty state before any cases exist', async () => {
    renderCourse(fakeCourseService({ getCourseHome: vi.fn().mockResolvedValue(emptyHome) }))

    expect(await screen.findByText('No case deadlines coming up.', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('You haven’t been assigned to a case yet.')).toBeInTheDocument()
    expect(screen.getByText('No activity yet.')).toBeInTheDocument()
    expect(screen.getByText('Nothing scheduled.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /View all cases/ })).not.toBeInTheDocument()
    const stats = screen.getByRole('region', { name: 'Summary' })
    expect(stats).toHaveTextContent('0Active cases')
    expect(stats).toHaveTextContent('0Tasks completed')
    expect(stats).toHaveTextContent('0Upcoming deadlines')
  })

  it('shows cases, stats, activity, and upcoming deadlines', async () => {
    const home = withSampleData(emptyHome, NOW)
    renderCourse(fakeCourseService({ getCourseHome: vi.fn().mockResolvedValue(home) }))

    expect(await screen.findByText(/Your next case deadline is in 3 days\./)).toBeInTheDocument()

    const stats = screen.getByRole('region', { name: 'Summary' })
    expect(stats).toHaveTextContent('1Active cases')
    expect(stats).toHaveTextContent('18Tasks completed+6 this week')
    expect(stats).toHaveTextContent('1Upcoming deadlinesNext in 3 days')

    const anderson = screen.getByRole('article', { name: 'Anderson v. Caldwell' })
    expect(anderson).toHaveTextContent('Case 24-CV-1847')
    expect(anderson).toHaveTextContent('Active')
    expect(within(anderson).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '62')
    expect(anderson).toHaveTextContent('4 participants')
    expect(within(anderson).getByRole('link', { name: 'Enter case: Anderson v. Caldwell' })).toHaveAttribute(
      'href',
      '/courses/c1/cases/sample-1',
    )

    const rivera = screen.getByRole('article', { name: 'Rivera v. Metro Transit' })
    expect(rivera).toHaveTextContent('In review')
    expect(rivera).toHaveTextContent('Awaiting instructor review')
    expect(within(rivera).getByRole('link', { name: /View submission/ })).toBeInTheDocument()

    const activity = screen.getByRole('region', { name: 'Recent activity' })
    const rows = within(activity).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Jordan Kim completed the witness interview')
    expect(rows[0]).toHaveTextContent('Anderson v. Caldwell · 42 minutes ago')
    expect(rows[2]).toHaveTextContent('Yesterday')

    const upcoming = screen.getByRole('region', { name: 'Upcoming' })
    const [deadline, event] = within(upcoming).getAllByRole('listitem')
    expect(deadline).toHaveTextContent('13OCTDiscovery deadline')
    expect(event).toHaveTextContent('Team deposition')
  })

  it('leaves out past events and lists the rest soonest first', async () => {
    const home: CourseHome = {
      ...emptyHome,
      upcoming: [
        { id: 'later', kind: 'event', title: 'Later event', caseTitle: 'X v. Y', at: '2026-10-20T10:00:00' },
        { id: 'past', kind: 'deadline', title: 'Missed deadline', caseTitle: 'X v. Y', at: '2026-10-09T10:00:00' },
        { id: 'soon', kind: 'deadline', title: 'Soon deadline', caseTitle: 'X v. Y', at: '2026-10-11T17:00:00' },
      ],
    }
    renderCourse(fakeCourseService({ getCourseHome: vi.fn().mockResolvedValue(home) }))

    expect(await screen.findByText(/Your next case deadline is tomorrow\./)).toBeInTheDocument()
    const items = within(screen.getByRole('region', { name: 'Upcoming' })).getAllByRole('listitem')
    expect(items.map((i) => i.querySelector('h3')!.textContent)).toEqual(['Soon deadline', 'Later event'])
  })

  it('shows a not-found message for a course the student is not in', async () => {
    renderCourse(
      fakeCourseService({ getCourseHome: vi.fn().mockRejectedValue(new Error('Course not found.')) }),
    )

    expect(await screen.findByRole('heading', { name: 'Course not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to your courses' })).toHaveAttribute('href', '/')
  })

  it('opens placeholder pages from the sidebar', async () => {
    const { user } = renderCourse(
      fakeCourseService({ getCourseHome: vi.fn().mockResolvedValue(emptyHome) }),
    )

    await user.click(await screen.findByRole('link', { name: 'Calendar' }))

    expect(screen.getByRole('heading', { name: 'Calendar' })).toBeInTheDocument()
    expect(screen.getByText('This page is coming soon.')).toBeInTheDocument()
  })

  it('fills in sample data with ?sample in development, and says so', async () => {
    renderCourse(
      fakeCourseService({ getCourseHome: vi.fn().mockResolvedValue(emptyHome) }),
      '/courses/c1?sample',
    )

    expect(await screen.findByRole('article', { name: 'Anderson v. Caldwell' })).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('Showing sample cases')
    expect(screen.getByRole('link', { name: 'Calendar' })).toHaveAttribute('href', '/courses/c1/calendar?sample')
  })

  it('gives students no Manage course tab, even by URL', async () => {
    renderCourse(
      fakeCourseService({ getCourseHome: vi.fn().mockResolvedValue(emptyHome) }),
      '/courses/c1/manage',
    )

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Manage course' })).not.toBeInTheDocument()
  })

  it('logs out from the sidebar', async () => {
    const { user, auth } = renderCourse(
      fakeCourseService({ getCourseHome: vi.fn().mockResolvedValue(emptyHome) }),
    )

    await user.click(await screen.findByRole('button', { name: 'Log out' }))

    expect(auth.logOut).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument()
  })
})
