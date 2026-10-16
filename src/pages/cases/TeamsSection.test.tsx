import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CourseServiceContext } from '../../courses/CourseServiceContext'
import type { CaseTeams, CourseService, RosterEntry } from '../../courses/types'
import { fakeCourseService } from '../../test/fakeCourseService'
import { TeamsSection } from './TeamsSection'

const ada: RosterEntry = { email: 'ada@example.com', name: 'Ada Lawyer', joined: true }
const ben: RosterEntry = { email: 'ben@example.com', name: 'Ben Counsel', joined: true }
const cy: RosterEntry = { email: 'cy@example.com', name: null, joined: false }
const dee: RosterEntry = { email: 'dee@example.com', name: 'Dee Judge', joined: true }

const unpairedOnly: CaseTeams = { teams: [], unpaired: [ada, ben, cy], matchups: [] }
const oneTeam: CaseTeams = { teams: [{ id: 't1', number: 1, members: [ada, ben] }], unpaired: [cy, dee], matchups: [] }

function renderSection(initial: CaseTeams, overrides: Partial<CourseService> = {}, closed = false) {
  const service = fakeCourseService({ listTeams: vi.fn().mockResolvedValue(initial), ...overrides })
  const user = userEvent.setup()
  render(
    <CourseServiceContext.Provider value={service}>
      <TeamsSection courseId="c1" caseId="k1" closed={closed} />
    </CourseServiceContext.Provider>,
  )
  return { user, service }
}

const team = (n: number) => screen.getByRole('listitem', { name: `Team ${n}` })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TeamsSection', () => {
  it('lists unpaired students, marking pending ones', async () => {
    const { service } = renderSection(unpairedOnly)

    expect(await screen.findByText('Not on a team (3)')).toBeInTheDocument()
    expect(service.listTeams).toHaveBeenCalledWith('c1', 'k1')
    expect(screen.getByText(/0 teams · 0 paired · 3 not on a team/)).toBeInTheDocument()
    expect(screen.getByLabelText(/cy@example.com/)).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()
  })

  it('auto-pairs everyone left and shows the teams', async () => {
    const autoPair = vi.fn().mockResolvedValue({
      teams: [{ id: 't1', number: 1, members: [ada, ben, cy] }],
      unpaired: [], matchups: []
    })
    const { user } = renderSection(unpairedOnly, { autoPair })

    await user.click(await screen.findByRole('button', { name: 'Auto-pair 3 students' }))

    expect(autoPair).toHaveBeenCalledWith('c1', 'k1')
    expect(within(team(1)).getByText('Ada Lawyer')).toBeInTheDocument()
    expect(screen.queryByText(/Not on a team \(/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Auto-pair/ })).not.toBeInTheDocument()
  })

  it('pairs the selected students', async () => {
    const createTeam = vi.fn().mockResolvedValue({
      teams: [{ id: 't1', number: 1, members: [ada, cy] }],
      unpaired: [ben], matchups: []
    })
    const { user } = renderSection(unpairedOnly, { createTeam })

    const pair = await screen.findByRole('button', { name: 'Pair selected' })
    expect(pair).toBeDisabled()
    await user.click(screen.getByLabelText(/Ada Lawyer/))
    await user.click(screen.getByLabelText(/cy@example.com/))
    await user.click(screen.getByRole('button', { name: 'Pair selected (2)' }))

    expect(createTeam).toHaveBeenCalledWith('c1', 'k1', ['ada@example.com', 'cy@example.com'])
    expect(within(team(1)).getByText('cy@example.com')).toBeInTheDocument()
    // The selection is cleared of students who are now paired.
    expect(screen.getByRole('button', { name: 'Pair selected' })).toBeDisabled()
  })

  it('adds and removes team members', async () => {
    const addTeamMember = vi.fn().mockResolvedValue({
      teams: [{ id: 't1', number: 1, members: [ada, ben, dee] }],
      unpaired: [cy], matchups: []
    })
    const removeTeamMember = vi.fn().mockResolvedValue({
      teams: [{ id: 't1', number: 1, members: [ben, dee] }],
      unpaired: [ada, cy], matchups: []
    })
    const { user } = renderSection(oneTeam, { addTeamMember, removeTeamMember })

    await user.selectOptions(await screen.findByLabelText('Add a student to Team 1'), 'Dee Judge')
    expect(addTeamMember).toHaveBeenCalledWith('c1', 'k1', 't1', 'dee@example.com')
    expect(await within(team(1)).findByText('Dee Judge')).toBeInTheDocument()
    // A team of three is full.
    expect(screen.queryByLabelText('Add a student to Team 1')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove Ada Lawyer from Team 1' }))
    expect(removeTeamMember).toHaveBeenCalledWith('c1', 'k1', 't1', 'ada@example.com')
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Remove Ada Lawyer from Team 1' })).not.toBeInTheDocument(),
    )
  })

  it('deletes a team after confirming', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const deleteTeam = vi.fn().mockResolvedValue({ teams: [], unpaired: [ada, ben, cy, dee], matchups: [] })
    const { user } = renderSection(oneTeam, { deleteTeam })

    await screen.findByText('Ada Lawyer')
    await user.click(within(team(1)).getByRole('button', { name: 'Delete' }))

    expect(deleteTeam).toHaveBeenCalledWith('c1', 'k1', 't1')
    expect(screen.queryByRole('listitem', { name: 'Team 1' })).not.toBeInTheDocument()
    expect(screen.getByText('Not on a team (4)')).toBeInTheDocument()
  })

  it('clears every team only after confirming', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const clearTeams = vi.fn().mockResolvedValue({ teams: [], unpaired: [ada, ben, cy, dee], matchups: [] })
    const { user } = renderSection(oneTeam, { clearTeams })

    await user.click(await screen.findByRole('button', { name: 'Clear all teams' }))
    expect(clearTeams).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Clear all teams' }))
    expect(clearTeams).toHaveBeenCalledWith('c1', 'k1')
    expect(screen.queryByRole('listitem', { name: 'Team 1' })).not.toBeInTheDocument()
  })

  it('shows server errors', async () => {
    const { user } = renderSection(unpairedOnly, {
      autoPair: vi.fn().mockRejectedValue(new Error('Everyone is already on a team.')),
    })

    await user.click(await screen.findByRole('button', { name: 'Auto-pair 3 students' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Everyone is already on a team.')
  })

  it('is read-only for a closed case', async () => {
    renderSection(oneTeam, {}, true)

    const teamsRegion = await screen.findByRole('region', { name: 'Teams' })
    expect(await within(teamsRegion).findByText(/This case is closed/)).toBeInTheDocument()
    expect(within(team(1)).getByText('Ada Lawyer')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })
})
