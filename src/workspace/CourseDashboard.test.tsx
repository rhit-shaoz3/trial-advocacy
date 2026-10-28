import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { AuthProvider } from '../auth/AuthProvider'
import type { AuthService, User } from '../auth/types'
import { CourseServiceContext } from '../courses/CourseServiceContext'
import type { CalendarItem, CourseService } from '../courses/types'
import { fakeCourseService } from '../test/fakeCourseService'
import { withSampleData } from './sampleData'
import type { CourseHome } from './types'

const NOW = new Date('2026-10-10T09:00:00')

const ada: User = {
  id: 'user-1',
  name: 'Ada Lawyer',
  email: 'ada@example.com',
  role: 'student',
  theme: 'navy',
  avatarUrl: null,
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
    logOut: vi.fn().mockResolvedValue(undefined), updateProfile: vi.fn(), uploadAvatar: vi.fn(), removeAvatar: vi.fn(),
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

  it('shows the same dashboard with Cases and a Manage course tab', async () => {
    renderCourse(
      fakeCourseService({ getCourseHome: vi.fn().mockResolvedValue(emptyHome) }),
      '/courses/c1',
      ruiz,
    )

    expect(await screen.findByRole('heading', { name: 'Good morning, Elena.' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Course' })
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Dashboard',
      'Cases',
      'Calendar',
      'Review',
      'Manage course',
    ])
    expect(screen.getByRole('heading', { name: 'All cases' })).toBeInTheDocument()
    expect(screen.getByText('No cases yet.')).toBeInTheDocument()
  })

  it("shows each launched case with how many case worlds it has", async () => {
    const home: CourseHome = {
      ...emptyHome,
      cases: [
        {
          id: 'k1',
          title: 'Rivera v. Thrill Park',
          summary: '',
          status: 'active',
          world: null,
          worldCount: 8,
          progress: null,
          nextMilestone: null,
          participants: Array.from({ length: 32 }, (_, i) => ({ name: `Student ${i + 1}` })),
        },
      ],
    }
    renderCourse(fakeCourseService({ getCourseHome: vi.fn().mockResolvedValue(home) }), '/courses/c1', ruiz)

    const rivera = await screen.findByRole('article', { name: 'Rivera v. Thrill Park' })
    expect(rivera).toHaveTextContent('8 case worlds')
    expect(rivera).toHaveTextContent('32 participants')
    expect(rivera).toHaveTextContent('+28')
    expect(rivera).not.toHaveTextContent('Awaiting opposition')
  })

  it('shows a case on the dashboard as soon as it is made active, without a reload', async () => {
    const draft = {
      id: 'k1',
      title: 'Rivera v. Thrill Park',
      summary: '',
      status: 'draft' as const,
      phase: 'introduction',
      instructorNote: '',
      importantFacts: { plaintiff: ['The light was red.'], defense: ['It passed inspection.'] },
      createdAt: '2026-10-01T15:00:00.000Z',
      updatedAt: '2026-10-01T15:00:00.000Z',
    }
    const withCase: CourseHome = {
      ...emptyHome,
      cases: [
        {
          id: 'k1',
          title: 'Rivera v. Thrill Park',
          summary: '',
          status: 'active',
          world: null,
          worldCount: 0,
          progress: null,
          nextMilestone: null,
          participants: [],
        },
      ],
    }
    const getCourseHome = vi.fn().mockResolvedValueOnce(emptyHome).mockResolvedValue(withCase)
    const { user } = renderCourse(
      fakeCourseService({
        getCourseHome,
        getCase: vi.fn().mockResolvedValue(draft),
        updateCase: vi.fn().mockResolvedValue({ ...draft, status: 'active' }),
      }),
      '/courses/c1/cases/k1',
      ruiz,
    )

    await user.click(await screen.findByRole('button', { name: 'Edit case' }))
    await user.selectOptions(screen.getByLabelText('Status'), 'Active')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('button', { name: 'Edit case' })
    await user.click(within(screen.getByRole('navigation', { name: 'Course' })).getByRole('link', { name: 'Dashboard' }))

    expect(await screen.findByRole('article', { name: 'Rivera v. Thrill Park' })).toHaveTextContent('0 case worlds')
    expect(getCourseHome).toHaveBeenCalledTimes(2)
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
    // Where the case is, not a task percentage.
    expect(within(anderson).getByRole('list', { name: 'Phase 2 of 4: Information exchange' })).toBeInTheDocument()
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

  it("shows a launched case with the student's case world and role", async () => {
    const home: CourseHome = {
      ...emptyHome,
      cases: [
        {
          id: 'k1',
          title: 'Rivera v. Thrill Park',
          summary: 'A rollercoaster stalls.',
          status: 'active',
          world: { number: 4, side: 'defense' },
          worldCount: null,
          progress: null,
          nextMilestone: null,
          participants: ['Ada Lawyer', 'Kai Nakamura', 'Daniel Rivera', 'Isabella Rossi', 'Extra Person'].map(
            (name) => ({ name }),
          ),
        },
        {
          id: 'k2',
          title: 'State v. Hale',
          summary: '',
          status: 'active',
          world: null,
          worldCount: null,
          progress: null,
          nextMilestone: null,
          participants: [{ name: 'Ada Lawyer' }, { name: 'Kai Nakamura' }],
        },
      ],
    }
    renderCourse(fakeCourseService({ getCourseHome: vi.fn().mockResolvedValue(home) }))

    const rivera = await screen.findByRole('article', { name: 'Rivera v. Thrill Park' })
    expect(rivera).toHaveTextContent('Case world D')
    expect(rivera).toHaveTextContent('Role: Defendant')
    expect(rivera).toHaveTextContent('5 participants')
    // No case description on the card.
    expect(rivera).not.toHaveTextContent('A rollercoaster stalls.')
    // No task progress bar; four avatars and a count of the rest.
    expect(within(rivera).queryByRole('progressbar')).not.toBeInTheDocument()
    expect(rivera).toHaveTextContent('+1')
    expect(within(rivera).getByRole('link', { name: 'Enter case: Rivera v. Thrill Park' })).toHaveAttribute(
      'href',
      '/courses/c1/cases/k1',
    )

    const hale = screen.getByRole('article', { name: 'State v. Hale' })
    expect(hale).toHaveTextContent('Case world not assigned yet')
    expect(hale).toHaveTextContent('Awaiting opposition')
    expect(screen.getByRole('region', { name: 'Summary' })).toHaveTextContent('2Active cases')
  })

  it('opens placeholder pages from the sidebar', async () => {
    const { user } = renderCourse(
      fakeCourseService({ getCourseHome: vi.fn().mockResolvedValue(emptyHome) }),
    )

    await user.click(await screen.findByRole('link', { name: 'Resource library' }))

    expect(screen.getByRole('heading', { name: 'Resource library' })).toBeInTheDocument()
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

describe('reviews on the dashboard', () => {
  const ruiz: User = { ...ada, id: 'user-2', name: 'Elena Ruiz', role: 'instructor' }

  it("tells the instructor how many conversations wait for review, with a badge on Review", async () => {
    const { user } = renderCourse(
      fakeCourseService({ getCourseHome: vi.fn().mockResolvedValue({ ...emptyHome, reviewCount: 3 }) }),
      '/courses/c1',
      ruiz,
    )

    expect(await screen.findByText('3 reviews waiting')).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Course' })
    expect(within(nav).getByRole('link', { name: 'Review, 3 waiting' })).toHaveAttribute('href', '/courses/c1/review')

    await user.click(screen.getByRole('link', { name: 'Review now' }))
    expect(await screen.findByRole('heading', { name: 'Review' })).toBeInTheDocument()
  })

  it('shows nothing when no reviews wait', async () => {
    renderCourse(fakeCourseService({ getCourseHome: vi.fn().mockResolvedValue({ ...emptyHome, reviewCount: 0 }) }), '/courses/c1', ruiz)
    await screen.findByRole('heading', { name: 'Good morning, Elena.' })
    expect(screen.queryByText(/reviews? waiting/)).not.toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Course' })).getByRole('link', { name: 'Review' })).toBeInTheDocument()
  })

  it('tells a student when their interviews have been reviewed, and keeps their resource library', async () => {
    renderCourse(fakeCourseService({ getCourseHome: vi.fn().mockResolvedValue({ ...emptyHome, newReviewResults: 1 }) }))

    expect(await screen.findByText('New review results')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open my cases' })).toHaveAttribute('href', '/courses/c1/cases')
    const nav = screen.getByRole('navigation', { name: 'Course' })
    expect(within(nav).getByRole('link', { name: 'Resource library' })).toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: /Review/ })).not.toBeInTheDocument()
  })

  it("links a student's notice straight to a new investigator report", async () => {
    const home = { ...emptyHome, newReviewResults: 1, newResultsAt: { caseId: 'k1', kind: 'investigation' as const } }
    renderCourse(fakeCourseService({ getCourseHome: vi.fn().mockResolvedValue(home) }))

    expect(await screen.findByRole('link', { name: 'Read report' })).toHaveAttribute('href', '/courses/c1/cases/k1?tab=investigator')
  })
})

describe("the instructor's own dashboard", () => {
  const instructorHome: CourseHome = {
    ...emptyHome,
    reviewCount: 2,
    instructor: {
      stats: { studentsJoined: 30, studentsOnRoster: 32, activeCases: 1, draftCases: 1, questionsThisWeek: 214, reviewsWaiting: 2 },
      cases: [
        {
          id: 'k2',
          title: 'Practice case',
          status: 'draft',
          phase: 'introduction',
          worldCount: 0,
          launch: { ready: 2, total: 3, next: '2 students are not on a team yet.' },
          tasks: null,
        },
        {
          id: 'k1',
          title: 'Rivera v. Thrill Park',
          status: 'active',
          phase: 'investigate',
          worldCount: 8,
          launch: null,
          tasks: { due: 2, teamsDoneDue: 9, assigned: 4, teamsDoneAll: 3, teams: 16 },
        },
      ],
      attention: [
        { id: 'reviews', kind: 'reviews', text: '2 interviews are waiting for your review.', target: { page: 'review' } },
        {
          id: 'transcription-k1',
          kind: 'transcription',
          text: "Rivera v. Thrill Park: 1 file couldn't be read for the AI witnesses.",
          target: { page: 'case', caseId: 'k1', tab: 'materials' },
        },
        { id: 'roster', kind: 'roster', text: "2 students on your roster haven't signed up yet.", target: { page: 'manage' } },
      ],
      deadlines: [
        { id: 't1', title: 'Outline the deposition', caseId: 'k1', caseTitle: 'Rivera v. Thrill Park', dueAt: '2026-10-16T23:59:00.000Z', teamsDone: 9, teams: 16 },
      ],
      activity: [
        { id: 'a1', kind: 'interview', actor: 'Team 3', action: 'ended an interview with Elena Torres', caseTitle: 'Rivera v. Thrill Park', at: new Date(NOW.getTime() - 12 * 60_000).toISOString() },
        { id: 'a2', kind: 'join', actor: null, action: '30 students joined the course', caseTitle: null, at: '2026-10-08T09:00:00.000Z' },
      ],
    },
  }
  const renderInstructor = () =>
    renderCourse(fakeCourseService({ getCourseHome: vi.fn().mockResolvedValue(instructorHome) }), '/courses/c1', ruiz)

  it('sums up the course instead of a student to-do list', async () => {
    renderInstructor()
    const summary = await screen.findByRole('region', { name: 'Course summary' })
    expect(summary).toHaveTextContent('30/32Students signed up2 pending')
    expect(summary).toHaveTextContent('1Active case+1 draft')
    expect(summary).not.toHaveTextContent('Witness questions this week')
    expect(summary).toHaveTextContent('2Reviews waitingNeeds your ruling')
    expect(screen.getByText(/3 things need your attention/)).toBeInTheDocument()
    expect(screen.queryByText('Tasks completed')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Your cases' })).not.toBeInTheDocument()
    // A case can be added straight from here.
    expect(screen.getByRole('link', { name: 'Add case' })).toHaveAttribute('href', '/courses/c1/cases/new')
  })

  it("links each thing that needs the instructor to where it's fixed", async () => {
    renderInstructor()
    const panel = await screen.findByRole('region', { name: 'Needs your attention' })
    expect(within(panel).getByRole('link', { name: 'Review now' })).toHaveAttribute('href', '/courses/c1/review')
    expect(within(panel).getByRole('link', { name: 'Open case file' })).toHaveAttribute('href', '/courses/c1/cases/k1?tab=materials')
    expect(within(panel).getByRole('link', { name: 'Manage course' })).toHaveAttribute('href', '/courses/c1/manage')
  })

  it('monitors each case: a draft’s launch checklist, an active case’s phase and teams caught up', async () => {
    renderInstructor()
    const draft = await screen.findByRole('article', { name: 'Practice case' })
    expect(draft).toHaveTextContent('Draft')
    expect(draft).toHaveTextContent('Launch checklist2 of 3 ready')
    expect(draft).toHaveTextContent('2 students are not on a team yet.')
    expect(within(draft).getByRole('link', { name: 'Set up case: Practice case' })).toHaveAttribute('href', '/courses/c1/cases/k2')

    const active = screen.getByRole('article', { name: 'Rivera v. Thrill Park' })
    expect(within(active).getByRole('list', { name: 'Phase 2 of 3: Investigate' })).toBeInTheDocument()
    expect(within(active).getByText('Investigate', { selector: '[aria-current="step"]' })).toBeInTheDocument()
    expect(within(active).getByRole('progressbar', { name: 'Teams done with tasks due so far' })).toHaveAttribute('aria-valuenow', '9')
    expect(active).toHaveTextContent('9 of 16 teams')
    expect(active).toHaveTextContent('2 tasks due so far')
    // Moving the phase happens on the case page.
    expect(within(active).getByRole('link', { name: 'Open case: Rivera v. Thrill Park' })).toHaveAttribute('href', '/courses/c1/cases/k1')
  })

  it('shows deadlines with how many teams finished, and recent activity', async () => {
    renderInstructor()
    const deadlines = await screen.findByRole('region', { name: 'Upcoming deadlines' })
    expect(within(deadlines).getByRole('link', { name: 'Outline the deposition' })).toHaveAttribute('href', '/courses/c1/cases/k1?tab=tasks')
    expect(deadlines).toHaveTextContent('9/16teams done')

    const activity = screen.getByRole('region', { name: 'Recent activity' })
    expect(activity).toHaveTextContent('Team 3 ended an interview with Elena Torres')
    expect(activity).toHaveTextContent('Rivera v. Thrill Park · 12 minutes ago')
    expect(activity).toHaveTextContent('30 students joined the course')
  })

  it("says when nothing needs the instructor, and leaves the student's dashboard as it was", async () => {
    renderCourse(
      fakeCourseService({
        getCourseHome: vi.fn().mockResolvedValue({ ...instructorHome, instructor: { ...instructorHome.instructor!, attention: [] } }),
      }),
      '/courses/c1',
      ruiz,
    )
    expect(await screen.findByText(/Nothing needs you right now/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Needs your attention' })).not.toBeInTheDocument()
  })
})

describe('the calendar', () => {
  const item = (over: Partial<CalendarItem>): CalendarItem => ({
    id: 'x',
    kind: 'task',
    title: 'Task',
    notes: '',
    date: '2026-10-20',
    dueAt: null,
    caseId: 'k1',
    caseTitle: 'Rivera v. Thrill Park',
    teamNumber: null,
    done: false,
    mine: false,
    ...over,
  })
  const items = [
    item({ id: 't1', title: 'Outline the deposition', dueAt: '2026-10-20T23:59:00.000Z' }),
    item({ id: 'e1', kind: 'case', title: 'Depositions begin', date: '2026-10-22' }),
    item({ id: 'e2', kind: 'personal', title: 'Read the file', date: '2026-10-14', caseId: null, caseTitle: null, mine: true }),
    item({ id: 'e3', kind: 'team', title: 'Team prep', date: '2026-10-15', teamNumber: 3 }),
  ]

  it("puts a student's tasks, case dates, and events on the month, by kind, and filters them", async () => {
    const service = fakeCourseService({
      getCourseHome: vi.fn().mockResolvedValue(emptyHome),
      getCalendar: vi.fn().mockResolvedValue(items),
      listMyCases: vi.fn().mockResolvedValue([]),
    })
    const { user } = renderCourse(service, '/courses/c1/calendar')

    const grid = await screen.findByRole('grid', { name: 'October 2026' })
    expect(within(grid).getByRole('button', { name: 'Outline the deposition' })).toHaveClass('cal-kind-task')
    expect(within(grid).getByRole('button', { name: 'Depositions begin' })).toHaveClass('cal-kind-case')
    expect(within(grid).getByRole('button', { name: 'Read the file' })).toHaveClass('cal-kind-personal')
    expect(within(grid).getByRole('button', { name: 'Team prep' })).toHaveClass('cal-kind-team')

    // Turning a kind off hides it.
    await user.click(screen.getByRole('button', { name: 'Team' }))
    expect(within(grid).queryByRole('button', { name: 'Team prep' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Tasks' }))
    expect(within(grid).queryByRole('button', { name: 'Outline the deposition' })).not.toBeInTheDocument()
    expect(within(grid).getByRole('button', { name: 'Depositions begin' })).toBeInTheDocument()
  })

  it('shares a new event with the team', async () => {
    const createCalendarEvent = vi.fn().mockResolvedValue(items)
    const service = fakeCourseService({
      getCourseHome: vi.fn().mockResolvedValue(emptyHome),
      getCalendar: vi.fn().mockResolvedValue([]),
      listMyCases: vi.fn().mockResolvedValue([{ id: 'k1', title: 'Rivera v. Thrill Park', summary: '', status: 'active', team: { number: 3, members: [] }, world: null }]),
      createCalendarEvent,
    })
    const { user } = renderCourse(service, '/courses/c1/calendar')

    await user.click(await screen.findByRole('button', { name: 'Add an event on Fri, Oct 16' }))
    const form = screen.getByRole('form', { name: 'Add event' })
    await user.type(within(form).getByLabelText('Title'), 'Team prep')
    await user.click(within(form).getByRole('radio', { name: 'Share with my team' }))
    await user.click(within(form).getByRole('button', { name: 'Add event' }))

    expect(createCalendarEvent).toHaveBeenCalledWith('c1', { kind: 'team', title: 'Team prep', notes: '', date: '2026-10-16', caseId: 'k1' })
    expect(await screen.findByRole('button', { name: 'Team prep' })).toBeInTheDocument()
  })
})
