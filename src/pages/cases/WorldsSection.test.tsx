import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CourseServiceContext } from '../../courses/CourseServiceContext'
import type { CaseTeams, CourseService, RosterEntry, Team } from '../../courses/types'
import { worldLabel } from '../../courses/worldLabel'
import { fakeCourseService } from '../../test/fakeCourseService'
import { TeamsSection } from './TeamsSection'

const student = (name: string): RosterEntry => ({ email: `${name.toLowerCase()}@example.com`, name, joined: true })
const t1: Team = { id: 't1', number: 1, members: [student('Ada'), student('Ben')] }
const t2: Team = { id: 't2', number: 2, members: [student('Cy'), student('Dee')] }
const t3: Team = { id: 't3', number: 3, members: [student('Eve'), student('Fay')] }

const waiting: CaseTeams = { teams: [t1, t2, t3], unpaired: [], matchups: [] }
const oneWorld: CaseTeams = {
  teams: [t1, t2, t3],
  unpaired: [],
  matchups: [{ id: 'm1', number: 1, plaintiffTeamId: 't1', defenseTeamId: 't2' }],
}

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

const worlds = () => screen.getByRole('region', { name: 'Case worlds' })
const world = (label: string) => screen.getByRole('listitem', { name: `World ${label}` })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('worldLabel', () => {
  it('letters worlds like spreadsheet columns', () => {
    expect([1, 2, 26, 27, 52].map(worldLabel)).toEqual(['A', 'B', 'Z', 'AA', 'AZ'])
  })
})

describe('case worlds', () => {
  it('asks for teams first when there are none', async () => {
    renderSection({ teams: [], unpaired: [student('Ada')], matchups: [] })

    expect(await within(await screen.findByRole('region', { name: 'Case worlds' })).findByText('Pair students into teams first.')).toBeInTheDocument()
  })

  it('shows each world with its plaintiff and defense teams, and teams still waiting', async () => {
    renderSection(oneWorld)

    await screen.findByRole('region', { name: 'Case worlds' })
    expect(world('A')).toHaveTextContent('PlaintiffTeam 1: Ada & Ben')
    expect(world('A')).toHaveTextContent('DefenseTeam 2: Cy & Dee')
    expect(within(worlds()).getByText('Waiting for an opponent (1)')).toBeInTheDocument()
    expect(within(worlds()).getByText('Team 3: Eve & Fay')).toBeInTheDocument()
    // One waiting team can't be matched.
    expect(within(worlds()).queryByRole('button', { name: /Auto-match/ })).not.toBeInTheDocument()
  })

  it('auto-matches the waiting teams', async () => {
    const autoMatch = vi.fn().mockResolvedValue({
      ...waiting,
      matchups: [{ id: 'm1', number: 1, plaintiffTeamId: 't3', defenseTeamId: 't1' }],
    })
    const { user } = renderSection(waiting, { autoMatch })

    await user.click(await screen.findByRole('button', { name: 'Auto-match 3 teams' }))

    expect(autoMatch).toHaveBeenCalledWith('c1', 'k1')
    expect(world('A')).toHaveTextContent('PlaintiffTeam 3: Eve & Fay')
  })

  it('creates a world from chosen teams', async () => {
    const createMatchup = vi.fn().mockResolvedValue(oneWorld)
    const { user } = renderSection(waiting, { createMatchup })

    const form = await screen.findByRole('form', { name: 'New case world' })
    const create = within(form).getByRole('button', { name: 'Create world' })
    expect(create).toBeDisabled()
    await user.selectOptions(within(form).getByLabelText('Plaintiff'), 'Team 1')
    // The plaintiff team can't also be the defense.
    expect(within(within(form).getByLabelText('Defense')).getByRole('option', { name: 'Team 1' })).toBeDisabled()
    await user.selectOptions(within(form).getByLabelText('Defense'), 'Team 2')
    await user.click(create)

    expect(createMatchup).toHaveBeenCalledWith('c1', 'k1', 't1', 't2')
    expect(await screen.findByRole('listitem', { name: 'World A' })).toBeInTheDocument()
  })

  it('swaps sides and deletes a world', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const swapSides = vi.fn().mockResolvedValue({
      ...oneWorld,
      matchups: [{ id: 'm1', number: 1, plaintiffTeamId: 't2', defenseTeamId: 't1' }],
    })
    const deleteMatchup = vi.fn().mockResolvedValue(waiting)
    const { user } = renderSection(oneWorld, { swapSides, deleteMatchup })

    await screen.findByRole('listitem', { name: 'World A' })
    await user.click(within(world('A')).getByRole('button', { name: 'Swap sides' }))
    expect(swapSides).toHaveBeenCalledWith('c1', 'k1', 'm1')
    expect(world('A')).toHaveTextContent('PlaintiffTeam 2: Cy & Dee')

    await user.click(within(world('A')).getByRole('button', { name: 'Delete' }))
    expect(deleteMatchup).toHaveBeenCalledWith('c1', 'k1', 'm1')
    expect(screen.queryByRole('listitem', { name: 'World A' })).not.toBeInTheDocument()
  })

  it('shows errors in the worlds section', async () => {
    const { user } = renderSection(waiting, {
      autoMatch: vi.fn().mockRejectedValue(new Error('There are not two teams waiting for an opponent.')),
    })

    await user.click(await screen.findByRole('button', { name: 'Auto-match 3 teams' }))

    expect(await within(worlds()).findByRole('alert')).toHaveTextContent('There are not two teams waiting')
  })

  it('is read-only for a closed case', async () => {
    renderSection(oneWorld, {}, true)

    await screen.findByRole('listitem', { name: 'World A' })
    expect(within(worlds()).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'New case world' })).not.toBeInTheDocument()
  })
})
