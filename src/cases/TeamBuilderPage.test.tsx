import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeCase, students } from '../test/caseFixtures'
import { fakeCasesApi } from '../test/fakeCasesApi'
import { renderWithProviders } from '../test/renderWithProviders'
import { TeamBuilderPage } from './TeamBuilderPage'
import type { InstructorCase } from './types'

afterEach(() => {
  vi.restoreAllMocks()
})

async function renderBuilder(c: InstructorCase = makeCase()) {
  const casesApi = fakeCasesApi({
    getInstructorCase: vi.fn().mockResolvedValue(c),
    saveTeams: vi.fn().mockResolvedValue(c),
  })
  const result = renderWithProviders(<TeamBuilderPage />, {
    casesApi,
    url: '/cases/case-1/teams',
    path: '/cases/:caseId/teams',
  })
  await screen.findByRole('heading', { name: 'Good advocacy starts with a team.' })
  return result
}

const teamCards = () => screen.queryAllByRole('textbox', { name: /^Name of team/ })

describe('team builder', () => {
  it('auto-matches students into named teams with alternating sides', async () => {
    const { user } = await renderBuilder()
    await user.clear(screen.getByLabelText('Students per team'))
    await user.type(screen.getByLabelText('Students per team'), '2')
    await user.click(screen.getByRole('button', { name: 'Auto-pair students' }))

    // 5 students in teams of 2: two teams, the leftover joins one of them.
    expect(teamCards().map((input) => (input as HTMLInputElement).value)).toEqual([
      'Smith v. Jones 1',
      'Smith v. Jones 2',
    ])
    expect(screen.getByLabelText('Side of Smith v. Jones 1')).toHaveValue('plaintiff')
    expect(screen.getByLabelText('Side of Smith v. Jones 2')).toHaveValue('defendant')
    expect(screen.getByRole('heading', { name: 'Unassigned (0)' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Before you can continue' })).not.toBeInTheDocument()
  })

  it('asks before replacing existing teams', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user } = await renderBuilder()
    await user.click(screen.getByRole('button', { name: 'New team' }))
    await user.click(screen.getByRole('button', { name: 'Auto-pair students' }))

    expect(confirm).toHaveBeenCalled()
    expect(teamCards()).toHaveLength(1) // kept the manual team
  })

  it('blocks submit until every student is on a non-empty team', async () => {
    const { user, casesApi } = await renderBuilder()
    await user.click(screen.getByRole('button', { name: 'New team' }))

    const problems = screen.getByRole('list', { name: 'Before you can continue' })
    expect(problems).toHaveTextContent('Smith v. Jones 1 has no students.')
    expect(problems).toHaveTextContent('Not on a team yet: Ana, Bo, Cy, Di, Ed.')
    expect(screen.getByRole('button', { name: 'Continue to match-ups' })).toBeDisabled()

    for (const s of students) {
      await user.selectOptions(screen.getByLabelText(`Move ${s.name} to`), 'Smith v. Jones 1')
    }
    expect(screen.queryByRole('list', { name: 'Before you can continue' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue to match-ups' }))

    expect(casesApi.saveTeams).toHaveBeenCalledWith('case-1', [
      {
        name: 'Smith v. Jones 1',
        side: 'plaintiff',
        studentIds: ['s1', 's2', 's3', 's4', 's5'],
      },
    ])
    expect(await screen.findByText('Navigated to /cases/case-1/matchups')).toBeInTheDocument()
  })

  it('edits saved teams, keeping their ids', async () => {
    const c = makeCase({
      teams: [
        { id: 't1', name: 'Alpha', side: 'plaintiff', members: students.slice(0, 3) },
        { id: 't2', name: 'Beta', side: 'defendant', members: students.slice(3) },
      ],
    })
    const { user, casesApi } = await renderBuilder(c)

    const alpha = screen.getByLabelText('Name of team 1')
    await user.clear(alpha)
    await user.type(alpha, 'Alpha Squad')
    await user.selectOptions(screen.getByLabelText('Move Ana to'), 'Beta')
    await user.click(screen.getByRole('button', { name: 'Continue to match-ups' }))

    expect(casesApi.saveTeams).toHaveBeenCalledWith('case-1', [
      { id: 't1', name: 'Alpha Squad', side: 'plaintiff', studentIds: ['s2', 's3'] },
      { id: 't2', name: 'Beta', side: 'defendant', studentIds: ['s4', 's5', 's1'] },
    ])
  })

  it('unassigns a student with the ✕ button', async () => {
    const c = makeCase({
      teams: [{ id: 't1', name: 'Alpha', side: 'plaintiff', members: students }],
    })
    const { user } = await renderBuilder(c)
    await user.click(screen.getByRole('button', { name: 'Remove Ana from Alpha' }))

    expect(screen.getByRole('heading', { name: 'Unassigned (1)' })).toBeInTheDocument()
    expect(screen.getByLabelText('Move Ana to')).toHaveValue('unassigned')
  })

  it('sends removed teams’ students back to Unassigned', async () => {
    const c = makeCase({
      teams: [{ id: 't1', name: 'Alpha', side: 'plaintiff', members: students }],
    })
    const { user } = await renderBuilder(c)
    await user.click(screen.getByRole('button', { name: 'Remove Alpha' }))

    const pool = screen.getByRole('heading', { name: 'Unassigned (5)' }).closest('.builder-pool') as HTMLElement
    expect(within(pool).getByText('Ana')).toBeInTheDocument()
  })

  it('shows the server error and stays on the page', async () => {
    const { user, casesApi } = await renderBuilder()
    vi.mocked(casesApi.saveTeams).mockRejectedValue(new Error('Something went wrong.'))
    await user.click(screen.getByRole('button', { name: 'Auto-pair students' }))
    await user.click(screen.getByRole('button', { name: 'Continue to match-ups' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.')
    expect(screen.getByRole('button', { name: 'Continue to match-ups' })).toBeEnabled()
  })
})
